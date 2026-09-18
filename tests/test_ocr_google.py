import base64
import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest
import requests
from PIL import Image

from cnie_ocr.domain import OcrStatus
from cnie_ocr.google_vision import GoogleVisionOcrEngine, normalize_response
from cnie_ocr.usage import UsageLedger, UsageLimitReached, UsageStorageError


class Response:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload if payload is not None else {"responses": [{}]}

    def json(self):
        return self._payload


class Session:
    def __init__(self, response=None, error=None):
        self.response = response or Response()
        self.error = error
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise self.error
        return self.response


def engine(tmp_path, session, daily=60):
    return GoogleVisionOcrEngine(
        lambda: {"project_id": "valid-project-123"},
        UsageLedger(tmp_path / "usage.json", daily_limit=daily),
        session_factory=lambda _: session,
        credential_factory=lambda _: object(),
    )


@pytest.fixture
def canonical_jpeg():
    import io
    output = io.BytesIO()
    Image.new("RGB", (1600, 1008), "white").save(output, format="JPEG")
    return output.getvalue()


def annotation():
    def poly(x):
        return {"vertices": [{"x": x, "y": 10}, {"x": x + 80, "y": 10}, {"x": x + 80, "y": 50}, {"x": x, "y": 50}]}
    words = []
    for index, (text, language) in enumerate((("المملكة", "ar"), ("MAROC", "fr"), ("123", ""))):
        symbols = [{"text": value} for value in text]
        symbols[-1]["property"] = {"detectedBreak": {"type": "SPACE"}}
        words.append({"symbols": symbols, "confidence": .91, "boundingBox": poly(20 + index * 100),
                      "property": {"detectedLanguages": [{"languageCode": language}]} if language else {}})
    paragraph = {"words": words, "confidence": .9, "boundingBox": poly(10),
                 "property": {"detectedLanguages": [{"languageCode": "ar"}, {"languageCode": "fr"}]}}
    block = {"blockType": "TEXT", "paragraphs": [paragraph], "confidence": .9, "boundingBox": poly(10)}
    return {"responses": [{"fullTextAnnotation": {"text": "المملكة MAROC 123\n", "pages": [{"width": 1600, "height": 1008, "blocks": [block]}]}}]}


def test_eu_transport_inline_jpeg_and_auto_language(tmp_path, canonical_jpeg):
    session = Session(Response(payload=annotation()))
    result = engine(tmp_path, session).recognize(canonical_jpeg)
    assert result.status == OcrStatus.SUCCESS
    assert result.arabic_text == "المملكة MAROC 123"
    assert result.languages == ["ar", "fr"]
    url, call = session.calls[0]
    assert url == "https://eu-vision.googleapis.com/v1/projects/valid-project-123/locations/eu/images:annotate"
    assert call["timeout"] == (5, 20)
    request = call["json"]["requests"][0]
    assert base64.b64decode(request["image"]["content"]) == canonical_jpeg
    assert request["features"] == [{"type": "DOCUMENT_TEXT_DETECTION", "maxResults": 1}]
    assert "imageContext" not in request


def test_experimental_language_hints_are_explicit(tmp_path, canonical_jpeg):
    session = Session(Response(payload=annotation()))
    engine(tmp_path, session).recognize(canonical_jpeg, language_hints=["ar", "fr"])
    assert session.calls[0][1]["json"]["requests"][0]["imageContext"] == {"languageHints": ["ar", "fr"]}


@pytest.mark.parametrize("status,code,retryable", [
    (401, "OCR_AUTH_FAILED", False),
    (403, "OCR_PERMISSION_DENIED", False),
    (429, "OCR_RATE_LIMITED", True),
    (500, "OCR_PROVIDER_UNAVAILABLE", True),
])
def test_http_errors(status, code, retryable, tmp_path, canonical_jpeg):
    result = engine(tmp_path, Session(Response(status, {"error": {"message": "provider"}}))).recognize(canonical_jpeg)
    assert (result.error_code, result.retryable) == (code, retryable)


