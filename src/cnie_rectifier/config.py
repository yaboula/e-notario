from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = PACKAGE_ROOT / "models" / "docquadnet256_trained_opset17.onnx"
MODEL_SHA256 = "b4727efbeedeb0e751cc03ae96572ccb1c7f891ee00e62278eca98826fd20abb"
UPSTREAM_MODEL_SHA256 = "2426e05fc268b6110502000679b2be9b448579f8ecec4acf7a32b7053ca181cf"
MODEL_COMMIT = "5d08804af3a2fe6d25c09f85366a19ca4fac0a04"


@dataclass(frozen=True, slots=True)
class RectifierConfig:
    output_width: int = 1600
    output_height: int = 1008
    work_max_side: int = 1600
    min_card_short_side_px: float = 1000.0
    # Area is only a coarse sanity guard. Capture occupancy is measured by the
    # orientation-independent card/image diagonal ratio below.
    min_card_area_ratio: float = 0.10
    min_card_diagonal_ratio: float = 0.50
    max_card_area_ratio: float = 0.94
    min_border_distance_ratio: float = 0.008
    # Office-balanced profile: geometry, resolution and lighting remain hard
    # gates, while ordinary background variation is not treated as a
    # recapture by itself.
    min_edge_support: float = 0.26
    min_color_edge_support: float = 0.24
    min_boundary_side_support: float = 0.12
    min_boundary_supported_sides: int = 3
    # Card-only score at a fixed 1000 x 630 analysis size. Enable a hard blur
    # gate only with a threshold calibrated on an authorized CNIE corpus.
    min_card_laplacian_variance: float | None = None
    min_classical_score: float = 0.56
    # An exceptionally well-supported classical boundary may safely win when
    # the model itself is invalid and one of its corner peaks drifted. This is
    # deliberately much stricter than the ordinary OpenCV fallback.
    min_strong_classical_score: float = 0.90
    min_docquad_score: float = 0.30
    min_docquad_corner_score: float = 0.80
    min_docquad_peak_prominence: float = 0.75
    min_docquad_mask_iou: float = 0.65
    min_docquad_mask_component_ratio: float = 0.75
    detector_min_iou: float = 0.90
    detector_max_corner_distance_ratio: float = 0.02
    detector_soft_min_iou: float = 0.80
    detector_soft_max_corner_distance_ratio: float = 0.05
    min_soft_docquad_score: float = 0.55
    max_glare_ratio: float = 0.18
    min_mean_luminance: float = 28.0
    max_mean_luminance: float = 242.0
    max_black_border_ratio: float = 0.01
    max_decode_pixels: int = 50_000_000
    jpeg_quality: int = 95
