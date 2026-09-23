from __future__ import annotations

import cv2
import numpy as np

from .geometry import (
    boundary_edge_evidence,
    border_distance_ratio,
    card_diagonal_ratio,
    edge_support,
    estimated_short_side,
    is_convex,
    is_self_intersecting,
    quad_area,
    quad_inside_image,
)


def capture_quality(image_bgr: np.ndarray, quad: np.ndarray, config: object) -> dict[str, object]:
    height, width = image_bgr.shape[:2]
    analysis_scale = min(1.0, 1200.0 / max(width, height))
    if analysis_scale < 1.0:
        analysis = cv2.resize(
            image_bgr,
            (round(width * analysis_scale), round(height * analysis_scale)),
            interpolation=cv2.INTER_AREA,
        )
    else:
        analysis = image_bgr
    analysis_quad = np.asarray(quad, dtype=np.float32) * analysis_scale
    analysis_h, analysis_w = analysis.shape[:2]
    gray = cv2.cvtColor(analysis, cv2.COLOR_BGR2GRAY)
    polygon = np.zeros((analysis_h, analysis_w), np.uint8)
    cv2.fillConvexPoly(polygon, np.rint(analysis_quad).astype(np.int32), 255)
    pixels = gray[polygon > 0]
    saturation = cv2.cvtColor(analysis, cv2.COLOR_BGR2HSV)[:, :, 1][polygon > 0]
    if pixels.size:
        glare_ratio = float(np.mean((pixels >= 248) & (saturation <= 30)))
        mean_luminance = float(pixels.mean())
        luminance_p05 = float(np.percentile(pixels, 5))
        luminance_p95 = float(np.percentile(pixels, 95))
    else:
        glare_ratio = mean_luminance = luminance_p05 = luminance_p95 = 0.0
    laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    boundary = boundary_edge_evidence(
        analysis,
        analysis_quad,
        max_side=1200,
        side_threshold=config.min_boundary_side_support,
    )
    return {
        "card_area_ratio": quad_area(quad) / float(width * height),
        "card_diagonal_ratio": card_diagonal_ratio(quad, width, height),
        "card_short_side_px": estimated_short_side(quad),
        "border_distance_ratio": border_distance_ratio(quad, width, height),
        "edge_support": edge_support(gray, analysis_quad),
        "glare_ratio": glare_ratio,
        "mean_luminance": mean_luminance,
        "luminance_p05": luminance_p05,
        "luminance_p95": luminance_p95,
        "laplacian_variance": laplacian_variance,
        "analysis_scale": analysis_scale,
        "quad_inside_image": quad_inside_image(quad, width, height, tolerance=1.0),
        "quad_convex": is_convex(quad),
        "quad_self_intersecting": is_self_intersecting(quad),
        **boundary,
    }


def card_sharpness(rectified_bgr: np.ndarray) -> dict[str, object]:
    """Measure the normalized card interior, excluding its rim and background."""
    card = cv2.resize(rectified_bgr, (1000, 630), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)[25:-25, 40:-40]
    return {
        "card_laplacian_variance": float(cv2.Laplacian(gray, cv2.CV_64F)[2:-2, 2:-2].var()),
        "sharpness_analysis_dimensions": [1000, 630],
    }


def rejection_codes(metrics: dict[str, object], config: object) -> list[str]:
    codes: list[str] = []
    if not bool(metrics["quad_inside_image"]):
        codes.append("QUADRILATERAL_OUT_OF_BOUNDS")
    if not bool(metrics["quad_convex"]) or bool(metrics["quad_self_intersecting"]):
        codes.append("INVALID_QUADRILATERAL_GEOMETRY")
    if (
        float(metrics["card_area_ratio"]) < config.min_card_area_ratio
        or float(metrics["card_diagonal_ratio"]) < config.min_card_diagonal_ratio
    ):
        codes.append("CARD_TOO_SMALL_IN_FRAME")
    if float(metrics["card_area_ratio"]) > config.max_card_area_ratio:
        codes.append("CARD_TOO_CLOSE_TO_FRAME")
    if float(metrics["card_short_side_px"]) < config.min_card_short_side_px:
        codes.append("INSUFFICIENT_CARD_RESOLUTION")
    if float(metrics["border_distance_ratio"]) < config.min_border_distance_ratio:
        codes.append("CORNERS_TOO_CLOSE_TO_IMAGE_BORDER")
    color_boundary_is_weak = (
        float(metrics["color_edge_support"]) < config.min_color_edge_support
        or int(metrics["boundary_supported_sides"]) < config.min_boundary_supported_sides
    )
    if not metrics.get("manual_corners") and float(metrics["edge_support"]) < config.min_edge_support and color_boundary_is_weak:
        codes.append("INSUFFICIENT_EDGE_SUPPORT")
    if float(metrics["glare_ratio"]) > config.max_glare_ratio:
        codes.append("EXCESSIVE_GLARE")
    if float(metrics["mean_luminance"]) < config.min_mean_luminance:
        codes.append("IMAGE_TOO_DARK")
    if float(metrics["mean_luminance"]) > config.max_mean_luminance:
        codes.append("IMAGE_TOO_BRIGHT")
    if config.min_card_laplacian_variance is not None and "card_laplacian_variance" in metrics and \
            float(metrics["card_laplacian_variance"]) < config.min_card_laplacian_variance:
        codes.append("CARD_TOO_BLURRY")
    return list(dict.fromkeys(codes))
