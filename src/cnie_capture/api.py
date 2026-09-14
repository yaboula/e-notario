from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image, ImageDraw
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.staticfiles import StaticFiles

from cnie_ocr.credentials import CredentialError, DpapiCredentialStore
from cnie_ocr.domain import OcrResult, OcrStatus
from cnie_ocr.google_vision import GoogleVisionOcrEngine, VISION_ORIGIN
from cnie_ocr.usage import UsageLedger
from cnie_extract import CnieFieldExtractor, ExtractionResult, ExtractionStatus
from cnie_extract.normalize import date_iso, identifier, text
from cnie_rectifier import CnieRectifier

MAX_UPLOAD = 20 * 1024 * 1024
MAX_MEMORY = 160 * 1024 * 1024
CAPTURE_TTL = 3600
SESSION_TTL = 4 * 3600
MAX_OCR_ATTEMPTS = 3


class PairRequest(BaseModel):
    code: str = Field(min_length=20, max_length=128)


class ReviewRequest(BaseModel):
    decision: Literal["accepted", "retake"]


class FieldReviewInput(BaseModel):
    decision: Literal["confirmed", "corrected", "absent"]
    value: str | list[str] | None = None


class ExtractionReviewRequest(BaseModel):
    revision: int = Field(ge=0)
    fields: dict[str, FieldReviewInput]


class ExtractionApprovalRequest(BaseModel):
    revision: int = Field(ge=0)


@dataclass
class OcrSummary:
    status: str = "not_started"
    attempts: int = 0
    queued_at: float | None = None
    started_at: float | None = None
    completed_at: float | None = None
    character_count: int = 0
    mean_confidence: float | None = None
    latency_ms: float | None = None
    error_code: str | None = None
    retryable: bool = False

    def metadata(self) -> dict:
        def timestamp(value: float | None):
            return datetime.fromtimestamp(value, timezone.utc).isoformat() if value else None
        return {
            "status": self.status,
            "attempts": self.attempts,
            "queued_at": timestamp(self.queued_at),
            "started_at": timestamp(self.started_at),
            "completed_at": timestamp(self.completed_at),
            "character_count": self.character_count,
            "mean_confidence": self.mean_confidence,
            "latency_ms": self.latency_ms,
            "error_code": self.error_code,
            "retryable": self.retryable,
        }


@dataclass
class ExtractionSummary:
    status: str = "waiting_for_ocr"
    template: str | None = None
    revision: int = 0
    field_count: int = 0
    reviewed_count: int = 0
    warning_count: int = 0
    latency_ms: float | None = None
    error_code: str | None = None
    approved_at: float | None = None
    approved_by: str | None = None

    def metadata(self) -> dict:
        return {
            "status": self.status, "template": self.template, "revision": self.revision,
            "field_count": self.field_count, "reviewed_count": self.reviewed_count,
            "warning_count": self.warning_count, "latency_ms": self.latency_ms,
            "error_code": self.error_code,
            "approved_at": datetime.fromtimestamp(self.approved_at, timezone.utc).isoformat() if self.approved_at else None,
            "approved_by": self.approved_by,
        }


@dataclass
class Capture:
    id: str
    owner: str
    side: str
    document_id: str
    original: bytes
    media_type: str
    result: dict
    rectified: bytes | None
    created: float = field(default_factory=time.time)
    review: str = "pending"
    attempt: int = 1
    active: bool = True
    ocr_summary: OcrSummary = field(default_factory=OcrSummary)
    ocr_result: OcrResult | None = None
    generation: int = 0

    def metadata(self):
        return {
            "id": self.id,
            "document_id": self.document_id,
            "side": self.side,
            "created_at": datetime.fromtimestamp(self.created, timezone.utc).isoformat(),
            "review": self.review,
            "source": "desktop" if self.owner == "desktop" else "mobile",
            "attempt": self.attempt,
            "active": self.active,
            "ocr_summary": self.ocr_summary.metadata(),
            "result": self.result,
        }


@dataclass
class Document:
    id: str
    owner: str
    created: float = field(default_factory=time.time)
    front_capture_id: str | None = None
    back_capture_id: str | None = None
    extraction_summary: ExtractionSummary = field(default_factory=ExtractionSummary)
    extraction_result: ExtractionResult | None = None
    extraction_reviews: dict[str, dict] = field(default_factory=dict)
    extraction_source: tuple[str, int, str, int] | None = None

    def active_ids(self) -> list[str]:
        return [value for value in (self.front_capture_id, self.back_capture_id) if value]


