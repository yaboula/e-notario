from __future__ import annotations

import asyncio
import base64
import copy
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image, ImageDraw
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.staticfiles import StaticFiles

from cnie_ocr.credentials import CredentialError, DpapiCredentialStore
from cnie_ocr.domain import (OcrBlock, OcrPage, OcrParagraph, OcrResult, OcrStatus,
                             OcrWord)
from cnie_ocr.google_vision import GoogleVisionOcrEngine, VISION_ORIGIN
from cnie_ocr.usage import UsageLedger, UsageStorageError
from cnie_extract import CnieFieldExtractor, ExtractionResult, ExtractionStatus
from cnie_extract.domain import ExtractedField, FieldEvidence
from cnie_extract.normalize import date_iso, identifier, text
from cnie_rectifier import CnieRectifier
from cnie_documents import DocumentTemplateCatalog, DocumentTemplateError
from cnie_cases import (CaseDraft, CaseError, FieldLeaseError, FieldLeaseManager,
                        InMemoryCaseStore)
from cnie_cases.domain import validate_assignments as validate_case_assignments, validate_fields
from cnie_cases.store import CaseStore
from cnie_profiles import InMemoryProfileStore, ProfessionalProfile, ProfileError
from cnie_profiles.store import ProfileStore
from cnie_capture.workspace_store import EncryptedWorkspaceStore, WorkspaceStoreError, WORKSPACE_SCHEMA

MAX_UPLOAD = 20 * 1024 * 1024
MAX_MEMORY = 160 * 1024 * 1024
CAPTURE_TTL = 24 * 3600
SESSION_TTL = 4 * 3600
MAX_OCR_ATTEMPTS = 3
MAINTENANCE_INTERVAL_SECONDS = 30.0
MAX_APPROVED_IDENTITIES = 64
MAX_DOCUMENT_REQUESTS = 64
IDENTITY_TTL = 24 * 3600


class PairRequest(BaseModel):
    code: str = Field(min_length=20, max_length=128)
    operator_name: str = Field(default="Opérateur mobile", min_length=1, max_length=48)
    device_name: str = Field(default="Appareil mobile", min_length=1, max_length=48)


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


class DocumentGenerationCreate(BaseModel):
    template_id: str = Field(min_length=1, max_length=128)
    template_version: str = Field(min_length=1, max_length=32)
    assignments: dict[str, list[UUID]]


class DocumentGenerationUpdate(BaseModel):
    revision: int = Field(ge=0)
    assignments: dict[str, list[UUID]]


class CaseCreateRequest(BaseModel):
    template_id: str = Field(min_length=1, max_length=128)
    template_version: str = Field(min_length=1, max_length=32)
    mode: Literal["partial", "complete"]


class CaseUpdateRequest(BaseModel):
    revision: int = Field(ge=0)
    fields: dict[str, str | list[str] | None] | None = None
    assignments: dict[str, list[UUID]] | None = None


class CaseRevisionRequest(BaseModel):
    revision: int = Field(ge=0)


class CaseGenerateRequest(BaseModel):
    revision: int = Field(ge=0)
    confirm_incomplete: bool = False


class FieldLeaseRequest(BaseModel):
    field_key: str = Field(min_length=1, max_length=128)
    actor_label: str = Field(min_length=1, max_length=80)
    lease_token: str | None = Field(default=None, min_length=20, max_length=128)


class FieldLeaseReleaseRequest(BaseModel):
    field_key: str = Field(min_length=1, max_length=128)
    lease_token: str = Field(min_length=20, max_length=128)


class CaseFieldPatchRequest(BaseModel):
    value: str | list[str] | None = None
    lease_token: str = Field(min_length=20, max_length=128)
    assignment_context: list[UUID] | None = Field(default=None, max_length=12)


class CaseRolePatchRequest(BaseModel):
    value: list[UUID]
    lease_token: str = Field(min_length=20, max_length=128)


class ClearTemporaryDataRequest(BaseModel):
    confirmation: Literal["CLEAR_TEMPORARY_DATA"]


class ProfileCreateRequest(BaseModel):
    id: UUID | None = None
    display_name_ar: str = Field(min_length=1, max_length=160)
    display_name_fr: str = Field(default="", max_length=160)
    function_fr: str = Field(default="", max_length=160)


class ProfileUpdateRequest(ProfileCreateRequest):
    revision: int = Field(ge=0)
    active: bool = True


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
    card_model: Literal["CNIE_MA_2020", "CNIE_MA_LEGACY"] = "CNIE_MA_2020"
    created: float = field(default_factory=time.time)
    front_capture_id: str | None = None
    back_capture_id: str | None = None
    extraction_summary: ExtractionSummary = field(default_factory=ExtractionSummary)
    extraction_result: ExtractionResult | None = None
    extraction_reviews: dict[str, dict] = field(default_factory=dict)
    extraction_source: tuple[str, int, str, int] | None = None
    identity_id: str | None = None

    def active_ids(self) -> list[str]:
        return [value for value in (self.front_capture_id, self.back_capture_id) if value]


@dataclass(frozen=True)
class ApprovedIdentity:
    id: str
    owner: str
    document_id: str
    extraction_revision: int
    source: str
    card_template: str
    values: dict[str, Any]
    created: float
    expires: float
    images_released: bool = False

    def summary(self) -> dict[str, Any]:
        arabic_name = " ".join(filter(None, (
            str(self.values.get("given_names_ar") or "").strip(),
            str(self.values.get("surname_ar") or "").strip(),
        )))
        latin_name = " ".join(filter(None, (
            str(self.values.get("given_names_latin") or "").strip(),
            str(self.values.get("surname_latin") or "").strip(),
        )))
        return {
            "id": self.id,
            "document_id": self.document_id,
            "revision": self.extraction_revision,
            "source": self.source,
            "card_template": self.card_template,
            "created_at": datetime.fromtimestamp(self.created, timezone.utc).isoformat(),
            "expires_at": datetime.fromtimestamp(self.expires, timezone.utc).isoformat(),
            "images_released": self.images_released,
            "display_name_ar": arabic_name,
            "display_name_latin": latin_name,
            "national_id": self.values.get("national_id"),
        }


@dataclass
class DocumentGenerationRequestState:
    id: str
    owner: str
    template_id: str
    template_version: str
    assignments: dict[str, list[str]]
    revision: int = 0
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)

    def metadata(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "revision": self.revision,
            "template_id": self.template_id,
            "template_version": self.template_version,
            "assignments": self.assignments,
            "source": "desktop" if self.owner == "desktop" else "mobile",
            "created_at": datetime.fromtimestamp(self.created, timezone.utc).isoformat(),
            "updated_at": datetime.fromtimestamp(self.updated, timezone.utc).isoformat(),
        }


def _bytes_to_text(value: bytes | None) -> str | None:
    return base64.b64encode(value).decode("ascii") if value is not None else None


def _text_to_bytes(value: str | None) -> bytes | None:
    return base64.b64decode(value, validate=True) if value is not None else None


def _ocr_result_from_dict(raw: dict[str, Any]) -> OcrResult:
    pages: list[OcrPage] = []
    for page in raw.get("pages", []):
        blocks: list[OcrBlock] = []
        for block in page.get("blocks", []):
            paragraphs: list[OcrParagraph] = []
            for paragraph in block.get("paragraphs", []):
                words = [OcrWord(**word) for word in paragraph.get("words", [])]
                paragraphs.append(OcrParagraph(
                    text=paragraph.get("text", ""), confidence=paragraph.get("confidence"),
                    bounding_box=paragraph.get("bounding_box", []),
                    languages=list(paragraph.get("languages", [])), words=words))
            blocks.append(OcrBlock(
                text=block.get("text", ""), confidence=block.get("confidence"),
                bounding_box=block.get("bounding_box", []),
                block_type=block.get("block_type", "text"), paragraphs=paragraphs))
        pages.append(OcrPage(width=int(page.get("width", 0)), height=int(page.get("height", 0)),
                             confidence=page.get("confidence"), blocks=blocks))
    return OcrResult(
        status=OcrStatus(raw["status"]), request_id=UUID(raw["request_id"]),
        provider=str(raw.get("provider", "google_cloud_vision")),
        region=str(raw.get("region", "eu")), full_text=str(raw.get("full_text", "")),
        arabic_text=str(raw.get("arabic_text", "")), pages=pages,
        languages=list(raw.get("languages", [])), metrics=dict(raw.get("metrics", {})),
        error_code=raw.get("error_code"), retryable=bool(raw.get("retryable", False)))


def _extraction_result_from_dict(raw: dict[str, Any]) -> ExtractionResult:
    fields: dict[str, ExtractedField] = {}
    for key, value in raw.get("fields", {}).items():
        evidence = [FieldEvidence(**item) for item in value.get("evidence", [])]
        fields[key] = ExtractedField(
            key=str(value.get("key", key)), raw_value=value.get("raw_value"),
            normalized_value=value.get("normalized_value"),
            confidence=value.get("confidence"), required=bool(value.get("required", True)),
            evidence=evidence, warnings=list(value.get("warnings", [])))
    return ExtractionResult(
        status=ExtractionStatus(raw["status"]), request_id=UUID(raw["request_id"]),
        template=raw.get("template"), engine_version=str(raw.get("engine_version", "1.2.0")),
        fields=fields, warnings=list(raw.get("warnings", [])),
        error_code=raw.get("error_code"), metrics=dict(raw.get("metrics", {})))


