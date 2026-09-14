from __future__ import annotations

import base64
import io
import statistics
import time
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4
from urllib.parse import quote

import requests
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from PIL import Image, UnidentifiedImageError

from .credentials import CredentialError
from .domain import (
    OcrBlock,
    OcrPage,
    OcrParagraph,
    OcrResult,
    OcrStatus,
    OcrWord,
    arabic_character,
    arabic_segments,
)
from .usage import UsageLedger, UsageLimitReached

VISION_ORIGIN = "https://eu-vision.googleapis.com"
VISION_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
CONNECT_TIMEOUT_SECONDS = 5
READ_TIMEOUT_SECONDS = 20


def _valid_canonical_image(image: bytes) -> bool:
    """Only the canonical Phase 1 JPEG may cross the provider boundary."""
    try:
        with Image.open(io.BytesIO(image)) as decoded:
            return decoded.format == "JPEG" and decoded.size == (1600, 1008)
    except (OSError, UnidentifiedImageError, ValueError):
        return False


def _languages(properties: dict[str, Any] | None) -> list[str]:
    values = (properties or {}).get("detectedLanguages", [])
    return [str(value.get("languageCode", "")) for value in values if value.get("languageCode")]


def _polygon(value: dict[str, Any] | None, width: int = 1, height: int = 1) -> list[list[int]]:
    absolute = (value or {}).get("vertices")
    vertices = absolute or (value or {}).get("normalizedVertices") or []
    points = [[int(vertex.get("x", 0) * (1 if absolute else width)),
               int(vertex.get("y", 0) * (1 if absolute else height))] for vertex in vertices[:4]]
    return points + [[0, 0]] * (4 - len(points))


def _confidence(value: Any) -> float | None:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, score))


def _word_text(symbols: list[dict[str, Any]]) -> str:
    return "".join(str(symbol.get("text", "")) for symbol in symbols)