class State:
    def __init__(self, desktop_token: str, engine, ocr_engine, extractor, credential_store,
                 usage: UsageLedger, mobile_url: str | None, lan_mode: str | None):
        self.desktop_token = desktop_token
        self.engine = engine
        self.ocr_engine = ocr_engine
        self.extractor = extractor
        self.credential_store = credential_store
        self.usage = usage
        self.mobile_url = mobile_url
        self.lan_mode = lan_mode
        self.pair_code: str | None = None
        self.pair_deadline = 0.0
        self.sessions: dict[str, float] = {}
        self.captures: dict[str, Capture] = {}
        self.documents: dict[str, Document] = {}
        self.idempotency: dict[tuple[str, str], tuple[str, str]] = {}
        self.lock = asyncio.Lock()
        self.ocr_queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()
        self.sockets: dict[WebSocket, str] = {}
        self.processing = False

    def prune(self):
        now = time.time()
        self.sessions = {key: value for key, value in self.sessions.items() if value > now}
        expired = [key for key, value in self.captures.items() if value.created + CAPTURE_TTL <= now]
        for capture_id in expired:
            capture = self.captures.pop(capture_id)
            capture.generation += 1
        for document_id, document in list(self.documents.items()):
            changed = False
            if document.front_capture_id not in self.captures:
                document.front_capture_id = None
                changed = True
            if document.back_capture_id not in self.captures:
                document.back_capture_id = None
                changed = True
            if changed:
                self.invalidate_extraction(document)
            if not document.active_ids():
                self.documents.pop(document_id, None)
        self.idempotency = {key: value for key, value in self.idempotency.items() if value[1] in self.captures}

    def identity(self, token: str) -> str:
        self.prune()
        if secrets.compare_digest(token, self.desktop_token):
            return "desktop"
        if self.sessions.get(token, 0) > time.time():
            return token
        raise HTTPException(401, "SESSION_EXPIRED")

    def document_status(self, document: Document) -> str:
        captures = [self.captures[value] for value in document.active_ids() if value in self.captures]
        if any(capture.review == "retake" or capture.ocr_summary.status in {"error", "no_text"} for capture in captures):
            return "attention"
        if any(capture.review == "pending" for capture in captures):
            return "review_required"
        if len(captures) < 2:
            return "capturing"
        if any(capture.ocr_summary.status in {"queued", "processing", "not_started"} for capture in captures):
            return "ocr_pending"
        if all(capture.ocr_summary.status == "success" for capture in captures):
            if document.extraction_summary.status == "approved":
                return "ready"
            if document.extraction_summary.status == "review_required":
                return "data_review_required"
            if document.extraction_summary.status in {"extracting", "waiting_for_ocr"}:
                return "ocr_pending"
            return "attention"
        return "attention"

    def document_metadata(self, document: Document) -> dict:
        return {
            "id": document.id,
            "created_at": datetime.fromtimestamp(document.created, timezone.utc).isoformat(),
            "source": "desktop" if document.owner == "desktop" else "mobile",
            "front_capture_id": document.front_capture_id,
            "back_capture_id": document.back_capture_id,
            "status": self.document_status(document),
            "extraction_summary": document.extraction_summary.metadata(),
        }

    def invalidate_extraction(self, document: Document) -> None:
        document.extraction_result = None
        document.extraction_reviews.clear()
        document.extraction_source = None
        document.extraction_summary = ExtractionSummary()

    async def broadcast(self):
        for socket in list(self.sockets):
            try:
                self.identity(self.sockets[socket])
                await asyncio.wait_for(socket.send_json({"type": "changed"}), timeout=1)
            except Exception:
                self.sockets.pop(socket, None)
                try:
                    await socket.close(code=4401)
                except Exception:
                    pass

    async def queue_ocr(self, capture: Capture) -> None:
        capture.generation += 1
        capture.ocr_result = None
        capture.ocr_summary = OcrSummary(status="queued", attempts=capture.ocr_summary.attempts,
                                         queued_at=time.time())
        await self.ocr_queue.put((capture.id, capture.generation))

    async def ocr_worker(self):
        while True:
            capture_id, generation = await self.ocr_queue.get()
            try:
                capture = self.captures.get(capture_id)
                if not capture or capture.generation != generation or not capture.active or capture.review != "accepted":
                    continue
                capture.ocr_summary.status = "processing"
                capture.ocr_summary.started_at = time.time()
                capture.ocr_summary.attempts += 1
                await self.broadcast()
                try:
                    result = await run_in_threadpool(self.ocr_engine.recognize, capture.rectified or b"", UUID(capture.id))
                except Exception:
                    result = OcrResult(status=OcrStatus.FAILED, request_id=UUID(capture.id),
                                       error_code="OCR_PROVIDER_UNAVAILABLE", retryable=True)
                current = self.captures.get(capture_id)
                if not current or current.generation != generation or not current.active or current.review != "accepted":
                    continue
                current.ocr_result = result
                current.ocr_summary.completed_at = time.time()
                current.ocr_summary.character_count = int(result.metrics.get("character_count", 0) or 0)
                current.ocr_summary.mean_confidence = result.metrics.get("mean_word_confidence")
                current.ocr_summary.latency_ms = result.metrics.get("latency_ms")
                current.ocr_summary.error_code = result.error_code
                current.ocr_summary.retryable = result.retryable
                current.ocr_summary.status = (
                    "success" if result.status == OcrStatus.SUCCESS else
                    "no_text" if result.status == OcrStatus.NO_TEXT else "error"
                )
                await self.broadcast()
                if current.ocr_summary.status == "success":
                    document = self.documents.get(current.document_id)
                    if document:
                        await self.maybe_extract(document)
            finally:
                self.ocr_queue.task_done()

    async def maybe_extract(self, document: Document) -> None:
        front = self.captures.get(document.front_capture_id or "")
        back = self.captures.get(document.back_capture_id or "")
        if not front or not back or not front.active or not back.active:
            return
        if front.ocr_summary.status != "success" or back.ocr_summary.status != "success":
            return
        if front.ocr_result is None or back.ocr_result is None:
            return
        source = (front.id, front.generation, back.id, back.generation)
        if document.extraction_source == source and document.extraction_result is not None:
            return
        document.extraction_summary = ExtractionSummary(status="extracting",
            revision=document.extraction_summary.revision + 1)
        await self.broadcast()
        try:
            result = await run_in_threadpool(self.extractor.extract, front.ocr_result, back.ocr_result, UUID(document.id))
        except Exception:
            result = ExtractionResult(status=ExtractionStatus.FAILED, request_id=UUID(document.id),
                                      error_code="EXTRACTION_FAILED")
        current_front = self.captures.get(document.front_capture_id or "")
        current_back = self.captures.get(document.back_capture_id or "")
        if not current_front or not current_back or source != (current_front.id, current_front.generation,
                                                                current_back.id, current_back.generation):
            return
        document.extraction_source = source
        document.extraction_result = result
        document.extraction_reviews.clear()
        document.extraction_summary = ExtractionSummary(
            status="review_required" if result.status == ExtractionStatus.REVIEW_REQUIRED else "attention",
            template=result.template, revision=document.extraction_summary.revision,
            field_count=len(result.fields), warning_count=len(result.warnings),
            latency_ms=result.metrics.get("latency_ms"), error_code=result.error_code)
        await self.broadcast()


