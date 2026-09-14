"""Provider-neutral OCR core for rectified CNIE images."""

from typing import Protocol
from uuid import UUID

from .domain import OcrBlock, OcrPage, OcrParagraph, OcrResult, OcrStatus, OcrWord
from .google_vision import GoogleVisionOcrEngine


class OcrEngine(Protocol):
    def recognize(self, image: bytes, request_id: UUID | None = None) -> OcrResult: ...

__all__ = [
    "GoogleVisionOcrEngine",
    "OcrEngine",
    "OcrBlock",
    "OcrPage",
    "OcrParagraph",
    "OcrResult",
    "OcrStatus",
    "OcrWord",
]
