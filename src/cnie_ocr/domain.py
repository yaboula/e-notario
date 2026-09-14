from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any
from uuid import UUID


class OcrStatus(str, Enum):
    SUCCESS = "success"
    NO_TEXT = "no_text"
    FAILED = "failed"


@dataclass(slots=True)
class OcrWord:
    text: str
    confidence: float | None
    bounding_box: list[list[int]]
    languages: list[str] = field(default_factory=list)


@dataclass(slots=True)
class OcrParagraph:
    text: str
    confidence: float | None
    bounding_box: list[list[int]]
    languages: list[str] = field(default_factory=list)
    words: list[OcrWord] = field(default_factory=list)


@dataclass(slots=True)
class OcrBlock:
    text: str
    confidence: float | None
    bounding_box: list[list[int]]
    block_type: str = "text"
    paragraphs: list[OcrParagraph] = field(default_factory=list)


@dataclass(slots=True)
class OcrPage:
    width: int
    height: int
    confidence: float | None
    blocks: list[OcrBlock] = field(default_factory=list)


@dataclass(slots=True)
class OcrResult:
    status: OcrStatus
    request_id: UUID
    provider: str = "google_cloud_vision"
    region: str = "eu"
    full_text: str = ""
    arabic_text: str = ""
    pages: list[OcrPage] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    retryable: bool = False

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["status"] = self.status.value
        data["request_id"] = str(self.request_id)
        return data


def arabic_character(value: str) -> bool:
    if not value:
        return False
    code = ord(value)
    return (
        0x0600 <= code <= 0x06FF
        or 0x0750 <= code <= 0x077F
        or 0x08A0 <= code <= 0x08FF
        or 0xFB50 <= code <= 0xFDFF
        or 0xFE70 <= code <= 0xFEFF
    )


def arabic_segments(paragraphs: list[OcrParagraph]) -> str:
    selected: list[str] = []
    for paragraph in paragraphs:
        letters = [character for character in paragraph.text if character.isalpha()]
        ratio = sum(arabic_character(character) for character in letters) / max(1, len(letters))
        languages = {language.lower().split("-")[0] for language in paragraph.languages}
        if "ar" in languages or ratio >= 0.3:
            selected.append(paragraph.text.strip())
    return "\n".join(value for value in selected if value)