class State:
    def __init__(self, desktop_token: str, engine, ocr_engine, extractor, credential_store,
                 usage: UsageLedger, mobile_url: str | None, lan_mode: str | None,
                 document_catalog: DocumentTemplateCatalog, case_store: CaseStore,
                 profile_store: ProfileStore,
                 workspace_store: EncryptedWorkspaceStore | None = None,
                 saved_receipts_path: Path | None = None):
        self.desktop_token = desktop_token
        self.engine = engine
        self.ocr_engine = ocr_engine
        self.extractor = extractor
        self.credential_store = credential_store
        self.usage = usage
        self.mobile_url = mobile_url
        self.lan_mode = lan_mode
        self.document_catalog = document_catalog
        self.case_store = case_store
        self.field_leases = FieldLeaseManager()
        self.profile_store = profile_store
        self.workspace_store = workspace_store
        self.saved_receipts_path = saved_receipts_path
        self.pair_code: str | None = None
        self.pair_deadline = 0.0
        self.sessions: dict[str, float] = {}
        self.session_labels: dict[str, str] = {}
        self.captures: dict[str, Capture] = {}
        self.documents: dict[str, Document] = {}
        self.idempotency: dict[tuple[str, str], tuple[str, str]] = {}
        self.approved_identities: dict[str, ApprovedIdentity] = {}
        self.document_generation_requests: dict[str, DocumentGenerationRequestState] = {}
        self.document_request_idempotency: dict[tuple[str, str], tuple[str, dict[str, Any]]] = {}
        self.case_mutation_idempotency: dict[tuple[str, str], tuple[str, dict[str, Any]]] = {}
        self.lock = asyncio.Lock()
        self.case_lock = asyncio.Lock()
        self.persistence_lock = asyncio.Lock()
        self.ocr_queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()
        self.sockets: dict[WebSocket, str] = {}
        self.processing = False
        self.storage_error: str | None = None
        self.pending_ocr_commits: dict[str, int] = {}
        self.worker_task: asyncio.Task | None = None
        self.cleanup_task: asyncio.Task | None = None

    def snapshot(self) -> dict[str, Any]:
        captures = []
        for item in self.captures.values():
            captures.append({
                "id": item.id, "owner": item.owner, "side": item.side,
                "document_id": item.document_id, "original": _bytes_to_text(item.original),
                "media_type": item.media_type, "result": item.result,
                "rectified": _bytes_to_text(item.rectified), "created": item.created,
                "review": item.review, "attempt": item.attempt, "active": item.active,
                "ocr_summary": vars(item.ocr_summary),
                "ocr_result": item.ocr_result.to_dict() if item.ocr_result else None,
                "generation": item.generation,
            })
        documents = []
        for item in self.documents.values():
            documents.append({
                "id": item.id, "owner": item.owner, "card_model": item.card_model,
                "created": item.created, "front_capture_id": item.front_capture_id,
                "back_capture_id": item.back_capture_id,
                "extraction_summary": vars(item.extraction_summary),
                "extraction_result": item.extraction_result.to_dict()
                    if item.extraction_result else None,
                "extraction_reviews": item.extraction_reviews,
                "extraction_source": list(item.extraction_source)
                    if item.extraction_source else None,
                "identity_id": item.identity_id,
            })
        identities = [{
            "id": item.id, "owner": item.owner, "document_id": item.document_id,
            "extraction_revision": item.extraction_revision, "source": item.source,
            "card_template": item.card_template, "values": item.values,
            "created": item.created, "expires": item.expires,
            "images_released": item.images_released,
        } for item in self.approved_identities.values()]
        requests = [{
            "id": item.id, "owner": item.owner, "template_id": item.template_id,
            "template_version": item.template_version, "assignments": item.assignments,
            "revision": item.revision, "created": item.created, "updated": item.updated,
        } for item in self.document_generation_requests.values()]
        return {
            "schema": WORKSPACE_SCHEMA, "saved_at": time.time(),
            "sessions": self.sessions, "session_labels": self.session_labels,
            "captures": captures, "documents": documents,
            "approved_identities": identities, "document_requests": requests,
            "capture_idempotency": [[owner, key, digest, capture_id]
                                    for (owner, key), (digest, capture_id)
                                    in self.idempotency.items()],
            "case_idempotency": [[owner, key, digest, response]
                                 for (owner, key), (digest, response)
                                 in self.case_mutation_idempotency.items()],
            "document_request_idempotency": [[owner, key, digest, response]
                                              for (owner, key), (digest, response)
                                              in self.document_request_idempotency.items()],
        }

    def restore_snapshot(self, payload: dict[str, Any]) -> None:
        if payload.get("schema") != WORKSPACE_SCHEMA:
            raise ValueError("WORKSPACE_STORAGE_CORRUPT")
        now = time.time()
        self.sessions = {str(key): float(value) for key, value in
                         payload.get("sessions", {}).items() if float(value) > now}
        self.session_labels = {str(key): str(value) for key, value in
                               payload.get("session_labels", {}).items()
                               if str(key) in self.sessions}
        self.captures.clear()
        for raw in payload.get("captures", []):
            if float(raw["created"]) + CAPTURE_TTL <= now:
                continue
            summary = OcrSummary(**raw.get("ocr_summary", {}))
            result = _ocr_result_from_dict(raw["ocr_result"]) if raw.get("ocr_result") else None
            item = Capture(
                id=str(raw["id"]), owner=str(raw["owner"]), side=str(raw["side"]),
                document_id=str(raw["document_id"]),
                original=_text_to_bytes(raw.get("original")) or b"",
                media_type=str(raw["media_type"]), result=dict(raw.get("result", {})),
                rectified=_text_to_bytes(raw.get("rectified")), created=float(raw["created"]),
                review=str(raw.get("review", "pending")), attempt=int(raw.get("attempt", 1)),
                active=bool(raw.get("active", True)), ocr_summary=summary, ocr_result=result,
                generation=int(raw.get("generation", 0)))
            self.captures[item.id] = item
        self.documents.clear()
        for raw in payload.get("documents", []):
            summary = ExtractionSummary(**raw.get("extraction_summary", {}))
            result = _extraction_result_from_dict(raw["extraction_result"]) \
                if raw.get("extraction_result") else None
            source = raw.get("extraction_source")
            item = Document(
                id=str(raw["id"]), owner=str(raw["owner"]),
                card_model=raw.get("card_model", "CNIE_MA_2020"),
                created=float(raw.get("created", now)),
                front_capture_id=raw.get("front_capture_id"),
                back_capture_id=raw.get("back_capture_id"), extraction_summary=summary,
                extraction_result=result,
                extraction_reviews=dict(raw.get("extraction_reviews", {})),
                extraction_source=tuple(source) if source else None,
                identity_id=raw.get("identity_id"))
            self.documents[item.id] = item
        self.approved_identities = {}
        for raw in payload.get("approved_identities", []):
            if float(raw["expires"]) <= now:
                continue
            item = ApprovedIdentity(
                id=str(raw["id"]), owner=str(raw["owner"]),
                document_id=str(raw["document_id"]),
                extraction_revision=int(raw["extraction_revision"]),
                source=str(raw["source"]), card_template=str(raw["card_template"]),
                values=dict(raw.get("values", {})), created=float(raw["created"]),
                expires=float(raw["expires"]),
                images_released=bool(raw.get("images_released", False)))
            self.approved_identities[item.id] = item
        self.document_generation_requests = {}
        for raw in payload.get("document_requests", []):
            item = DocumentGenerationRequestState(
                id=str(raw["id"]), owner=str(raw["owner"]),
                template_id=str(raw["template_id"]),
                template_version=str(raw["template_version"]),
                assignments={key: list(value) for key, value in
                             raw.get("assignments", {}).items()},
                revision=int(raw.get("revision", 0)), created=float(raw.get("created", now)),
                updated=float(raw.get("updated", now)))
            self.document_generation_requests[item.id] = item
        self.idempotency = {
            (str(owner), str(key)): (str(digest), str(capture_id))
            for owner, key, digest, capture_id in payload.get("capture_idempotency", [])
            if str(capture_id) in self.captures
        }
        self.case_mutation_idempotency = {
            (str(owner), str(key)): (str(digest), dict(response))
            for owner, key, digest, response in payload.get("case_idempotency", [])
        }
        self.document_request_idempotency = {
            (str(owner), str(key)): (str(digest), dict(response))
            for owner, key, digest, response in
            payload.get("document_request_idempotency", [])
        }
        self.prune()

    async def persist_workspace(self) -> None:
        if self.workspace_store is not None:
            async with self.persistence_lock:
                payload = copy.deepcopy(self.snapshot())
                try:
                    await run_in_threadpool(self.workspace_store.save, payload, updated=time.time())
                except (WorkspaceStoreError, CredentialError, OSError, sqlite3.Error):
                    self.storage_error = "TEMPORARY_STORAGE_WRITE_FAILED"
                    raise HTTPException(503, "TEMPORARY_STORAGE_WRITE_FAILED") from None
                self.storage_error = None
                for capture in payload["captures"]:
                    if self.pending_ocr_commits.get(capture["id"]) == capture["generation"] \
                            and capture["ocr_summary"]["status"] in {"success", "no_text", "error"} \
                            and capture["ocr_result"] is not None:
                        self.pending_ocr_commits.pop(capture["id"], None)

    def prune(self):
        now = time.time()
        self.sessions = {key: value for key, value in self.sessions.items() if value > now}
        self.session_labels = {key: value for key, value in self.session_labels.items()
                               if key in self.sessions}
        expired = [key for key, value in self.captures.items() if value.created + CAPTURE_TTL <= now]
        for capture_id in expired:
            capture = self.captures.pop(capture_id)
            capture.generation += 1
        expired_identity_ids = {key for key, value in self.approved_identities.items()
                                if value.expires <= now}
        for identity_id in expired_identity_ids:
            self.remove_identity(identity_id)
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
        active_request_ids = set(self.document_generation_requests)
        self.document_request_idempotency = {
            key: value for key, value in self.document_request_idempotency.items()
            if value[1].get("id") in active_request_ids or (
                value[1].get("status") == "deleted"
                and float(value[1].get("deleted_at", 0)) + IDENTITY_TTL > now)
        }
        self.case_store.prune(now)
        active_case_ids = {item.id for item in self.case_store.list()}
        self.case_mutation_idempotency = {
            key: value for key, value in self.case_mutation_idempotency.items()
            if value[1].get("id") in active_case_ids
        }
        self.field_leases.prune(now)

    def clear_temporary_data(self) -> dict[str, int]:
        receipt_catalog = 0
        if self.saved_receipts_path is not None:
            try:
                receipt_catalog = int(self.saved_receipts_path.exists())
                self.saved_receipts_path.unlink(missing_ok=True)
            except OSError:
                raise HTTPException(503, "SAVE_RECEIPT_CLEAR_FAILED") from None
        workspace_snapshot = int(self.workspace_store.clear()) if self.workspace_store else 0
        counts = {
            "cases": self.case_store.clear(),
            "captures": len(self.captures),
            "documents": len(self.documents),
            "approved_identities": len(self.approved_identities),
            "document_requests": len(self.document_generation_requests),
            "mobile_sessions": len(self.sessions),
            "field_leases": self.field_leases.clear(),
            "workspace_snapshot": workspace_snapshot,
            "saved_receipt_catalog": receipt_catalog,
        }
        for capture in self.captures.values():
            capture.generation += 1
            capture.original = b""
            capture.rectified = None
            capture.ocr_result = None
        self.captures.clear()
        self.pending_ocr_commits.clear()
        self.documents.clear()
        self.approved_identities.clear()
        self.document_generation_requests.clear()
        self.document_request_idempotency.clear()
        self.case_mutation_idempotency.clear()
        self.sessions.clear()
        self.session_labels.clear()
        self.idempotency.clear()
        self.pair_code = None
        self.pair_deadline = 0
        while not self.ocr_queue.empty():
            try:
                self.ocr_queue.get_nowait()
                self.ocr_queue.task_done()
            except asyncio.QueueEmpty:
                break
        return counts

    def identity(self, token: str) -> str:
        self.prune()
        if secrets.compare_digest(token, self.desktop_token):
            return "desktop"
        if self.sessions.get(token, 0) > time.time():
            return token
        raise HTTPException(401, "SESSION_EXPIRED")

    def actor_label(self, identity: str) -> str:
        return "Poste Windows" if identity == "desktop" else \
            self.session_labels.get(identity, "Appareil mobile")

    def document_status(self, document: Document) -> str:
        captures = [self.captures[value] for value in document.active_ids() if value in self.captures]
        if any(capture.id in self.pending_ocr_commits for capture in captures):
            return "ocr_pending"
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

    def capture_metadata(self, capture: Capture) -> dict:
        metadata = capture.metadata()
        if capture.id in self.pending_ocr_commits:
            metadata["ocr_summary"] = {**metadata["ocr_summary"], "status": "processing",
                                       "error_code": self.storage_error, "retryable": False}
        return metadata

    def document_metadata(self, document: Document) -> dict:
        return {
            "id": document.id,
            "card_model": document.card_model,
            "created_at": datetime.fromtimestamp(document.created, timezone.utc).isoformat(),
            "source": "desktop" if document.owner == "desktop" else "mobile",
            "front_capture_id": document.front_capture_id,
            "back_capture_id": document.back_capture_id,
            "status": self.document_status(document),
            "extraction_summary": document.extraction_summary.metadata(),
        }

    def invalidate_extraction(self, document: Document) -> None:
        if document.identity_id:
            self.remove_identity(document.identity_id)
            document.identity_id = None
        document.extraction_result = None
        document.extraction_reviews.clear()
        document.extraction_source = None
        document.extraction_summary = ExtractionSummary()

    def remove_identity(self, identity_id: str) -> None:
        self.approved_identities.pop(identity_id, None)
        for request_id, request in list(self.document_generation_requests.items()):
            if any(identity_id in identities for identities in request.assignments.values()):
                self.document_generation_requests.pop(request_id, None)

    def visible_identities(self, identity: str) -> list[ApprovedIdentity]:
        self.prune()
        return [item for item in self.approved_identities.values()
                if identity == "desktop" or item.owner == identity]

    def visible_requests(self, identity: str) -> list[DocumentGenerationRequestState]:
        self.prune()
        return [item for item in self.document_generation_requests.values()
                if identity == "desktop" or item.owner == identity]

    async def broadcast(self, *, persist: bool = True, retry_storage: bool = False):
        if persist and self.workspace_store is not None:
            delay = 1.0
            while True:
                try:
                    await self.persist_workspace()
                    break
                except HTTPException as error:
                    if not retry_storage or error.detail != "TEMPORARY_STORAGE_WRITE_FAILED":
                        raise
                    # Pause background work without resending an OCR request or
                    # notifying clients of a state that has not reached disk.
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 30.0)
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
        self.pending_ocr_commits.pop(capture.id, None)
        capture.generation += 1
        capture.ocr_result = None
        capture.ocr_summary = OcrSummary(status="queued", attempts=capture.ocr_summary.attempts,
                                         queued_at=time.time())
        await self.ocr_queue.put((capture.id, capture.generation))

    async def maintain_workspace(self) -> None:
        while True:
            await asyncio.sleep(MAINTENANCE_INTERVAL_SECONDS)
            self.prune()
            await self.broadcast(retry_storage=True)

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
                await self.broadcast(retry_storage=True)
                current = self.captures.get(capture_id)
                if current is not capture or capture.generation != generation or not capture.active or capture.review != "accepted":
                    continue
                try:
                    result = await run_in_threadpool(self.ocr_engine.recognize, capture.rectified or b"", UUID(capture.id))
                except Exception:
                    result = OcrResult(status=OcrStatus.FAILED, request_id=UUID(capture.id),
                                       error_code="OCR_PROVIDER_UNAVAILABLE", retryable=True)
                current = self.captures.get(capture_id)
                if not current or current.generation != generation or not current.active or current.review != "accepted":
                    continue
                current.ocr_result = result
                self.pending_ocr_commits[current.id] = generation
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
                await self.broadcast(retry_storage=True)
                self.pending_ocr_commits.pop(current.id, None)
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
        await self.broadcast(retry_storage=True)
        if self.documents.get(document.id) is not document or source != (
                document.front_capture_id, front.generation,
                document.back_capture_id, back.generation) or not front.active or not back.active:
            return
        try:
            result = await run_in_threadpool(self.extractor.extract, front.ocr_result, back.ocr_result, UUID(document.id))
            if result.status == ExtractionStatus.REVIEW_REQUIRED and result.template != document.card_model:
                result = ExtractionResult(status=ExtractionStatus.UNSUPPORTED_LAYOUT, request_id=UUID(document.id),
                    error_code="EXTRACTION_CARD_MODEL_MISMATCH")
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
        await self.broadcast(retry_storage=True)


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
               mobile_dist: Path | None = None,
               document_catalog: DocumentTemplateCatalog | None = None,
               case_store: CaseStore | None = None,
               profile_store: ProfileStore | None = None,
               workspace_store: EncryptedWorkspaceStore | None = None,
               saved_receipts_path: Path | None = None) -> FastAPI:
    if credential_store is None or usage_ledger is None or ocr_engine is None:
        default_store, default_usage, default_engine = _default_ocr_components()
        credential_store = credential_store or default_store
        usage_ledger = usage_ledger or default_usage
        ocr_engine = ocr_engine or default_engine
    state = State(desktop_token or secrets.token_urlsafe(32), engine or CnieRectifier(), ocr_engine,
                  extractor or CnieFieldExtractor(),
                  credential_store, usage_ledger, mobile_url, lan_mode,
                  document_catalog or DocumentTemplateCatalog(), case_store or InMemoryCaseStore(),
                  profile_store or InMemoryProfileStore(), workspace_store, saved_receipts_path)
    if workspace_store is not None:
        restored = workspace_store.load()
        if restored is not None:
            state.restore_snapshot(restored)

    @asynccontextmanager
    async def lifespan(_app):
        for capture in list(state.captures.values()):
            if capture.active and capture.review == "accepted" \
                    and capture.ocr_summary.status in {"queued", "processing"} \
                    and capture.ocr_summary.attempts < MAX_OCR_ATTEMPTS:
                await state.queue_ocr(capture)
        if workspace_store is not None:
            await state.persist_workspace()
        cleanup_task = asyncio.create_task(state.maintain_workspace())
        worker_task = asyncio.create_task(state.ocr_worker())
        state.cleanup_task = cleanup_task
        state.worker_task = worker_task
        try:
            yield
        finally:
            cleanup_task.cancel()
            worker_task.cancel()
            await asyncio.gather(cleanup_task, worker_task, return_exceptions=True)
            try:
                if workspace_store is not None:
                    await state.persist_workspace()
            finally:
                state.captures.clear()
                state.documents.clear()
                state.approved_identities.clear()
                state.document_generation_requests.clear()
                state.document_request_idempotency.clear()
                state.case_mutation_idempotency.clear()
                state.sessions.clear()
                state.session_labels.clear()
                state.idempotency.clear()

    app = FastAPI(title="e-notario · Capture service", version="0.8.0-alpha.3", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.capture = state
    @app.exception_handler(UsageStorageError)
    async def usage_storage_error(_request, error):
        return JSONResponse(status_code=503, content={"detail": str(error)})
    app.add_middleware(CORSMiddleware,
        allow_origins=["http://localhost:1420", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"],
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
        expose_headers=["Content-Disposition", "X-eNotario-Case-Revision",
                        "X-eNotario-Document-Request-Revision"])
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

    def owned_generation_request(request_id: UUID, identity: str) -> DocumentGenerationRequestState:
        item = state.document_generation_requests.get(str(request_id))
        if item is None or (identity != "desktop" and item.owner != identity):
            raise HTTPException(404, "DOCUMENT_REQUEST_NOT_FOUND")
        return item

    def case_http_error(exc: CaseError) -> HTTPException:
        if exc.args and exc.args[0] == "CASE_NOT_FOUND":
            return HTTPException(404, "CASE_NOT_FOUND")
        if exc.args and exc.args[0] in {"CASE_STORAGE_CORRUPT", "CASE_STORAGE_DECRYPT_FAILED"}:
            return HTTPException(500, exc.args[0])
        if exc.args and exc.args[0] == "CASE_STALE_REVISION":
            return HTTPException(409, "CASE_STALE_REVISION")
        return HTTPException(409, exc.args[0] if exc.args else "CASE_INVALID")

    def lease_http_error(exc: FieldLeaseError) -> HTTPException:
        code = exc.args[0] if exc.args else "CASE_FIELD_LEASE_INVALID"
        return HTTPException(409, code)

    def profile_http_error(exc: ProfileError) -> HTTPException:
        code = exc.args[0] if exc.args else "PROFILE_INVALID"
        if code == "PROFILE_NOT_FOUND":
            return HTTPException(404, code)
        if code in {"PROFILE_STORAGE_CORRUPT", "PROFILE_STORAGE_DECRYPT_FAILED",
                    "PROFILE_STORAGE_WRITE_FAILED"}:
            return HTTPException(500, code)
        return HTTPException(409, code)

    def profile_usage_counts() -> dict[str, int]:
        """Count retained drafts per profile, including historical templates."""
        counts: dict[str, int] = {}
        for draft in state.case_store.list():
            referenced = {
                identifier
                for value in draft.fields.values()
                for identifier in (value if isinstance(value, list) else [value])
                if isinstance(identifier, str)
            }
            for identifier in referenced:
                counts[identifier] = counts.get(identifier, 0) + 1
        return counts

    def profile_metadata(item: ProfessionalProfile,
                         usage_counts: dict[str, int]) -> dict[str, Any]:
        usage_count = usage_counts.get(item.id, 0)
        return {**item.to_dict(), "in_use": usage_count > 0, "usage_count": usage_count}

    def owned_case(case_id: UUID, identity: str) -> CaseDraft:
        try:
            item = state.case_store.get(str(case_id))
        except CaseError as exc:
            raise case_http_error(exc) from None
        if item is None or (identity != "desktop" and item.owner != identity):
            raise HTTPException(404, "CASE_NOT_FOUND")
        return item

    def template_http_error(exc: DocumentTemplateError) -> HTTPException:
        status = 404 if exc.code == "DOCUMENT_TEMPLATE_NOT_FOUND" else 409
        if exc.code in {"DOCUMENT_TEMPLATE_INTEGRITY_FAILED", "DOCUMENT_TEMPLATE_INVALID",
                        "DOCUMENT_GENERATION_FAILED"}:
            status = 500
        return HTTPException(status, exc.code)

    def validated_assignments(template_id: str, template_version: str,
                              assignments: dict[str, list[UUID]], identity: str
                              ) -> tuple[dict[str, list[str]], dict[str, list[dict[str, Any]]]]:
        try:
            template = state.document_catalog.get(template_id, template_version)
        except DocumentTemplateError as exc:
            raise template_http_error(exc) from None
        roles = {role.key: role for role in template.roles}
        if set(assignments) - set(roles):
            raise HTTPException(409, "DOCUMENT_ROLE_INVALID")
        normalized: dict[str, list[str]] = {}
        values: dict[str, list[dict[str, Any]]] = {}
        for role_key, role in roles.items():
            selected = [str(value) for value in assignments.get(role_key, [])]
            if len(selected) != len(set(selected)) or not role.minimum <= len(selected) <= role.maximum:
                raise HTTPException(409, "DOCUMENT_ROLE_INVALID")
            resolved: list[dict[str, Any]] = []
            for identity_id in selected:
                approved = state.approved_identities.get(identity_id)
                if approved is None or approved.expires <= time.time():
                    raise HTTPException(409, "APPROVED_IDENTITY_EXPIRED")
                if identity != "desktop" and approved.owner != identity:
                    raise HTTPException(403, "APPROVED_IDENTITY_FORBIDDEN")
                resolved.append(approved.values)
            normalized[role_key] = selected
            values[role_key] = resolved
        return normalized, values

    def require_mutation_key(request: Request) -> str:
        key = request.headers.get("Idempotency-Key", "")
        try:
            UUID(key)
        except ValueError:
            raise HTTPException(400, "IDEMPOTENCY_KEY_REQUIRED") from None
        return key

    def request_digest(action: str, payload: Any) -> str:
        canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(f"{action}:{canonical}".encode("utf-8")).hexdigest()

    def remember_document_mutation(identity: str, key: str, digest: str,
                                   response: dict[str, Any]) -> None:
        state.document_request_idempotency[(identity, key)] = (digest, response)
        while len(state.document_request_idempotency) > 512:
            state.document_request_idempotency.pop(next(iter(state.document_request_idempotency)))

    def remember_case_mutation(identity: str, key: str, digest: str,
                               response: dict[str, Any]) -> None:
        state.case_mutation_idempotency[(identity, key)] = (digest, response)
        while len(state.case_mutation_idempotency) > 512:
            state.case_mutation_idempotency.pop(next(iter(state.case_mutation_idempotency)))

    def validate_case_template(template_id: str, template_version: str):
        try:
            return state.document_catalog.get(template_id, template_version)
        except DocumentTemplateError as exc:
            raise template_http_error(exc) from None

    def validate_case_field_key(item: CaseDraft, field_key: str) -> None:
        template = validate_case_template(item.template_id, item.template_version)
        if field_key.startswith("role."):
            if field_key[5:] not in {role.key for role in template.roles}:
                raise HTTPException(409, "DOCUMENT_ROLE_INVALID")
            return
        if item.mode != "complete":
            raise HTTPException(409, "CASE_FIELDS_REQUIRE_COMPLETE_MODE")
        if field_key not in {definition.key for definition in template.fields}:
            raise HTTPException(409, "CASE_FIELD_INVALID")

    def normalize_case_assignments(item: CaseDraft, raw: dict[str, list[UUID]], identity: str
                                   ) -> dict[str, list[str]]:
        template = validate_case_template(item.template_id, item.template_version)
        roles = {role.key: role for role in template.roles}
        if set(raw) - set(roles):
            raise HTTPException(409, "DOCUMENT_ROLE_INVALID")
        normalized = validate_case_assignments({key: [str(value) for value in values]
                                                for key, values in raw.items()})
        for role, identity_ids in normalized.items():
            if len(identity_ids) > roles[role].maximum:
                raise HTTPException(409, "DOCUMENT_ROLE_INVALID")
            for identity_id in identity_ids:
                approved = state.approved_identities.get(identity_id)
                if approved is None or approved.expires <= time.time():
                    raise HTTPException(409, "APPROVED_IDENTITY_EXPIRED")
                if identity != "desktop" and approved.owner != identity:
                    raise HTTPException(403, "APPROVED_IDENTITY_FORBIDDEN")
        return normalized

    def normalize_case_fields(item: CaseDraft, raw: dict[str, str | list[str] | None]
                              ) -> dict[str, str | list[str] | None]:
        template = validate_case_template(item.template_id, item.template_version)
        definitions = {field.key: field for field in template.fields}
        if set(raw) - set(definitions):
            raise HTTPException(409, "CASE_FIELD_INVALID")
        try:
            normalized = validate_fields(raw)
        except CaseError as exc:
            raise case_http_error(exc) from None
        for key, value in normalized.items():
            definition = definitions[key]
            values = value if isinstance(value, list) else [value]
            if isinstance(value, list) != (len(definition.tags) > 1):
                raise HTTPException(409, "CASE_FIELD_INVALID")
            if len(values) > len(definition.tags):
                raise HTTPException(409, "CASE_FIELD_INVALID")
            for part in values:
                if part is None:
                    continue
                if len(part) > definition.maximum_characters:
                    raise HTTPException(409, "CASE_FIELD_TOO_LONG")
                if definition.field_type == "date" and part:
                    try:
                        datetime.strptime(part, "%Y-%m-%d")
                    except ValueError:
                        raise HTTPException(409, "CASE_FIELD_INVALID") from None
                if definition.field_type == "number" and part \
                        and not re.fullmatch(r"[0-9]+(?:[/.-][0-9]+)*", part):
                    raise HTTPException(409, "CASE_FIELD_INVALID")
                if definition.field_type == "professional_profile" and part:
                    try:
                        UUID(part)
                    except ValueError:
                        # One-off professional names are stored directly in the
                        # encrypted case instead of polluting the reusable list.
                        continue
                    profile = state.profile_store.get(part)
                    if profile is None or not profile.active:
                        raise HTTPException(409, "PROFESSIONAL_PROFILE_INVALID")
        return normalized

    def resolved_case_fields(item: CaseDraft) -> dict[str, str | list[str] | None]:
        template = validate_case_template(item.template_id, item.template_version)
        definitions = {field.key: field for field in template.fields}
        resolved = dict(item.fields)
        for key, value in list(resolved.items()):
            definition = definitions.get(key)
            if definition is None or definition.field_type != "professional_profile" or value is None:
                continue
            identifiers = value if isinstance(value, list) else [value]
            names: list[str] = []
            for identifier in identifiers:
                profile = state.profile_store.get(identifier)
                if profile is None:
                    names.append(identifier.strip())
                elif not profile.active:
                    raise HTTPException(409, "PROFESSIONAL_PROFILE_INVALID")
                else:
                    names.append(profile.display_name_ar)
            resolved[key] = names if isinstance(value, list) else names[0]
        return resolved

    def remap_case_role_fields(item: CaseDraft, assignments: dict[str, list[str]],
                               explicit_fields: set[str] | None = None) -> None:
        template = validate_case_template(item.template_id, item.template_version)
        for definition in template.fields:
            if not definition.role or definition.key in (explicit_fields or set()):
                continue
            previous = item.fields.get(definition.key)
            if not isinstance(previous, list):
                continue
            old_ids = item.assignments.get(definition.role, [])
            new_ids = assignments.get(definition.role, [])
            by_identity = dict(zip(old_ids, previous))
            item.fields[definition.key] = [by_identity.get(key, "") for key in new_ids]

    def validate_role_field_lengths(item: CaseDraft) -> None:
        template = validate_case_template(item.template_id, item.template_version)
        for definition in template.fields:
            values = item.fields.get(definition.key)
            if definition.role and isinstance(values, list) and \
                    len(values) > len(item.assignments.get(definition.role, [])):
                raise HTTPException(409, "CASE_ASSIGNMENT_CONTEXT_CHANGED")

    def case_missing_fields(item: CaseDraft) -> list[str]:
        if item.mode != "complete":
            return []
        template = validate_case_template(item.template_id, item.template_version)
        missing: list[str] = []
        for field_definition in template.fields:
            if not field_definition.required:
                continue
            value = item.fields.get(field_definition.key)
            if value is None or (isinstance(value, str) and not value.strip()) \
                    or (isinstance(value, list) and not any(part.strip() for part in value)):
                missing.append(field_definition.key)
                continue
            if field_definition.field_type == "professional_profile":
                identifiers = value if isinstance(value, list) else [value]
                if any(state.profile_store.get(identifier) is not None
                       and not state.profile_store.get(identifier).active for identifier in identifiers):
                    missing.append(field_definition.key)
        return missing

    def repeated_role_warnings(assignments: dict[str, list[str]]) -> list[str]:
        seen: dict[str, str] = {}
        warnings: list[str] = []
        for role, identity_ids in assignments.items():
            for identity_id in identity_ids:
                previous = seen.get(identity_id)
                if previous and previous != role:
                    warnings.append("IDENTITY_ASSIGNED_TO_MULTIPLE_ROLES")
                else:
                    seen[identity_id] = role
        return sorted(set(warnings))

    def visible_request_metadata(item: DocumentGenerationRequestState, identity: str) -> dict[str, Any]:
        metadata = item.metadata()
        if identity != "desktop":
            owned_ids = {approved.id for approved in state.approved_identities.values()
                         if approved.owner == identity}
            metadata["assignments"] = {
                role: [identity_id for identity_id in identity_ids if identity_id in owned_ids]
                for role, identity_ids in item.assignments.items()
            }
        metadata["warnings"] = repeated_role_warnings(metadata["assignments"])
        return metadata

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.8.0-alpha.3", "api_version": 2,
                "background": {
                    "ocr_worker": "running" if state.worker_task and not state.worker_task.done() else "stopped",
                    "maintenance": "running" if state.cleanup_task and not state.cleanup_task.done() else "stopped",
                    "storage_error": state.storage_error,
                }}

    @app.get("/api/document-templates")
    def document_templates(_identity: str = Depends(user)):
        return state.document_catalog.summaries()

    @app.get("/api/document-templates/{template_id}")
    def document_template_version(template_id: str, version: str,
                                   _identity: str = Depends(user)):
        try:
            return state.document_catalog.get(template_id, version).to_summary()
        except DocumentTemplateError as exc:
            raise template_http_error(exc) from None

    @app.get("/api/professional-profiles")
    async def professional_profiles(identity: str = Depends(user)):
        try:
            async with state.case_lock:
                values = state.profile_store.list(include_inactive=identity == "desktop")
                usage_counts = profile_usage_counts() if identity == "desktop" else {}
                return [profile_metadata(item, usage_counts) for item in values]
        except (CaseError, ProfileError) as exc:
            if isinstance(exc, CaseError):
                raise case_http_error(exc) from None
            raise profile_http_error(exc) from None

    @app.post("/api/professional-profiles", status_code=201)
    async def create_professional_profile(body: ProfileCreateRequest,
                                          _identity: str = Depends(desktop)):
        try:
            item = ProfessionalProfile.create(display_name_ar=body.display_name_ar,
                                              display_name_fr=body.display_name_fr,
                                              function_fr=body.function_fr,
                                              profile_id=str(body.id) if body.id else None)
            async with state.case_lock:
                existing = state.profile_store.get(item.id)
                if existing is not None:
                    if (existing.display_name_ar, existing.display_name_fr, existing.function_fr) != \
                            (item.display_name_ar, item.display_name_fr, item.function_fr):
                        raise ProfileError("PROFILE_ALREADY_EXISTS")
                    result = profile_metadata(existing, profile_usage_counts())
                    created = False
                else:
                    result = profile_metadata(state.profile_store.create(item), {})
                    created = True
        except (CaseError, ProfileError) as exc:
            if isinstance(exc, CaseError):
                raise case_http_error(exc) from None
            raise profile_http_error(exc) from None
        if created:
            await state.broadcast()
        return result

    @app.patch("/api/professional-profiles/{profile_id}")
    async def update_professional_profile(profile_id: UUID, body: ProfileUpdateRequest,
                                          _identity: str = Depends(desktop)):
        try:
            async with state.case_lock:
                item = state.profile_store.get(str(profile_id))
                if item is None:
                    raise ProfileError("PROFILE_NOT_FOUND")
                desired = ProfessionalProfile.from_payload(item.payload())
                desired.display_name_ar = body.display_name_ar
                desired.display_name_fr = body.display_name_fr
                desired.function_fr = body.function_fr
                desired.active = body.active
                desired.__post_init__()
                desired_values = (desired.display_name_ar, desired.display_name_fr,
                                  desired.function_fr, desired.active)
                current_values = (item.display_name_ar, item.display_name_fr,
                                  item.function_fr, item.active)
                usage_counts = profile_usage_counts()
                if item.revision != body.revision:
                    if item.revision == body.revision + 1 and current_values == desired_values:
                        result = profile_metadata(item, usage_counts)
                        changed = False
                    else:
                        raise ProfileError("PROFILE_STALE_REVISION")
                else:
                    if item.active and not desired.active and usage_counts.get(item.id, 0):
                        raise ProfileError("PROFILE_IN_USE")
                    result = profile_metadata(
                        state.profile_store.save(desired, expected_revision=body.revision),
                        usage_counts)
                    changed = True
        except (CaseError, ProfileError) as exc:
            if isinstance(exc, CaseError):
                raise case_http_error(exc) from None
            raise profile_http_error(exc) from None
        if changed:
            await state.broadcast()
        return result

    @app.delete("/api/professional-profiles/{profile_id}")
    async def delete_professional_profile(profile_id: UUID,
                                          _identity: str = Depends(desktop)):
        try:
            async with state.case_lock:
                item = state.profile_store.get(str(profile_id))
                if item is None:
                    raise ProfileError("PROFILE_NOT_FOUND")
                if profile_usage_counts().get(item.id, 0):
                    raise ProfileError("PROFILE_IN_USE")
                if item.active:
                    raise ProfileError("PROFILE_DELETE_REQUIRES_INACTIVE")
                if not state.profile_store.delete(item.id):
                    raise ProfileError("PROFILE_NOT_FOUND")
        except (CaseError, ProfileError) as exc:
            if isinstance(exc, CaseError):
                raise case_http_error(exc) from None
            raise profile_http_error(exc) from None
        await state.broadcast()
        return {"status": "deleted", "id": str(profile_id)}

    @app.get("/api/cases")
    def list_cases(identity: str = Depends(user)):
        try:
            return [item.summary() for item in state.case_store.list()
                    if identity == "desktop" or item.owner == identity]
        except CaseError as exc:
            raise case_http_error(exc) from None

    @app.post("/api/cases", status_code=201)
    async def create_case(body: CaseCreateRequest, request: Request,
                          identity: str = Depends(user)):
        key = require_mutation_key(request)
        digest = request_digest("case-create", body.model_dump(mode="json"))
        previous = state.case_mutation_idempotency.get((identity, key))
        if previous:
            if previous[0] != digest:
                raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
            await state.persist_workspace()
            return previous[1]
        validate_case_template(body.template_id, body.template_version)
        item = CaseDraft.create(owner=identity, template_id=body.template_id,
                                template_version=body.template_version, mode=body.mode)
        try:
            response = state.case_store.create(item).detail()
        except CaseError as exc:
            raise case_http_error(exc) from None
        remember_case_mutation(identity, key, digest, response)
        await state.broadcast()
        return response

    @app.get("/api/cases/{case_id}")
    def get_case(case_id: UUID, identity: str = Depends(user)):
        return owned_case(case_id, identity).detail()

    @app.get("/api/cases/{case_id}/readiness")
    def case_readiness(case_id: UUID, identity: str = Depends(user)):
        item = owned_case(case_id, identity)
        missing_roles: list[str] = []
        template = validate_case_template(item.template_id, item.template_version)
        for role in template.roles:
            if len(item.assignments.get(role.key, [])) < role.minimum:
                missing_roles.append(role.key)
        missing_fields = case_missing_fields(item)
        return {
            "case_id": item.id, "revision": item.revision,
            "missing_roles": missing_roles, "missing_fields": missing_fields,
            "ready": not missing_roles and not missing_fields,
            "can_generate_with_confirmation": not missing_roles,
        }

    @app.get("/api/cases/{case_id}/field-leases")
    def case_field_leases(case_id: UUID, identity: str = Depends(user)):
        item = owned_case(case_id, identity)
        return [{**lease.public(), "owned_by_me": lease.identity == identity}
                for lease in state.field_leases.list(item.id)]

    @app.post("/api/cases/{case_id}/field-leases")
    async def acquire_case_field_lease(case_id: UUID, body: FieldLeaseRequest,
                                       identity: str = Depends(user)):
        try:
            async with state.case_lock:
                item = owned_case(case_id, identity)
                if item.status != "editing":
                    raise HTTPException(409, "CASE_NOT_EDITABLE")
                validate_case_field_key(item, body.field_key)
                lease = state.field_leases.acquire(
                    case_id=item.id, field_key=body.field_key, identity=identity,
                    actor_label=state.actor_label(identity), token=body.lease_token)
        except FieldLeaseError as exc:
            raise lease_http_error(exc) from None
        await state.broadcast(persist=False)
        return {**lease.public(), "lease_token": lease.token, "owned_by_me": True}

    @app.delete("/api/cases/{case_id}/field-leases")
    async def release_case_field_lease(case_id: UUID, body: FieldLeaseReleaseRequest,
                                       identity: str = Depends(user)):
        item = owned_case(case_id, identity)
        try:
            async with state.case_lock:
                state.field_leases.release(case_id=item.id, field_key=body.field_key,
                                           identity=identity, token=body.lease_token)
        except FieldLeaseError as exc:
            raise lease_http_error(exc) from None
        await state.broadcast(persist=False)
        return {"status": "released", "field_key": body.field_key}

    @app.patch("/api/cases/{case_id}/fields/{field_key}")
    async def patch_case_field(case_id: UUID, field_key: str, body: CaseFieldPatchRequest,
                               request: Request, identity: str = Depends(user)):
        key = require_mutation_key(request)
        digest = request_digest("case-field-patch", {
            "id": str(case_id), "field_key": field_key, "value": body.value,
            "assignment_context": [str(value) for value in body.assignment_context]
            if body.assignment_context is not None else None,
        })
        previous = state.case_mutation_idempotency.get((identity, key))
        if previous:
            if previous[0] != digest:
                raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
            await state.persist_workspace()
            return previous[1]
        try:
            async with state.case_lock:
                item = owned_case(case_id, identity)
                if item.status != "editing":
                    raise HTTPException(409, "CASE_NOT_EDITABLE")
                validate_case_field_key(item, field_key)
                template = validate_case_template(item.template_id, item.template_version)
                definition = next((field for field in template.fields if field.key == field_key), None)
                if definition is None:
                    raise HTTPException(409, "CASE_FIELD_INVALID")
                if definition.role and (
                        body.assignment_context is None or
                        [str(value) for value in body.assignment_context] !=
                        item.assignments.get(definition.role, [])):
                    raise HTTPException(409, "CASE_ASSIGNMENT_CONTEXT_CHANGED")
                current_lease = state.field_leases.require(
                    case_id=item.id, field_key=field_key,
                    identity=identity, token=body.lease_token)
                normalized = normalize_case_fields(item, {field_key: body.value})
                item.fields = {**item.fields, **normalized}
                validate_role_field_lengths(item)
                saved = state.case_store.save(item, expected_revision=item.revision)
                lease = state.field_leases.acquire(
                    case_id=item.id, field_key=field_key, identity=identity,
                    actor_label=current_lease.actor_label,
                    token=body.lease_token)
                response = {**saved.detail(), "field_lease": {
                    **lease.public(), "lease_token": lease.token, "owned_by_me": True,
                }}
                remember_case_mutation(identity, key, digest, response)
        except (CaseError, FieldLeaseError) as exc:
            if isinstance(exc, CaseError):
                raise case_http_error(exc) from None
            raise lease_http_error(exc) from None
        await state.broadcast()
        return response

    @app.patch("/api/cases/{case_id}")
    async def update_case(case_id: UUID, body: CaseUpdateRequest, request: Request,
                          identity: str = Depends(user)):
        key = require_mutation_key(request)
        digest = request_digest("case-update", {"id": str(case_id), **body.model_dump(mode="json")})
        previous = state.case_mutation_idempotency.get((identity, key))
        if previous:
            if previous[0] != digest:
                raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
            await state.persist_workspace()
            return previous[1]
        item = owned_case(case_id, identity)
        if item.status != "editing":
            raise HTTPException(409, "CASE_NOT_EDITABLE")
        if item.revision != body.revision:
            raise HTTPException(409, "CASE_STALE_REVISION")
        if body.fields is not None:
            if item.mode != "complete" and body.fields:
                raise HTTPException(409, "CASE_FIELDS_REQUIRE_COMPLETE_MODE")
            normalized_fields = normalize_case_fields(item, body.fields)
            changed_keys = {field_key for field_key in set(item.fields) | set(normalized_fields)
                            if item.fields.get(field_key) != normalized_fields.get(field_key)}
            if any(lease.identity != identity and lease.field_key in changed_keys
                   for lease in state.field_leases.list(item.id)):
                raise HTTPException(409, "CASE_FIELD_LOCKED")
            item.fields = normalized_fields
        if body.assignments is not None:
            try:
                normalized_roles = normalize_case_assignments(item, body.assignments, identity)
                changed_roles = {f"role.{role_key}" for role_key in
                                 set(item.assignments) | set(normalized_roles)
                                 if item.assignments.get(role_key) != normalized_roles.get(role_key)}
                if any(lease.identity != identity and lease.field_key in changed_roles
                       for lease in state.field_leases.list(item.id)):
                    raise HTTPException(409, "CASE_FIELD_LOCKED")
                remap_case_role_fields(item, normalized_roles, set(body.fields or {}))
                item.assignments = normalized_roles
            except CaseError as exc:
                raise case_http_error(exc) from None
        try:
            validate_role_field_lengths(item)
            response = state.case_store.save(item, expected_revision=body.revision).detail()
        except CaseError as exc:
            raise case_http_error(exc) from None
        remember_case_mutation(identity, key, digest, response)
        await state.broadcast()
        return response

    @app.patch("/api/cases/{case_id}/assignments/{role_key}")
    async def patch_case_role(case_id: UUID, role_key: str, body: CaseRolePatchRequest,
                              request: Request, identity: str = Depends(user)):
        key = require_mutation_key(request)
        digest = request_digest("case-role-patch", {
            "id": str(case_id), "role_key": role_key,
            "value": [str(value) for value in body.value],
        })
        try:
            async with state.case_lock:
                item = owned_case(case_id, identity)
                previous = state.case_mutation_idempotency.get((identity, key))
                if previous:
                    if previous[0] != digest:
                        raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
                    await state.persist_workspace()
                    return previous[1]
                if item.status != "editing":
                    raise HTTPException(409, "CASE_NOT_EDITABLE")
                lease_key = f"role.{role_key}"
                validate_case_field_key(item, lease_key)
                current_lease = state.field_leases.require(
                    case_id=item.id, field_key=lease_key,
                    identity=identity, token=body.lease_token)
                normalized = normalize_case_assignments(item, {role_key: body.value}, identity)
                assignments = {**item.assignments, **normalized}
                remap_case_role_fields(item, assignments)
                item.assignments = assignments
                saved = state.case_store.save(item, expected_revision=item.revision)
                lease = state.field_leases.acquire(
                    case_id=item.id, field_key=lease_key, identity=identity,
                    actor_label=current_lease.actor_label, token=body.lease_token)
                response = {**saved.detail(), "field_lease": {
                    **lease.public(), "lease_token": lease.token, "owned_by_me": True,
                }}
                remember_case_mutation(identity, key, digest, response)
        except (CaseError, FieldLeaseError) as exc:
            if isinstance(exc, CaseError):
                raise case_http_error(exc) from None
            raise lease_http_error(exc) from None
        await state.broadcast()
        return response

    @app.post("/api/cases/{case_id}/final-review")
    async def begin_case_final_review(case_id: UUID, body: CaseRevisionRequest,
                                      identity: str = Depends(user)):
        item = owned_case(case_id, identity)
        if item.status != "editing":
            raise HTTPException(409, "CASE_NOT_EDITABLE")
        if item.revision != body.revision:
            raise HTTPException(409, "CASE_STALE_REVISION")
        if state.field_leases.list(item.id):
            raise HTTPException(409, "CASE_EDITORS_ACTIVE")
        uuid_assignments = {role: [UUID(value) for value in values]
                            for role, values in item.assignments.items()}
        validated_assignments(item.template_id, item.template_version, uuid_assignments, identity)
        item.status = "final_review"
        try:
            saved = state.case_store.save(item, expected_revision=body.revision)
        except CaseError as exc:
            raise case_http_error(exc) from None
        state.field_leases.clear_case(item.id)
        await state.broadcast()
        return saved.detail()

    @app.post("/api/cases/{case_id}/reopen")
    async def reopen_case(case_id: UUID, body: CaseRevisionRequest,
                          _identity: str = Depends(desktop)):
        item = owned_case(case_id, "desktop")
        if item.status not in {"final_review", "completed"}:
            raise HTTPException(409, "CASE_NOT_IN_FINAL_REVIEW")
        if item.revision != body.revision:
            raise HTTPException(409, "CASE_STALE_REVISION")
        item.status = "editing"
        try:
            saved = state.case_store.save(item, expected_revision=body.revision)
        except CaseError as exc:
            raise case_http_error(exc) from None
        await state.broadcast()
        return saved.detail()

    @app.post("/api/cases/{case_id}/generate")
    async def generate_case(case_id: UUID, body: CaseGenerateRequest,
                            _identity: str = Depends(desktop)):
        item = owned_case(case_id, "desktop")
        if item.status != "final_review":
            raise HTTPException(409, "CASE_NOT_IN_FINAL_REVIEW")
        if item.revision != body.revision:
            raise HTTPException(409, "CASE_STALE_REVISION")
        uuid_assignments = {role: [UUID(value) for value in values]
                            for role, values in item.assignments.items()}
        _, values = validated_assignments(item.template_id, item.template_version,
                                          uuid_assignments, "desktop")
        try:
            payload, slug = await run_in_threadpool(
                state.document_catalog.render, item.template_id, item.template_version, values,
                resolved_case_fields(item) if item.mode == "complete" else None)
        except DocumentTemplateError as exc:
            raise template_http_error(exc) from None
        current = owned_case(case_id, "desktop")
        if current.revision != item.revision or current.status != "final_review":
            raise HTTPException(409, "CASE_STALE_REVISION")
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        return Response(payload,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": f'attachment; filename="{slug}-{timestamp}.docx"',
                "X-eNotario-Case-Revision": str(item.revision),
            })

    @app.post("/api/cases/{case_id}/complete")
    async def complete_case(case_id: UUID, body: CaseRevisionRequest,
                            _identity: str = Depends(desktop)):
        item = owned_case(case_id, "desktop")
        if item.status == "completed" and item.revision == body.revision + 1:
            return item.detail()
        if item.status != "final_review":
            raise HTTPException(409, "CASE_NOT_IN_FINAL_REVIEW")
        if item.revision != body.revision:
            raise HTTPException(409, "CASE_STALE_REVISION")
        item.status = "completed"
        try:
            saved = state.case_store.save(item, expected_revision=body.revision)
        except CaseError as exc:
            raise case_http_error(exc) from None
        await state.broadcast()
        return saved.detail()

    @app.delete("/api/cases/{case_id}")
    async def delete_case(case_id: UUID, identity: str = Depends(user)):
        item = owned_case(case_id, identity)
        try:
            state.case_store.delete(item.id)
        except CaseError as exc:
            raise case_http_error(exc) from None
        state.field_leases.clear_case(item.id)
        await state.broadcast()
        return {"status": "deleted", "id": item.id}

    @app.delete("/api/temporary-data")
    async def clear_temporary_data(body: ClearTemporaryDataRequest,
                                   _identity: str = Depends(desktop)):
        async with state.lock, state.case_lock, state.persistence_lock:
            counts = state.clear_temporary_data()
        await state.broadcast()
        return {"status": "cleared", "deleted": counts}

    @app.get("/api/workspace")
    def workspace(identity: str = Depends(user)):
        visible_documents = [document for document in state.documents.values()
                             if identity == "desktop" or document.owner == identity]
        visible_ids = {document.id for document in visible_documents}
        return {
            "documents": [state.document_metadata(document) for document in reversed(visible_documents)],
            "captures": [state.capture_metadata(capture) for capture in reversed(list(state.captures.values()))
                         if capture.document_id in visible_ids],
            "connected_devices": len(state.sessions) if identity == "desktop" else 1,
            "processing": state.processing,
            "storage_error": state.storage_error,
            "mobile_url": state.mobile_url if identity == "desktop" else None,
            "lan_mode": state.lan_mode if identity == "desktop" else None,
            "retention_minutes": CAPTURE_TTL // 60,
            "approved_identities": [item.summary() for item in reversed(state.visible_identities(identity))],
            "document_generation_requests": [
                visible_request_metadata(item, identity)
                for item in reversed(state.visible_requests(identity))
            ],
            "case_drafts": [item.summary() for item in state.case_store.list()
                            if identity == "desktop" or item.owner == identity],
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
        operator_name = " ".join(body.operator_name.split())
        device_name = " ".join(body.device_name.split())
        if not operator_name or not device_name:
            raise HTTPException(400, "PAIRING_ACTOR_REQUIRED")
        state.sessions[token] = time.time() + SESSION_TTL
        state.session_labels[token] = f"{operator_name} · {device_name}"
        await state.broadcast()
        return {"token": token, "expires_at": state.sessions[token],
                "actor_label": state.session_labels[token]}

    @app.delete("/api/pairing")
    async def disconnect(_=Depends(desktop)):
        state.sessions.clear()
        state.session_labels.clear()
        state.pair_code = None
        await state.broadcast()
        return {"status": "disconnected"}

    @app.post("/api/captures")
    async def upload(request: Request, side: Literal["front", "back"] = "front",
                     document_id: UUID | None = None,
                     card_model: Literal["CNIE_MA_2020", "CNIE_MA_LEGACY"] = "CNIE_MA_2020",
                     identity: str = Depends(user)):
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
            if document and document.card_model != card_model:
                raise HTTPException(409, "DOCUMENT_CARD_MODEL_LOCKED")
            if len(state.captures) >= 30:
                raise HTTPException(409, "CAPTURE_LIMIT_DELETE_FIRST")
            used = sum(len(capture.original) + len(capture.rectified or b"") for capture in state.captures.values())
            limit = min(MAX_UPLOAD, MAX_MEMORY - used - 10 * 1024 * 1024)
            payload = bytearray()
            async for chunk in request.stream():
                if len(payload) + len(chunk) > limit:
                    raise HTTPException(413, "IMAGE_TOO_LARGE")
                payload.extend(chunk)
            digest = hashlib.sha256(payload).hexdigest() + side + str(document_id or "") + card_model
            previous = state.idempotency.get((identity, key))
            if previous:
                if previous[0] != digest:
                    raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
                await state.persist_workspace()
                return state.captures[previous[1]].metadata()
            state.processing = True
            try:
                result = await run_in_threadpool(state.engine.rectify, bytes(payload))
                metadata = result.to_dict()
                for name in ("opencv", "docquadnet"):
                    metadata.get(name, {}).pop("error", None)
                if document is None:
                    document = Document(str(uuid4()), identity, card_model=card_model)
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
                # A successful local geometry/quality result is the image gate.
                # Human approval remains mandatory for the extracted CNIE fields.
                capture.review = "accepted" if metadata["status"] == "success" else "retake"
                state.captures[capture.id] = capture
                if side == "front":
                    document.front_capture_id = capture.id
                else:
                    document.back_capture_id = capture.id
                state.idempotency[(identity, key)] = (digest, capture.id)
                if capture.review == "accepted":
                    await state.queue_ocr(capture)
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
            return state.capture_metadata(capture)
        if variant == "ocr":
            if identity != "desktop":
                raise HTTPException(403, "DESKTOP_ONLY")
            if capture.id in state.pending_ocr_commits:
                raise HTTPException(503, "TEMPORARY_STORAGE_WRITE_FAILED")
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
        if capture.id in state.pending_ocr_commits:
            raise HTTPException(503, "TEMPORARY_STORAGE_WRITE_FAILED")
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
            "schema_version": "cnie.ma.legacy/v1" if result.template == "CNIE_MA_LEGACY" else "cnie.ma.2020/v2",
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
        if len(state.approved_identities) >= MAX_APPROVED_IDENTITIES:
            raise HTTPException(409, "APPROVED_IDENTITY_LIMIT")
        document.extraction_summary.status = "approved"
        document.extraction_summary.approved_at = time.time()
        document.extraction_summary.approved_by = "desktop" if identity == "desktop" else "mobile"
        identity_id = str(uuid4())
        snapshot_values = {key: reviewed_value(document, key) for key in result.fields}
        approved_at = document.extraction_summary.approved_at
        state.approved_identities[identity_id] = ApprovedIdentity(
            id=identity_id,
            owner=document.owner,
            document_id=document.id,
            extraction_revision=document.extraction_summary.revision,
            source="desktop" if document.owner == "desktop" else "mobile",
            card_template=result.template or "CNIE_MA_2020",
            values=snapshot_values,
            created=approved_at,
            expires=approved_at + IDENTITY_TTL,
        )
        document.identity_id = identity_id
        await state.broadcast()
        return extraction_payload(document)

    @app.post("/api/documents/{document_id}/release-images")
    async def release_document_images(document_id: UUID, identity: str = Depends(user)):
        async with state.lock:
            document = owned_document(document_id, identity)
            approved = state.approved_identities.get(document.identity_id or "")
            if document.extraction_summary.status != "approved" or approved is None:
                raise HTTPException(409, "APPROVED_IDENTITY_REQUIRED")
            capture_ids = set(document.active_ids())
            for capture_id in capture_ids:
                capture = state.captures.pop(capture_id, None)
                if capture:
                    capture.generation += 1
                    capture.ocr_result = None
                    capture.original = b""
                    capture.rectified = None
            state.idempotency = {key: value for key, value in state.idempotency.items()
                                 if value[1] not in capture_ids}
            state.approved_identities[approved.id] = replace(approved, images_released=True)
            state.documents.pop(document.id, None)
        await state.broadcast()
        return state.approved_identities[approved.id].summary()

    @app.get("/api/documents/{document_id}/export")
    def export_extraction(document_id: UUID, identity: str = Depends(desktop)):
        document = owned_document(document_id, identity)
        if document.extraction_summary.status != "approved":
            raise HTTPException(409, "EXTRACTION_REVIEW_INCOMPLETE")
        payload = json.dumps(approved_export(document), ensure_ascii=False, indent=2).encode("utf-8")
        return Response(payload, media_type="application/json; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="cnie-{document.id[:8]}.json"'})

    @app.post("/api/document-generation-requests")
    async def create_document_request(body: DocumentGenerationCreate, request: Request,
                                      identity: str = Depends(user)):
        key = require_mutation_key(request)
        raw_assignments = {name: [str(value) for value in values]
                           for name, values in body.assignments.items()}
        digest = request_digest("create", {
            "template_id": body.template_id, "template_version": body.template_version,
            "assignments": raw_assignments,
        })
        async with state.lock:
            previous = state.document_request_idempotency.get((identity, key))
            if previous:
                if previous[0] != digest:
                    raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
                await state.persist_workspace()
                return previous[1]
            state.prune()
            if len(state.document_generation_requests) >= MAX_DOCUMENT_REQUESTS:
                raise HTTPException(409, "DOCUMENT_REQUEST_LIMIT")
            normalized, _ = validated_assignments(body.template_id, body.template_version,
                                                  body.assignments, identity)
            item = DocumentGenerationRequestState(
                id=str(uuid4()), owner=identity, template_id=body.template_id,
                template_version=body.template_version, assignments=normalized,
            )
            state.document_generation_requests[item.id] = item
            response = {**item.metadata(), "warnings": repeated_role_warnings(item.assignments)}
            remember_document_mutation(identity, key, digest, response)
        await state.broadcast()
        return response

    @app.patch("/api/document-generation-requests/{request_id}")
    async def update_document_request(request_id: UUID, body: DocumentGenerationUpdate,
                                      request: Request, identity: str = Depends(user)):
        key = require_mutation_key(request)
        raw_assignments = {name: [str(value) for value in values]
                           for name, values in body.assignments.items()}
        digest = request_digest("update", {
            "id": str(request_id), "revision": body.revision, "assignments": raw_assignments,
        })
        async with state.lock:
            previous = state.document_request_idempotency.get((identity, key))
            if previous:
                if previous[0] != digest:
                    raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
                await state.persist_workspace()
                return previous[1]
            item = owned_generation_request(request_id, identity)
            if item.revision != body.revision:
                raise HTTPException(409, "DOCUMENT_REQUEST_STALE_REVISION")
            normalized, _ = validated_assignments(item.template_id, item.template_version,
                                                  body.assignments, identity)
            item.assignments = normalized
            item.revision += 1
            item.updated = time.time()
            response = {**item.metadata(), "warnings": repeated_role_warnings(item.assignments)}
            remember_document_mutation(identity, key, digest, response)
        await state.broadcast()
        return response

    @app.delete("/api/document-generation-requests/{request_id}")
    async def delete_document_request(request_id: UUID, request: Request,
                                      identity: str = Depends(user)):
        key = require_mutation_key(request)
        digest = request_digest("delete", {"id": str(request_id)})
        async with state.lock:
            previous = state.document_request_idempotency.get((identity, key))
            if previous:
                if previous[0] != digest:
                    raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
                await state.persist_workspace()
                return previous[1]
            owned_generation_request(request_id, identity)
            state.document_generation_requests.pop(str(request_id), None)
            response = {"status": "deleted", "id": str(request_id), "deleted_at": time.time()}
            remember_document_mutation(identity, key, digest, response)
        await state.broadcast()
        return response

    @app.post("/api/document-generation-requests/{request_id}/complete")
    async def complete_document_request(request_id: UUID, body: CaseRevisionRequest,
                                        request: Request, _identity: str = Depends(desktop)):
        key = require_mutation_key(request)
        digest = request_digest("complete-document-request", {
            "id": str(request_id), "revision": body.revision,
        })
        async with state.lock:
            previous = state.document_request_idempotency.get(("desktop", key))
            if previous:
                if previous[0] != digest:
                    raise HTTPException(409, "IDEMPOTENCY_CONFLICT")
                await state.persist_workspace()
                return previous[1]
            item = owned_generation_request(request_id, "desktop")
            if item.revision != body.revision:
                raise HTTPException(409, "DOCUMENT_REQUEST_STALE_REVISION")
            state.document_generation_requests.pop(item.id)
            response = {"status": "deleted", "id": item.id, "revision": item.revision,
                        "reason": "saved", "deleted_at": time.time()}
            remember_document_mutation("desktop", key, digest, response)
        await state.broadcast()
        return response

    @app.post("/api/document-generation-requests/{request_id}/generate")
    async def generate_document(request_id: UUID, body: CaseRevisionRequest | None = None,
                                _identity: str = Depends(desktop)):
        item = owned_generation_request(request_id, "desktop")
        revision = item.revision
        if body is not None and body.revision != revision:
            raise HTTPException(409, "DOCUMENT_REQUEST_STALE_REVISION")
        uuid_assignments = {name: [UUID(value) for value in values]
                            for name, values in item.assignments.items()}
        _, values = validated_assignments(item.template_id, item.template_version,
                                          uuid_assignments, "desktop")
        try:
            payload, slug = await run_in_threadpool(
                state.document_catalog.render, item.template_id, item.template_version, values)
        except DocumentTemplateError as exc:
            raise template_http_error(exc) from None
        state.prune()
        current = owned_generation_request(request_id, "desktop")
        if current.revision != revision:
            raise HTTPException(409, "DOCUMENT_REQUEST_STALE_REVISION")
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        return Response(
            payload,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{slug}-{timestamp}.docx"',
                     "X-eNotario-Document-Request-Revision": str(revision)},
        )

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
