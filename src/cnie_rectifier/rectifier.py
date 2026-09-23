from __future__ import annotations

from pathlib import Path
from time import perf_counter
from typing import Literal
from uuid import UUID, uuid4

import cv2
import numpy as np

from .classical import OpenCvDetector
from .config import DEFAULT_MODEL_PATH, RectifierConfig
from .docquad import DocQuadDetector
from .domain import DetectorKind, DetectorResult, RectificationResult, RectificationStatus
from .errors import InvalidImageError
from .geometry import (
    mean_corner_distance_ratio,
    is_convex,
    is_self_intersecting,
    order_quad,
    quad_iou,
    refine_quad_with_edges,
    warp_card,
)
from .image_io import decode_image, encode_jpeg
from .quality import capture_quality, card_sharpness, rejection_codes
from .enhancement import enhance_card


DetectorMode = Literal["hybrid", "opencv", "docquadnet"]


class CnieRectifier:
    def __init__(
        self,
        *,
        config: RectifierConfig | None = None,
        model_path: Path | str = DEFAULT_MODEL_PATH,
        detector_mode: DetectorMode = "hybrid",
        opencv_detector: OpenCvDetector | None = None,
        docquad_detector: DocQuadDetector | None = None,
    ):
        if detector_mode not in {"hybrid", "opencv", "docquadnet"}:
            raise ValueError("detector_mode must be hybrid, opencv or docquadnet")
        self.config = config or RectifierConfig()
        self.detector_mode = detector_mode
        self.opencv_detector = opencv_detector or OpenCvDetector(self.config)
        self.docquad_detector = docquad_detector or DocQuadDetector(self.config, model_path)

    def rectify(self, image: bytes, request_id: UUID | None = None, *,
                manual_corners: list[list[float]] | None = None) -> RectificationResult:
        request_uuid = request_id or uuid4()
        total_started = perf_counter()
        timings: dict[str, float] = {}
        try:
            stage = perf_counter()
            decoded, decode_metrics = decode_image(image, self.config.max_decode_pixels)
            timings["decode"] = (perf_counter() - stage) * 1000
        except InvalidImageError as exc:
            timings["total"] = (perf_counter() - total_started) * 1000
            return RectificationResult(
                status=RectificationStatus.INVALID_IMAGE,
                request_id=request_uuid,
                timings_ms=timings,
                rejection_codes=[exc.code],
            )

        height, width = decoded.shape[:2]
        manual_quad = None
        if manual_corners is not None:
            try:
                normalized = np.asarray(manual_corners, dtype=np.float32)
                if normalized.shape != (4, 2) or not np.isfinite(normalized).all() \
                        or np.any(normalized < 0) or np.any(normalized > 1):
                    raise ValueError("INVALID_MANUAL_CORNERS")
                manual_quad = normalized * np.array([width - 1, height - 1], dtype=np.float32)
                # Validate submitted order before sorting: crossed handles are an error.
                if not is_convex(manual_quad) or is_self_intersecting(manual_quad):
                    raise ValueError("INVALID_MANUAL_CORNERS")
            except (TypeError, ValueError):
                return RectificationResult(
                    status=RectificationStatus.RECAPTURE_REQUIRED, request_id=request_uuid,
                    original_dimensions=(width, height), rejection_codes=["INVALID_MANUAL_CORNERS"],
                )
        opencv = DetectorResult(valid=False, available=self.detector_mode != "docquadnet")
        docquad = DetectorResult(valid=False, available=self.detector_mode != "opencv")
        if manual_quad is None and self.detector_mode in {"hybrid", "opencv"}:
            stage = perf_counter()
            try:
                opencv = self.opencv_detector.detect(decoded)
            except Exception as exc:
                opencv = DetectorResult(
                    valid=False,
                    available=False,
                    error=f"{type(exc).__name__}: {exc}",
                    rejection_codes=["CLASSICAL_DETECTOR_ERROR"],
                )
            timings["opencv_detector"] = (perf_counter() - stage) * 1000
        if manual_quad is None and self.detector_mode in {"hybrid", "docquadnet"}:
            stage = perf_counter()
            try:
                docquad = self.docquad_detector.detect(decoded)
            except Exception as exc:
                docquad = DetectorResult(
                    valid=False,
                    available=False,
                    error=f"{type(exc).__name__}: {exc}",
                    rejection_codes=["MODEL_UNAVAILABLE"],
                )
            timings["docquadnet_detector"] = (perf_counter() - stage) * 1000

        accepted: np.ndarray | None = None
        detector_used: DetectorKind | None = None
        warnings: list[str] = []
        rejected: list[str] = []
        iou: float | None = None
        distance_ratio: float | None = None

        if manual_quad is not None:
            accepted, detector_used = manual_quad, DetectorKind.MANUAL
            warnings.append("MANUAL_CORNERS")
        elif self.detector_mode == "opencv":
            if opencv.valid:
                accepted, detector_used = opencv.corners, DetectorKind.OPENCV
            else:
                rejected.extend(opencv.rejection_codes or ["CLASSICAL_DETECTOR_MISSED"])
        elif self.detector_mode == "docquadnet":
            if docquad.valid:
                accepted, detector_used = docquad.corners, DetectorKind.DOCQUAD
            else:
                rejected.extend(docquad.rejection_codes or ["MODEL_DETECTOR_MISSED"])
        elif opencv.valid and docquad.valid:
            iou = quad_iou(opencv.corners, docquad.corners)
            distance_ratio = mean_corner_distance_ratio(
                opencv.corners, docquad.corners, width, height
            )
            if (
                iou >= self.config.detector_min_iou
                and distance_ratio <= self.config.detector_max_corner_distance_ratio
            ):
                accepted = refine_quad_with_edges(decoded, docquad.corners)
                detector_used = DetectorKind.HYBRID
            elif (
                iou >= self.config.detector_soft_min_iou
                and distance_ratio <= self.config.detector_soft_max_corner_distance_ratio
            ):
                accepted = refine_quad_with_edges(decoded, docquad.corners)
                detector_used = DetectorKind.DOCQUAD
                warnings.append("DETECTOR_SOFT_DISAGREEMENT")
            else:
                rejected.append("DETECTOR_DISAGREEMENT")
        elif docquad.valid:
            accepted = refine_quad_with_edges(decoded, docquad.corners)
            detector_used = DetectorKind.DOCQUAD
            warnings.append("CLASSICAL_DETECTOR_MISSED")
        elif opencv.valid and docquad.available and docquad.corners is not None:
            # An invalid model result may still represent an actual, but
            # ambiguous, document proposal. Never silently fall back to a
            # different OpenCV rectangle unless both geometries agree.
            iou = quad_iou(opencv.corners, docquad.corners)
            distance_ratio = mean_corner_distance_ratio(
                opencv.corners, docquad.corners, width, height
            )
            if (
                iou >= self.config.detector_soft_min_iou
                and distance_ratio <= self.config.detector_soft_max_corner_distance_ratio
                and (docquad.score or 0.0) >= self.config.min_soft_docquad_score
            ):
                accepted = refine_quad_with_edges(decoded, opencv.corners)
                detector_used = DetectorKind.OPENCV
                warnings.extend(["MODEL_DETECTOR_MISSED", "DETECTOR_SOFT_DISAGREEMENT"])
            elif (opencv.score or 0.0) >= self.config.min_strong_classical_score:
                # An invalid model proposal must not veto a boundary that is
                # independently supported almost perfectly by the image. This
                # recovers ordinary office captures with one unstable model
                # corner while the high threshold still rejects competing
                # rectangles and weak aspect-only proposals.
                accepted = refine_quad_with_edges(decoded, opencv.corners)
                detector_used = DetectorKind.OPENCV
                warnings.extend(["MODEL_DETECTOR_MISSED", "STRONG_CLASSICAL_OVERRIDE"])
            else:
                rejected.append("DETECTOR_DISAGREEMENT")
        elif opencv.valid and (opencv.score or 0.0) >= self.config.min_classical_score:
            accepted, detector_used = opencv.corners, DetectorKind.OPENCV
            warnings.append("MODEL_DETECTOR_MISSED")
        else:
            rejected.extend(docquad.rejection_codes)
            rejected.extend(opencv.rejection_codes)
            if not rejected:
                rejected.append("NO_DOCUMENT_QUADRILATERAL")

        quality: dict[str, object] = {"decode": decode_metrics}
        rectified_bytes: bytes | None = None
        rectified_dimensions: tuple[int, int] | None = None
        if accepted is not None:
            accepted = order_quad(accepted)
            stage = perf_counter()
            quality.update(capture_quality(decoded, accepted, self.config))
            quality["manual_corners"] = manual_quad is not None
            rejected.extend(rejection_codes(quality, self.config))
            timings["quality_validation"] = (perf_counter() - stage) * 1000
            rejected = list(dict.fromkeys(rejected))
            if not rejected:
                try:
                    stage = perf_counter()
                    rectified, warp_metrics = warp_card(
                        decoded,
                        accepted,
                        self.config.output_width,
                        self.config.output_height,
                    )
                    timings["perspective_warp"] = (perf_counter() - stage) * 1000
                    quality.update(warp_metrics)
                    quality.update(card_sharpness(rectified))
                    rejected.extend(rejection_codes(quality, self.config))
                    if float(warp_metrics["black_border_ratio"]) > self.config.max_black_border_ratio:
                        rejected.append("MATERIAL_BLACK_BORDER")
                    if not rejected:
                        stage = perf_counter()
                        rectified, enhancement_metrics = enhance_card(rectified)
                        quality["enhancement"] = enhancement_metrics
                        timings["image_enhancement"] = (perf_counter() - stage) * 1000
                        stage = perf_counter()
                        rectified_bytes = encode_jpeg(rectified, self.config.jpeg_quality)
                        timings["jpeg_encode"] = (perf_counter() - stage) * 1000
                        rectified_dimensions = (
                            self.config.output_width,
                            self.config.output_height,
                        )
                except (ValueError, cv2.error, RuntimeError):
                    rejected.append("DEGENERATE_HOMOGRAPHY")

        status = RectificationStatus.SUCCESS if rectified_bytes is not None else RectificationStatus.RECAPTURE_REQUIRED
        if (
            status != RectificationStatus.SUCCESS
            and self.detector_mode in {"hybrid", "docquadnet"}
            and not docquad.available
            and not opencv.valid
        ):
            status = RectificationStatus.MODEL_ERROR
        timings["total"] = (perf_counter() - total_started) * 1000
        return RectificationResult(
            status=status,
            request_id=request_uuid,
            original_dimensions=(width, height),
            rectified_dimensions=rectified_dimensions,
            corners=None if accepted is None else accepted.round(3).tolist(),
            detector_used=detector_used,
            opencv=opencv.summary(),
            docquadnet=docquad.summary(),
            detector_iou=iou,
            detector_corner_distance_ratio=distance_ratio,
            quality_metrics=quality,
            timings_ms=timings,
            warnings=warnings,
            rejection_codes=list(dict.fromkeys(rejected)),
            rectified_image=rectified_bytes,
        )
