from __future__ import annotations

from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from cnie_rectifier import CnieRectifier, RectificationStatus, RectifierConfig
from cnie_rectifier.domain import DetectorResult


class FixedDetector:
    def __init__(self, result: DetectorResult):
        self.result = result

    def detect(self, _image):
        return self.result


class ExplodingDetector:
    def detect(self, _image):
        raise RuntimeError("synthetic failure")


def permissive_config() -> RectifierConfig:
    return RectifierConfig(min_edge_support=0.15, min_classical_score=0.45)


def test_invalid_payload_returns_invalid_image():
    result = CnieRectifier(detector_mode="opencv").rectify(b"not an image")
    assert result.status is RectificationStatus.INVALID_IMAGE
    assert result.rejection_codes == ["IMAGE_DECODE_FAILED"]
    assert result.rectified_image is None


def test_opencv_baseline_rectifies_synthetic_capture(synthetic_capture):
    payload, _ = synthetic_capture
    result = CnieRectifier(config=permissive_config(), detector_mode="opencv").rectify(payload)
    assert result.status is RectificationStatus.SUCCESS, result.to_dict()
    assert result.rectified_dimensions == (1600, 1008)
    assert result.rectified_image is not None
    output = Image.open(BytesIO(result.rectified_image))
    assert output.size == (1600, 1008)
    assert "rectified_image" not in result.to_dict()


def test_hybrid_agreement_uses_docquad_refined(synthetic_capture):
    payload, corners = synthetic_capture
    classical = DetectorResult(valid=True, corners=corners, score=0.9)
    model = DetectorResult(valid=True, corners=corners + 2, score=0.8)
    engine = CnieRectifier(
        config=permissive_config(),
        opencv_detector=FixedDetector(classical),
        docquad_detector=FixedDetector(model),
    )
    result = engine.rectify(payload)
    assert result.status is RectificationStatus.SUCCESS, result.to_dict()
    assert result.detector_used.value == "hybrid"
    assert result.detector_iou >= 0.90


def test_hybrid_disagreement_requires_recapture(synthetic_capture):
    payload, corners = synthetic_capture
    shifted = corners.copy()
    shifted[:, 0] -= 450
    classical = DetectorResult(valid=True, corners=corners, score=0.9)
    model = DetectorResult(valid=True, corners=shifted, score=0.9)
    engine = CnieRectifier(
        config=permissive_config(),
        opencv_detector=FixedDetector(classical),
        docquad_detector=FixedDetector(model),
    )
    result = engine.rectify(payload)
    assert result.status is RectificationStatus.RECAPTURE_REQUIRED
    assert result.rejection_codes == ["DETECTOR_DISAGREEMENT"]
    assert result.rectified_image is None


def test_moderate_detector_difference_uses_safe_model_candidate(synthetic_capture):
    payload, corners = synthetic_capture
    shifted = corners + np.array([80, 0], dtype=np.float32)
    engine = CnieRectifier(
        config=permissive_config(),
        opencv_detector=FixedDetector(DetectorResult(valid=True, corners=corners, score=0.9)),
        docquad_detector=FixedDetector(DetectorResult(valid=True, corners=shifted, score=0.85)),
    )
    result = engine.rectify(payload)
    assert result.status is RectificationStatus.SUCCESS, result.to_dict()
    assert result.detector_used.value == "docquadnet"
    assert "DETECTOR_SOFT_DISAGREEMENT" in result.warnings
    assert result.detector_iou >= result.docquadnet.metrics.get("soft_min_iou", 0.80)


def test_strong_opencv_fallback_has_warning(synthetic_capture):
    payload, corners = synthetic_capture
    classical = DetectorResult(valid=True, corners=corners, score=0.9)
    model = DetectorResult(valid=False, rejection_codes=["LOW_MODEL_SCORE"])
    result = CnieRectifier(
        config=RectifierConfig(min_edge_support=0.0, min_classical_score=0.45),
        opencv_detector=FixedDetector(classical),
        docquad_detector=FixedDetector(model),
    ).rectify(payload)
    assert result.status is RectificationStatus.SUCCESS, result.to_dict()
    assert result.warnings == ["MODEL_DETECTOR_MISSED"]


def test_exceptional_opencv_boundary_overrides_invalid_drifted_model(synthetic_capture):
    payload, corners = synthetic_capture
    drifted = corners.copy()
    drifted[0] += np.array([470, 270], dtype=np.float32)
    classical = DetectorResult(valid=True, corners=corners, score=0.97)
    model = DetectorResult(
        valid=False,
        corners=drifted,
        score=0.47,
        rejection_codes=["WEAK_CORNER_EVIDENCE", "MODEL_MASK_DISAGREEMENT"],
    )
    result = CnieRectifier(
        config=RectifierConfig(min_edge_support=0.0),
        opencv_detector=FixedDetector(classical),
        docquad_detector=FixedDetector(model),
    ).rectify(payload)
    assert result.status is RectificationStatus.SUCCESS, result.to_dict()
    assert result.detector_used.value == "opencv"
    assert result.warnings == ["MODEL_DETECTOR_MISSED", "STRONG_CLASSICAL_OVERRIDE"]