def test_quota_429_is_permanent(tmp_path, canonical_jpeg):
    result = engine(tmp_path, Session(Response(429, {"error": {"message": "Quota exceeded"}}))).recognize(canonical_jpeg)
    assert (result.error_code, result.retryable) == ("OCR_QUOTA_EXCEEDED", False)


def test_timeout_empty_and_invalid_response(tmp_path, canonical_jpeg):
    timeout = engine(tmp_path, Session(error=requests.Timeout())).recognize(canonical_jpeg)
    assert (timeout.error_code, timeout.retryable) == ("OCR_TIMEOUT", True)
    empty = normalize_response({"responses": [{}]}, uuid4(), 12)
    assert (empty.status, empty.error_code) == (OcrStatus.NO_TEXT, "OCR_NO_TEXT")
    invalid = normalize_response({"responses": []}, uuid4(), 12)
    assert invalid.error_code == "OCR_INVALID_RESPONSE"


def test_non_canonical_images_never_cross_provider_boundary(tmp_path):
    session = Session(Response(payload=annotation()))
    result = engine(tmp_path, session).recognize(b"not-a-canonical-jpeg")
    assert result.error_code == "OCR_INVALID_RESPONSE"
    assert session.calls == []


def test_usage_is_persistent_and_enforced(tmp_path):
    path = tmp_path / "usage.json"
    ledger = UsageLedger(path, daily_limit=1, monthly_limit=2)
    first = ledger.reserve(datetime(2026, 9, 14, tzinfo=timezone.utc))
    assert first.used_today == 1
    with pytest.raises(UsageLimitReached):
        UsageLedger(path, daily_limit=1, monthly_limit=2).reserve(datetime(2026, 9, 14, tzinfo=timezone.utc))
    content = json.loads(path.read_text())
    assert content == {"2026-09-14": 1}


@pytest.mark.parametrize("payload", ['broken json', '[]', '{"2026-09-14":-1}',
                                     '{"2026-09-14":"1"}', '{"bad-date":1}'])
def test_invalid_usage_is_preserved_and_blocks_provider(tmp_path, canonical_jpeg, payload):
    path = tmp_path / "usage.json"
    path.write_text(payload, encoding="utf-8")
    with pytest.raises(UsageStorageError, match="OCR_USAGE_READ_FAILED"):
        UsageLedger(path).summary()
    session = Session()
    result = engine(tmp_path, session).recognize(canonical_jpeg)
    assert result.error_code == "OCR_USAGE_READ_FAILED"
    assert session.calls == []
    assert path.read_text(encoding="utf-8") == payload


def test_denied_usage_read_does_not_reset_counter(tmp_path, monkeypatch):
    from pathlib import Path
    def denied(*_args, **_kwargs):
        raise PermissionError("private path")
    monkeypatch.setattr(Path, "read_text", denied)
    with pytest.raises(UsageStorageError, match="^OCR_USAGE_READ_FAILED$"):
        UsageLedger(tmp_path / "usage.json").reserve()


def test_failed_usage_commit_preserves_counter_and_blocks_provider(tmp_path, canonical_jpeg, monkeypatch):
    path = tmp_path / "usage.json"
    original = '{"2026-09-14":5}'
    path.write_text(original, encoding="utf-8")
    def denied(*_args, **_kwargs):
        raise OSError("private path")
    monkeypatch.setattr("cnie_ocr.usage.os.replace", denied)
    session = Session()
    result = engine(tmp_path, session).recognize(canonical_jpeg)
    assert result.error_code == "OCR_USAGE_WRITE_FAILED"
    assert session.calls == []
    assert path.read_text(encoding="utf-8") == original
    assert list(tmp_path.glob("*.tmp")) == []


def test_missing_usage_starts_empty_without_writing_on_read(tmp_path):
    path = tmp_path / "usage.json"
    assert UsageLedger(path).summary().used_today == 0
    assert not path.exists()