def _paragraph_text(words: list[OcrWord], raw_words: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for word, raw in zip(words, raw_words, strict=False):
        parts.append(word.text)
        symbols = raw.get("symbols") or []
        detected_break = ((symbols[-1].get("property") or {}).get("detectedBreak") or {}) if symbols else {}
        break_type = detected_break.get("type")
        if break_type in {"SPACE", "SURE_SPACE", "EOL_SURE_SPACE"}:
            parts.append(" ")
        elif break_type in {"LINE_BREAK", "HYPHEN"}:
            parts.append("\n" if break_type == "LINE_BREAK" else "-")
        else:
            parts.append(" ")
    return "".join(parts).strip()


def normalize_response(payload: dict[str, Any], request_id: UUID, latency_ms: float) -> OcrResult:
    responses = payload.get("responses")
    if not isinstance(responses, list) or len(responses) != 1 or not isinstance(responses[0], dict):
        return _failure(request_id, "OCR_INVALID_RESPONSE", False, latency_ms)
    response = responses[0]
    provider_error = response.get("error")
    if provider_error:
        code = int(provider_error.get("code", 0) or 0)
        if code == 429:
            return _failure(request_id, "OCR_RATE_LIMITED", True, latency_ms)
        if code in {401, 16}:
            return _failure(request_id, "OCR_AUTH_FAILED", False, latency_ms)
        if code in {403, 7}:
            return _failure(request_id, "OCR_PERMISSION_DENIED", False, latency_ms)
        if code >= 500 or code in {4, 13, 14}:
            return _failure(request_id, "OCR_PROVIDER_UNAVAILABLE", True, latency_ms)
        return _failure(request_id, "OCR_INVALID_RESPONSE", False, latency_ms)

    annotation = response.get("fullTextAnnotation")
    if not isinstance(annotation, dict) or not str(annotation.get("text", "")).strip():
        return OcrResult(
            status=OcrStatus.NO_TEXT,
            request_id=request_id,
            metrics={"latency_ms": latency_ms, "character_count": 0, "arabic_character_count": 0, "word_count": 0},
            error_code="OCR_NO_TEXT",
        )

    pages: list[OcrPage] = []
    all_paragraphs: list[OcrParagraph] = []
    all_words: list[OcrWord] = []
    language_set: set[str] = set()
    for raw_page in annotation.get("pages") or []:
        page_width = int(raw_page.get("width", 0) or 0)
        page_height = int(raw_page.get("height", 0) or 0)
        blocks: list[OcrBlock] = []
        for raw_block in raw_page.get("blocks") or []:
            paragraphs: list[OcrParagraph] = []
            block_fragments: list[str] = []
            for raw_paragraph in raw_block.get("paragraphs") or []:
                raw_words = raw_paragraph.get("words") or []
                words: list[OcrWord] = []
                for raw_word in raw_words:
                    symbols = raw_word.get("symbols") or []
                    languages = _languages(raw_word.get("property"))
                    word = OcrWord(
                        text=_word_text(symbols),
                        confidence=_confidence(raw_word.get("confidence")),
                        bounding_box=_polygon(raw_word.get("boundingBox"), page_width, page_height),
                        languages=languages,
                    )
                    words.append(word)
                    all_words.append(word)
                    language_set.update(languages)
                languages = _languages(raw_paragraph.get("property"))
                text = _paragraph_text(words, raw_words)
                paragraph = OcrParagraph(
                    text=text,
                    confidence=_confidence(raw_paragraph.get("confidence")),
                    bounding_box=_polygon(raw_paragraph.get("boundingBox"), page_width, page_height),
                    languages=languages,
                    words=words,
                )
                paragraphs.append(paragraph)
                all_paragraphs.append(paragraph)
                block_fragments.append(text)
                language_set.update(languages)
            block_type = str(raw_block.get("blockType", "TEXT")).lower()
            blocks.append(OcrBlock(
                text="\n".join(fragment for fragment in block_fragments if fragment),
                confidence=_confidence(raw_block.get("confidence")),
                bounding_box=_polygon(raw_block.get("boundingBox"), page_width, page_height),
                block_type=block_type,
                paragraphs=paragraphs,
            ))
        pages.append(OcrPage(
            width=page_width,
            height=page_height,
            confidence=_confidence(raw_page.get("confidence")),
            blocks=blocks,
        ))

    full_text = str(annotation.get("text", ""))
    confidences = [word.confidence for word in all_words if word.confidence is not None]
    arabic_count = sum(arabic_character(character) for character in full_text)
    metrics: dict[str, Any] = {
        "latency_ms": latency_ms,
        "character_count": len(full_text),
        "arabic_character_count": arabic_count,
        "word_count": len(all_words),
        "mean_word_confidence": statistics.fmean(confidences) if confidences else None,
        "low_confidence_word_ratio": (
            sum(confidence < 0.7 for confidence in confidences) / len(confidences) if confidences else None
        ),
    }
    return OcrResult(
        status=OcrStatus.SUCCESS,
        request_id=request_id,
        full_text=full_text,
        arabic_text=arabic_segments(all_paragraphs),
        pages=pages,
        languages=sorted(language_set),
        metrics=metrics,
    )


def _failure(request_id: UUID, code: str, retryable: bool, latency_ms: float = 0.0) -> OcrResult:
    return OcrResult(
        status=OcrStatus.FAILED,
        request_id=request_id,
        metrics={"latency_ms": latency_ms},
        error_code=code,
        retryable=retryable,
    )


class GoogleVisionOcrEngine:
    def __init__(
        self,
        credential_loader: Callable[[], dict[str, Any]],
        usage: UsageLedger,
        *,
        session_factory: Callable[[Any], Any] | None = None,
        credential_factory: Callable[[dict[str, Any]], Any] | None = None,
    ):
        self._credential_loader = credential_loader
        self._usage = usage
        self._session_factory = session_factory or (
            lambda credentials: AuthorizedSession(credentials, refresh_status_codes=(), max_refresh_attempts=0)
        )
        self._credential_factory = credential_factory or self._make_credentials

    @staticmethod
    def _make_credentials(info: dict[str, Any]):
        return service_account.Credentials.from_service_account_info(info, scopes=[VISION_SCOPE])

    def recognize(
        self,
        image: bytes,
        request_id: UUID | None = None,
        *,
        language_hints: list[str] | None = None,
    ) -> OcrResult:
        identifier = request_id or uuid4()
        started = time.perf_counter()
        if not _valid_canonical_image(image):
            return _failure(identifier, "OCR_INVALID_RESPONSE", False)
        try:
            info = self._credential_loader()
            project_id = str(info["project_id"])
            credentials = self._credential_factory(info)
        except CredentialError as error:
            code = str(error)
            return _failure(identifier, code if code == "OCR_NOT_CONFIGURED" else "OCR_CREDENTIAL_INVALID", False)
        except (KeyError, TypeError, ValueError, GoogleAuthError):
            return _failure(identifier, "OCR_CREDENTIAL_INVALID", False)

        try:
            self._usage.reserve()
        except UsageLimitReached:
            return _failure(identifier, "OCR_LOCAL_LIMIT_REACHED", False)

        context: dict[str, Any] = {}
        if language_hints:
            context["languageHints"] = list(language_hints)
        request: dict[str, Any] = {
            "image": {"content": base64.b64encode(image).decode("ascii")},
            "features": [{"type": "DOCUMENT_TEXT_DETECTION", "maxResults": 1}],
        }
        if context:
            request["imageContext"] = context
        endpoint = f"{VISION_ORIGIN}/v1/projects/{quote(project_id, safe='')}/locations/eu/images:annotate"
        try:
            session = self._session_factory(credentials)
            response = session.post(
                endpoint,
                json={"requests": [request]},
                timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
            )
            elapsed = (time.perf_counter() - started) * 1000
            if response.status_code == 401:
                return _failure(identifier, "OCR_AUTH_FAILED", False, elapsed)
            if response.status_code == 403:
                return _failure(identifier, "OCR_PERMISSION_DENIED", False, elapsed)
            if response.status_code == 429:
                try:
                    details = response.json()
                except (TypeError, ValueError):
                    details = {}
                description = str(details).lower()
                code = "OCR_QUOTA_EXCEEDED" if "quota" in description else "OCR_RATE_LIMITED"
                return _failure(identifier, code, code == "OCR_RATE_LIMITED", elapsed)
            if 500 <= response.status_code:
                return _failure(identifier, "OCR_PROVIDER_UNAVAILABLE", True, elapsed)
            if response.status_code >= 400:
                return _failure(identifier, "OCR_INVALID_RESPONSE", False, elapsed)
            try:
                payload = response.json()
            except (TypeError, ValueError):
                return _failure(identifier, "OCR_INVALID_RESPONSE", False, elapsed)
            if not isinstance(payload, dict):
                return _failure(identifier, "OCR_INVALID_RESPONSE", False, elapsed)
            return normalize_response(payload, identifier, elapsed)
        except requests.Timeout:
            elapsed = (time.perf_counter() - started) * 1000
            return _failure(identifier, "OCR_TIMEOUT", True, elapsed)
        except (requests.ConnectionError, requests.RequestException):
            elapsed = (time.perf_counter() - started) * 1000
            return _failure(identifier, "OCR_PROVIDER_UNAVAILABLE", True, elapsed)
        except GoogleAuthError:
            elapsed = (time.perf_counter() - started) * 1000
            return _failure(identifier, "OCR_AUTH_FAILED", False, elapsed)