def test_card_below_required_resolution_is_rejected(synthetic_capture):
    payload, corners = synthetic_capture
    detector = FixedDetector(DetectorResult(valid=True, corners=corners, score=0.9))
    config = RectifierConfig(min_card_short_side_px=1500, min_edge_support=0.1)
    result = CnieRectifier(
        config=config, detector_mode="opencv", opencv_detector=detector
    ).rectify(payload)
    assert result.status is RectificationStatus.RECAPTURE_REQUIRED
    assert "INSUFFICIENT_CARD_RESOLUTION" in result.rejection_codes


def test_model_failure_is_contained(synthetic_capture):
    payload, _ = synthetic_capture
    missing = FixedDetector(
        DetectorResult(valid=False, rejection_codes=["NO_DOCUMENT_QUADRILATERAL"])
    )
    result = CnieRectifier(
        opencv_detector=missing,
        docquad_detector=ExplodingDetector(),
    ).rectify(payload)
    assert result.status is RectificationStatus.MODEL_ERROR
    assert "MODEL_UNAVAILABLE" in result.rejection_codes
    assert result.docquadnet.error.startswith("RuntimeError")


def test_color_edges_allow_both_detectors_to_accept_rounded_portrait_card(portrait_colored_capture):
    payload, _ = portrait_colored_capture
    result = CnieRectifier().rectify(payload)
    assert result.status is RectificationStatus.SUCCESS, result.to_dict()
    assert result.detector_used.value == "hybrid"
    assert result.opencv.valid and result.docquadnet.valid
    assert result.warnings == []
    assert result.quality_metrics["card_area_ratio"] < 0.45
    assert result.quality_metrics["card_diagonal_ratio"] >= 0.50
    assert result.docquadnet.metrics["mask_quad_iou"] >= 0.70
    assert result.docquadnet.metrics["boundary_supported_sides"] >= 3


def test_multiple_rectangles_cannot_silently_use_opencv_fallback(multiple_rectangles_capture):
    result = CnieRectifier().rectify(multiple_rectangles_capture)
    assert result.status is RectificationStatus.RECAPTURE_REQUIRED
    assert result.rectified_image is None
    assert result.rejection_codes == ["DETECTOR_DISAGREEMENT"]
    assert result.detector_iou is not None and result.detector_iou < 0.90


def test_card_sharpness_ignores_textured_background_and_supports_calibrated_gate(synthetic_capture):
    payload, corners = synthetic_capture
    image = cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
    detector = FixedDetector(DetectorResult(valid=True, corners=corners, score=.95))
    def rectify(frame, config=RectifierConfig()):
        ok, encoded = cv2.imencode(".png", frame)
        assert ok
        return CnieRectifier(config=config, detector_mode="opencv", opencv_detector=detector).rectify(encoded.tobytes())
    sharp = rectify(image)
    blurred_image = cv2.GaussianBlur(image, (0, 0), 8)
    blurred = rectify(blurred_image)
    mask = np.zeros(image.shape[:2], np.uint8)
    cv2.fillConvexPoly(mask, corners.astype(np.int32), 255)
    mask = cv2.dilate(mask, np.ones((61, 61), np.uint8))
    textured = blurred_image.copy()
    texture = np.random.default_rng(42).integers(0, 255, image.shape, dtype=np.uint8)
    textured[mask == 0] = texture[mask == 0]
    blurred_with_texture = rectify(textured)
    assert sharp.status == blurred.status == blurred_with_texture.status == RectificationStatus.SUCCESS
    score = "card_laplacian_variance"
    assert blurred.quality_metrics[score] < sharp.quality_metrics[score] / 10
    assert blurred_with_texture.quality_metrics[score] == blurred.quality_metrics[score]
    assert blurred_with_texture.quality_metrics["laplacian_variance"] > blurred.quality_metrics["laplacian_variance"]
    # A fixture-specific threshold tests plumbing, not production calibration.
    threshold = (blurred.quality_metrics[score] + sharp.quality_metrics[score]) / 2
    config = RectifierConfig(min_card_laplacian_variance=threshold)
    assert rectify(image, config).status == RectificationStatus.SUCCESS
    rejected = rectify(textured, config)
    assert rejected.rejection_codes == ["CARD_TOO_BLURRY"]
    assert rejected.rectified_image is None
