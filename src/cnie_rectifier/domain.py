from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any
from uuid import UUID

import numpy as np


class RectificationStatus(str, Enum):
    SUCCESS = "success"
    RECAPTURE_REQUIRED = "recapture_required"
    INVALID_IMAGE = "invalid_image"
    MODEL_ERROR = "model_error"


class DetectorKind(str, Enum):
    MANUAL = "manual"
    HYBRID = "hybrid"
    DOCQUAD = "docquadnet"
    OPENCV = "opencv"


@dataclass(slots=True)
class DetectorSummary:
    available: bool = True
    valid: bool = False
    score: float | None = None
    corners: list[list[float]] | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    rejection_codes: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass(slots=True)
class RectificationResult:
    status: RectificationStatus
    request_id: UUID
    original_dimensions: tuple[int, int] | None = None
    rectified_dimensions: tuple[int, int] | None = None
    corners: list[list[float]] | None = None
    detector_used: DetectorKind | None = None
    opencv: DetectorSummary = field(default_factory=DetectorSummary)
    docquadnet: DetectorSummary = field(default_factory=DetectorSummary)
    detector_iou: float | None = None
    detector_corner_distance_ratio: float | None = None
    quality_metrics: dict[str, Any] = field(default_factory=dict)
    timings_ms: dict[str, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    rejection_codes: list[str] = field(default_factory=list)
    rectified_image: bytes | None = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-safe metadata. Image bytes are deliberately excluded."""
        data = asdict(self)
        data.pop("rectified_image", None)
        data["status"] = self.status.value
        data["request_id"] = str(self.request_id)
        data["detector_used"] = (
            self.detector_used.value if self.detector_used is not None else None
        )
        return _json_safe(data)


@dataclass(slots=True)
class DetectorResult:
    valid: bool
    corners: np.ndarray | None = None
    score: float | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    rejection_codes: list[str] = field(default_factory=list)
    available: bool = True
    error: str | None = None

    def summary(self) -> DetectorSummary:
        return DetectorSummary(
            available=self.available,
            valid=self.valid,
            score=None if self.score is None else float(self.score),
            corners=(
                None
                if self.corners is None
                else np.asarray(self.corners, dtype=float).round(3).tolist()
            ),
            metrics=_json_safe(self.metrics),
            rejection_codes=list(self.rejection_codes),
            error=self.error,
        )


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value