def _default_ocr_components():
    root = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "e-notario-v2"
    store = DpapiCredentialStore(root / "google-vision.credential.dpapi")
    def managed_limit(name: str, default: int) -> int:
        try:
            value = int(os.environ.get(name, default))
            return value if 1 <= value <= 100_000 else default
        except (TypeError, ValueError):
            return default
    usage = UsageLedger(root / "ocr-usage.json",
                        daily_limit=managed_limit("CNIE_OCR_DAILY_LIMIT", 60),
                        monthly_limit=managed_limit("CNIE_OCR_MONTHLY_LIMIT", 900))
    return store, usage, GoogleVisionOcrEngine(store.load, usage)


def _synthetic_test_image() -> bytes:
    image = Image.new("RGB", (1600, 1008), "white")
    ImageDraw.Draw(image).text((100, 100), "CONNECTION TEST 123", fill="black")
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=90)
    return output.getvalue()


def create_app(*, desktop_token: str | None = None, engine=None, ocr_engine=None, extractor=None,
               credential_store=None, usage_ledger=None, mobile_url: str | None = None,
               lan_mode: str | None = None, desktop_dist: Path | None = None,
               mobile_dist: Path | None = None) -> FastAPI:
    if credential_store is None or usage_ledger is None or ocr_engine is None:
        default_store, default_usage, default_engine = _default_ocr_components()
        credential_store = credential_store or default_store
        usage_ledger = usage_ledger or default_usage
        ocr_engine = ocr_engine or default_engine
    state = State(desktop_token or secrets.token_urlsafe(32), engine or CnieRectifier(), ocr_engine,
                  extractor or CnieFieldExtractor(),
                  credential_store, usage_ledger, mobile_url, lan_mode)

    @asynccontextmanager
    async def lifespan(_app):
        async def cleanup():
            while True:
                await asyncio.sleep(30)
                state.prune()
                await state.broadcast()
        cleanup_task = asyncio.create_task(cleanup())
        worker_task = asyncio.create_task(state.ocr_worker())
        yield
        cleanup_task.cancel()
        worker_task.cancel()
        state.captures.clear()
        state.documents.clear()
        state.sessions.clear()
        state.idempotency.clear()

    app = FastAPI(title="e-notario · Capture service", version="0.6.1", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.capture = state
    app.add_middleware(CORSMiddleware,
        allow_origins=["http://localhost:1420", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"],
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"])
    bearer = HTTPBearer(auto_error=False)

    @app.middleware("http")
    async def headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response

    def user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if credentials is None:
            raise HTTPException(401, "AUTH_REQUIRED")
        return state.identity(credentials.credentials)

    def desktop(identity: str = Depends(user)):
        if identity != "desktop":
            raise HTTPException(403, "DESKTOP_ONLY")
        return identity

    def owned(capture_id: UUID, identity: str) -> Capture:
        capture = state.captures.get(str(capture_id))
        if capture is None or (identity != "desktop" and capture.owner != identity):
            raise HTTPException(404, "CAPTURE_NOT_FOUND")
        return capture

    def owned_document(document_id: UUID, identity: str) -> Document:
        document = state.documents.get(str(document_id))
        if document is None or (identity != "desktop" and document.owner != identity):
            raise HTTPException(404, "DOCUMENT_NOT_FOUND")
        return document

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.6.1"}

    @app.get("/api/workspace")
    def workspace(identity: str = Depends(user)):
        visible_documents = [document for document in state.documents.values()
                             if identity == "desktop" or document.owner == identity]
        visible_ids = {document.id for document in visible_documents}
        return {
            "documents": [state.document_metadata(document) for document in reversed(visible_documents)],
            "captures": [capture.metadata() for capture in reversed(list(state.captures.values()))
                         if capture.document_id in visible_ids],
            "connected_devices": len(state.sessions) if identity == "desktop" else 1,
            "processing": state.processing,
            "mobile_url": state.mobile_url if identity == "desktop" else None,
            "lan_mode": state.lan_mode if identity == "desktop" else None,
            "retention_minutes": CAPTURE_TTL // 60,
        }

    @app.post("/api/pairing")
    async def pairing(_=Depends(desktop)):
        if not state.mobile_url:
            raise HTTPException(409, "LAN_HTTPS_NOT_CONFIGURED")
        state.pair_code = secrets.token_urlsafe(32)
        state.pair_deadline = time.time() + 120
        return {"url": f"{state.mobile_url.rstrip('/')}/capture/#pair={state.pair_code}", "expires_at": state.pair_deadline}

    @app.post("/api/pair")
    async def pair(body: PairRequest):
        if not state.pair_code or state.pair_deadline <= time.time() or not secrets.compare_digest(body.code, state.pair_code):
            raise HTTPException(401, "PAIRING_EXPIRED")
        if len(state.sessions) >= 8:
            raise HTTPException(429, "DEVICE_LIMIT")
        state.pair_code = None
        token = secrets.token_urlsafe(32)
        state.sessions[token] = time.time() + SESSION_TTL
        await state.broadcast()
        return {"token": token, "expires_at": state.sessions[token]}

    @app.delete("/api/pairing")
    async def disconnect(_=Depends(desktop)):
        state.sessions.clear()
        state.pair_code = None
        await state.broadcast()
        return {"status": "disconnected"}

    @app.post("/api/captures")
    async def upload(request: Request, side: Literal["front", "back"] = "front",
                     document_id: UUID | None = None, identity: str = Depends(user)):
        if state.lock.locked():
            raise HTTPException(429, "PROCESSOR_BUSY")
        key = request.headers.get("Idempotency-Key")
        try:
            UUID(key or "")
        except ValueError:
            raise HTTPException(400, "IDEMPOTENCY_KEY_REQUIRED")
        content_type = request.headers.get("content-type", "").split(";")[0]
        if content_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(415, "JPEG_OR_PNG_REQUIRED")
        async with state.lock:
            state.prune()
            document = state.documents.get(str(document_id)) if document_id else None
            if document_id and (not document or (identity != "desktop" and document.owner != identity)):
                raise HTTPException(404, "DOCUMENT_NOT_FOUND")
            if len(state.captures) >= 30:
                raise HTTPException(409, "CAPTURE_LIMIT_DELETE_FIRST")
            used = sum(len(capture.original) + len(capture.rectified or b"") for capture in state.captures.values())
            limit = min(MAX_UPLOAD, MAX_MEMORY - used - 10 * 1024 * 1024)
            payload = bytearray()
            async for chunk in request.stream():
                if len(payload) + len(chunk) > limit:
                    raise HTTPException(413, "IMAGE_TOO_LARGE")
                payload.extend(chunk)
            digest = hashlib.sha256(payload).hexdigest() + side + str(document_id or "")
            previous = state.idempotency.get((identity, key))
            if previous:
                if previous[0] != digest:
                    raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
                return state.captures[previous[1]].metadata()
            state.processing = True
            try:
                result = await run_in_threadpool(state.engine.rectify, bytes(payload))
                metadata = result.to_dict()
                for name in ("opencv", "docquadnet"):
                    metadata.get(name, {}).pop("error", None)
                if document is None:
                    document = Document(str(uuid4()), identity)
                    state.documents[document.id] = document
                else:
                    state.invalidate_extraction(document)
                previous_id = document.front_capture_id if side == "front" else document.back_capture_id
                previous_capture = state.captures.get(previous_id or "")
                attempt = 1
                if previous_capture:
                    attempt = previous_capture.attempt + 1
                    previous_capture.active = False
                    previous_capture.generation += 1
                    previous_capture.ocr_result = None
                    previous_capture.ocr_summary = OcrSummary(status="cancelled")
                capture = Capture(str(uuid4()), identity, side, document.id, bytes(payload), content_type,
                                  metadata, result.rectified_image, attempt=attempt)
                state.captures[capture.id] = capture
                if side == "front":
                    document.front_capture_id = capture.id
                else:
                    document.back_capture_id = capture.id
                state.idempotency[(identity, key)] = (digest, capture.id)
            except Exception:
                raise HTTPException(500, "PROCESSING_FAILED") from None
            finally:
                state.processing = False
        await state.broadcast()
        return capture.metadata()

    @app.get("/api/captures/{capture_id}/{variant}")
    def image(capture_id: UUID, variant: str, identity: str = Depends(user)):
        capture = owned(capture_id, identity)
        if variant == "metadata":
            return capture.metadata()
        if variant == "ocr":
            if identity != "desktop":
                raise HTTPException(403, "DESKTOP_ONLY")
            if capture.ocr_result is None:
                raise HTTPException(409, "OCR_RESULT_NOT_AVAILABLE")
            return capture.ocr_result.to_dict()
        if variant not in {"original", "rectified"}:
            raise HTTPException(404, "CAPTURE_VARIANT_NOT_FOUND")
        data = capture.original if variant == "original" else capture.rectified
        if data is None:
            raise HTTPException(404, "RECTIFIED_IMAGE_UNAVAILABLE")
        return Response(data, media_type=capture.media_type if variant == "original" else "image/jpeg")

    @app.post("/api/captures/{capture_id}/review")
    async def review(capture_id: UUID, body: ReviewRequest, identity: str = Depends(desktop)):
        capture = owned(capture_id, identity)
        if not capture.active:
            raise HTTPException(409, "CAPTURE_REPLACED")
        if body.decision == "accepted" and capture.result["status"] != "success":
            raise HTTPException(409, "RECAPTURE_REQUIRED")
        if body.decision == "accepted":
            if capture.review != "accepted":
                capture.review = "accepted"
                await state.queue_ocr(capture)
        else:
            capture.review = "retake"
            capture.generation += 1
            capture.ocr_result = None
            capture.ocr_summary = OcrSummary(status="cancelled")
            document = state.documents.get(capture.document_id)
            if document:
                state.invalidate_extraction(document)
        await state.broadcast()
        return capture.metadata()

    @app.post("/api/captures/{capture_id}/ocr/retry")
    async def retry_ocr(capture_id: UUID, identity: str = Depends(desktop)):
        capture = owned(capture_id, identity)
        if not capture.active or capture.review != "accepted":
            raise HTTPException(409, "OCR_RETRY_NOT_ALLOWED")
        summary = capture.ocr_summary
        if summary.status not in {"error", "no_text"}:
            raise HTTPException(409, "OCR_RETRY_NOT_ALLOWED")
        if summary.attempts >= MAX_OCR_ATTEMPTS:
            raise HTTPException(409, "OCR_MAX_ATTEMPTS_REACHED")
        if not summary.retryable and summary.error_code not in {"OCR_NOT_CONFIGURED", "OCR_CREDENTIAL_INVALID"}:
            raise HTTPException(409, "OCR_RETRY_NOT_ALLOWED")
        await state.queue_ocr(capture)
        await state.broadcast()
        return capture.metadata()

    @app.delete("/api/captures/{capture_id}")
    async def delete(capture_id: UUID, identity: str = Depends(desktop)):
        capture = owned(capture_id, identity)
        capture.generation += 1
        document = state.documents.get(capture.document_id)
        if document:
            active_face = document.front_capture_id == capture.id or document.back_capture_id == capture.id
            if active_face:
                state.invalidate_extraction(document)
            if document.front_capture_id == capture.id:
                document.front_capture_id = None
            if document.back_capture_id == capture.id:
                document.back_capture_id = None
        del state.captures[capture.id]
        state.prune()
        await state.broadcast()
        return {"status": "deleted"}

    def extraction_payload(document: Document) -> dict:
        if document.extraction_result is None:
            raise HTTPException(409, "EXTRACTION_RESULT_NOT_AVAILABLE")
        result = document.extraction_result
        fields = {}
        for key, field_value in result.fields.items():
            fields[key] = {
                "key": key,
                "normalized_value": field_value.normalized_value,
                "confidence": field_value.confidence,
                "required": field_value.required,
                "source_side": field_value.evidence[0].side if field_value.evidence else None,
                "warnings": field_value.warnings,
            }
        return {
            "document_id": document.id,
            "revision": document.extraction_summary.revision,
            "status": document.extraction_summary.status,
            "approved_at": document.extraction_summary.metadata()["approved_at"],
            "approved_by": document.extraction_summary.approved_by,
            "engine": {"template": result.template, "version": result.engine_version},
            "fields": fields,
            "warnings": result.warnings,
            "reviews": document.extraction_reviews,
        }

    def normalize_review_value(key: str, value):
        if value is None:
            return None
        if isinstance(value, list):
            if key not in {"filiation_ar", "filiation_latin", "address_ar", "address_latin"}:
                raise HTTPException(400, "EXTRACTION_DATA_CONFLICT")
            return [text(str(item)) for item in value if text(str(item))]
        value = str(value)
        if key in {"national_id"}:
            return identifier(value)
        if key in {"birth_date", "expiry_date"}:
            return date_iso(value)
        if key == "sex":
            candidate = text(value).upper()
            return candidate if candidate in {"M", "F"} else "unknown"
        return text(value)

    def reviewed_value(document: Document, key: str):
        review = document.extraction_reviews.get(key)
        if review and review["decision"] == "absent":
            return None
        if review:
            return review["value"]
        field_value = document.extraction_result.fields.get(key) if document.extraction_result else None
        return field_value.normalized_value if field_value else None

    def approved_export(document: Document) -> dict:
        def lines(key: str) -> list[str]:
            value = reviewed_value(document, key)
            if isinstance(value, list):
                return [text(str(item)) for item in value if text(str(item))]
            return [line for line in str(value or "").splitlines() if text(line)]
        result = document.extraction_result
        assert result is not None
        corrected = sorted(key for key, review in document.extraction_reviews.items()
                           if review["decision"] == "corrected")
        return {
            "schema_version": "cnie.ma.2020/v2",
            "document_id": document.id,
            "approved_at": document.extraction_summary.metadata()["approved_at"],
            "approved_by": document.extraction_summary.approved_by,
            "extractor": {"template": result.template, "version": result.engine_version},
            "data": {
                "national_id": reviewed_value(document, "national_id"),
                "surname": {"arabic": reviewed_value(document, "surname_ar"),
                            "latin": reviewed_value(document, "surname_latin")},
                "given_names": {"arabic": reviewed_value(document, "given_names_ar"),
                                "latin": reviewed_value(document, "given_names_latin")},
                "birth": {"date": reviewed_value(document, "birth_date"),
                          "place": {"arabic": reviewed_value(document, "birth_place_ar"),
                                    "latin": reviewed_value(document, "birth_place_latin")}},
                "expiry_date": reviewed_value(document, "expiry_date"),
                "filiation": {"arabic": lines("filiation_ar"), "latin": lines("filiation_latin")},
                "address": {"arabic": "\n".join(lines("address_ar")),
                            "latin": "\n".join(lines("address_latin"))},
                "sex": reviewed_value(document, "sex"),
            },
            "verification": {"human_reviewed": True, "manual_corrections": corrected,
                             "accepted_warnings": result.warnings},
        }

    @app.get("/api/documents/{document_id}/extraction")
    def get_extraction(document_id: UUID, identity: str = Depends(user)):
        return extraction_payload(owned_document(document_id, identity))

    @app.patch("/api/documents/{document_id}/extraction/review")
    async def review_extraction(document_id: UUID, body: ExtractionReviewRequest,
                                identity: str = Depends(user)):
        document = owned_document(document_id, identity)
        result = document.extraction_result
        if result is None or document.extraction_summary.status != "review_required":
            raise HTTPException(409, "EXTRACTION_RESULT_NOT_AVAILABLE")
        if body.revision != document.extraction_summary.revision:
            raise HTTPException(409, "EXTRACTION_STALE_REVISION")
        for key, submitted in body.fields.items():
            field_value = result.fields.get(key)
            if field_value is None:
                raise HTTPException(400, "EXTRACTION_UNKNOWN_FIELD")
            if submitted.decision == "absent":
                if field_value.required:
                    raise HTTPException(409, "EXTRACTION_REQUIRED_FIELD_MISSING")
                value = None
            elif submitted.decision == "confirmed":
                value = field_value.normalized_value
                if value in (None, "", []):
                    raise HTTPException(409, "EXTRACTION_REQUIRED_FIELD_MISSING")
            else:
                value = normalize_review_value(key, submitted.value)
                if value in (None, "", []):
                    raise HTTPException(409, "EXTRACTION_REQUIRED_FIELD_MISSING")
            document.extraction_reviews[key] = {
                "decision": submitted.decision,
                "value": value,
                "reviewed_by": "desktop" if identity == "desktop" else "mobile",
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            }
        document.extraction_summary.revision += 1
        document.extraction_summary.reviewed_count = len(document.extraction_reviews)
        document.extraction_summary.status = "review_required"
        document.extraction_summary.approved_at = None
        document.extraction_summary.approved_by = None
        await state.broadcast()
        return extraction_payload(document)

    @app.post("/api/documents/{document_id}/extraction/approve")
    async def approve_extraction(document_id: UUID, body: ExtractionApprovalRequest,
                                 identity: str = Depends(user)):
        document = owned_document(document_id, identity)
        result = document.extraction_result
        if result is None:
            raise HTTPException(409, "EXTRACTION_RESULT_NOT_AVAILABLE")
        if body.revision != document.extraction_summary.revision:
            raise HTTPException(409, "EXTRACTION_STALE_REVISION")
        if document.extraction_summary.status == "approved":
            return extraction_payload(document)
        missing = [key for key in result.fields if key not in document.extraction_reviews]
        if missing:
            raise HTTPException(409, "EXTRACTION_REVIEW_INCOMPLETE")
        national_id = reviewed_value(document, "national_id")
        birth_date = reviewed_value(document, "birth_date")
        expiry_date = reviewed_value(document, "expiry_date")
        sex = reviewed_value(document, "sex")
        if not isinstance(national_id, str) or not re.fullmatch(r"[A-Z]{1,3}\d{4,10}", national_id):
            raise HTTPException(409, "EXTRACTION_DATA_CONFLICT")
        if not isinstance(birth_date, str) or not isinstance(expiry_date, str) or sex not in {"M", "F"}:
            raise HTTPException(409, "EXTRACTION_DATA_CONFLICT")
        if expiry_date <= birth_date:
            raise HTTPException(409, "EXTRACTION_DATA_CONFLICT")
        if "EXTRACTION_SIDE_MISMATCH" in result.warnings:
            raise HTTPException(409, "EXTRACTION_SIDE_MISMATCH")
        document.extraction_summary.status = "approved"
        document.extraction_summary.approved_at = time.time()
        document.extraction_summary.approved_by = "desktop" if identity == "desktop" else "mobile"
        await state.broadcast()
        return extraction_payload(document)

    @app.get("/api/documents/{document_id}/export")
    def export_extraction(document_id: UUID, identity: str = Depends(desktop)):
        document = owned_document(document_id, identity)
        if document.extraction_summary.status != "approved":
            raise HTTPException(409, "EXTRACTION_REVIEW_INCOMPLETE")
        payload = json.dumps(approved_export(document), ensure_ascii=False, indent=2).encode("utf-8")
        return Response(payload, media_type="application/json; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="cnie-{document.id[:8]}.json"'})

    @app.get("/api/model")
    async def model(_=Depends(desktop)):
        if state.lock.locked():
            raise HTTPException(429, "PROCESSOR_BUSY")
        async with state.lock:
            info = await run_in_threadpool(state.engine.docquad_detector.model_info)
        info.pop("load_error", None)
        return info

    @app.get("/api/ocr/config")
    def ocr_config(_=Depends(desktop)):
        metadata = state.credential_store.metadata()
        return {
            "configured": metadata is not None,
            "project_id": metadata.project_id if metadata else None,
            "client_email": metadata.client_email if metadata else None,
            "region": "eu",
            "endpoint": VISION_ORIGIN,
            "limits": state.usage.summary().to_dict(),
        }

    @app.put("/api/ocr/config/credential")
    async def import_credential(request: Request, _=Depends(desktop)):
        if request.headers.get("content-type", "").split(";")[0] != "application/json":
            raise HTTPException(415, "OCR_CREDENTIAL_INVALID")
        payload = bytearray()
        async for chunk in request.stream():
            if len(payload) + len(chunk) > 64 * 1024:
                raise HTTPException(413, "OCR_CREDENTIAL_INVALID")
            payload.extend(chunk)
        try:
            metadata = await run_in_threadpool(state.credential_store.import_bytes, bytes(payload))
        except CredentialError:
            raise HTTPException(400, "OCR_CREDENTIAL_INVALID") from None
        return {"configured": True, **metadata.to_dict(), "region": "eu"}

    @app.post("/api/ocr/config/test")
    async def test_ocr_connection(_=Depends(desktop)):
        result = await run_in_threadpool(state.ocr_engine.recognize, _synthetic_test_image(), uuid4())
        if result.status == OcrStatus.FAILED:
            raise HTTPException(409 if result.retryable else 400, result.error_code or "OCR_INVALID_RESPONSE")
        return {"status": "connected", "region": "eu", "latency_ms": result.metrics.get("latency_ms")}

    @app.delete("/api/ocr/config/credential")
    def delete_credential(_=Depends(desktop)):
        return {"status": "deleted", "existed": state.credential_store.delete()}

    @app.get("/api/ocr/usage")
    def ocr_usage(_=Depends(desktop)):
        return state.usage.summary().to_dict()

    @app.websocket("/api/events")
    async def events(socket: WebSocket):
        await socket.accept()
        try:
            message = await asyncio.wait_for(socket.receive_json(), timeout=5)
            token = message.get("token", "")
            state.identity(token)
            if len(state.sockets) >= 16:
                await socket.close(code=4429)
                return
            state.sockets[socket] = token
            await socket.send_json({"type": "connected"})
            while True:
                await asyncio.wait_for(socket.receive_text(), timeout=60)
                state.identity(token)
        except (WebSocketDisconnect, HTTPException, asyncio.TimeoutError, ValueError):
            try:
                await socket.close(code=4401)
            except RuntimeError:
                pass
        finally:
            state.sockets.pop(socket, None)

    if mobile_dist and mobile_dist.is_dir():
        app.mount("/capture", StaticFiles(directory=mobile_dist, html=True), name="capture")
    if desktop_dist and desktop_dist.is_dir():
        app.mount("/", StaticFiles(directory=desktop_dist, html=True), name="desktop")
    return app
