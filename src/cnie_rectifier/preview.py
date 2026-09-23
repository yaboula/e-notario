from __future__ import annotations

from .classical import OpenCvDetector
from .config import RectifierConfig
from .image_io import decode_image
from .quality import capture_quality


def preview_capture(payload: bytes, detector: OpenCvDetector, config: RectifierConfig) -> dict:
    """Advisory geometry on a small frame; no OCR, image retention or acceptance."""
    image, _ = decode_image(payload, max_pixels=1024 * 1024)
    height, width = image.shape[:2]
    result = detector.detect(image)
    response = {"dimensions": [width, height], "corners": None, "guidance": "searching"}
    if not result.valid or result.corners is None:
        return response
    quality = capture_quality(image, result.corners, config)
    if not quality["quad_inside_image"] or not quality["quad_convex"] or quality["quad_self_intersecting"]:
        return response
    response["corners"] = [[round(float(x) / (width - 1), 5), round(float(y) / (height - 1), 5)]
                           for x, y in result.corners]
    if quality["card_diagonal_ratio"] < config.min_card_diagonal_ratio:
        response["guidance"] = "closer"
    elif quality["border_distance_ratio"] < config.min_border_distance_ratio:
        response["guidance"] = "margin"
    elif quality["mean_luminance"] < config.min_mean_luminance or quality["mean_luminance"] > config.max_mean_luminance:
        response["guidance"] = "lighting"
    else:
        response["guidance"] = "ready"
    return response
