from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any
from uuid import UUID


class ExtractionStatus(str, Enum):
    REVIEW_REQUIRED = "review_required"
    UNSUPPORTED_LAYOUT = "unsupported_layout"
    FAILED = "failed"


@dataclass(slots=True)
class FieldEvidence:
    side: str
    polygons: list[list[list[int]]] = field(default_factory=list)
    word_count: int = 0


@dataclass(slots=True)
class ExtractedField:
    key: str
    raw_value: Any = None
    normalized_value: Any = None
    confidence: float | None = None
    required: bool = True
    evidence: list[FieldEvidence] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ExtractionResult:
    status: ExtractionStatus
    request_id: UUID
    template: str | None = None
    engine_version: str = "1.2.0"
    fields: dict[str, ExtractedField] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    error_code: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["status"] = self.status.value
        data["request_id"] = str(self.request_id)
        return data
