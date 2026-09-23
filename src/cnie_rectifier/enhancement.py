from __future__ import annotations

import cv2
import numpy as np


def enhance_card(image: np.ndarray) -> tuple[np.ndarray, dict[str, object]]:
    """Bounded illumination balancing. Never synthesize text or remove content.

    Estimate only broad illumination on a small copy, excluding high-frequency
    letters. Limit luminance corrections to 12 levels; leave well-lit cards alone.
    The caller measures sharpness on the unmodified rectification.
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    luminance = lab[:, :, 0]
    small = cv2.resize(luminance, (256, 160), interpolation=cv2.INTER_AREA)
    background = cv2.GaussianBlur(small.astype(np.float32), (0, 0), 18)
    low, high = np.percentile(background, [10, 90])
    metrics: dict[str, object] = {
        "illumination_range": round(float(high - low), 3),
        "illumination_balanced": False,
        "max_luminance_correction": 0.0,
        "resampling": "perspective_bicubic",
        "neural_upscale": False,
    }
    if high - low < 40 or low > 150:
        return image, metrics
    correction = np.clip((np.median(background) - background) * 0.35, -12, 12)
    correction = cv2.resize(correction, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_LINEAR)
    lab[:, :, 0] = np.clip(luminance.astype(np.float32) + correction, 0, 255).astype(np.uint8)
    metrics.update(illumination_balanced=True, max_luminance_correction=round(float(np.abs(correction).max()), 3))
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR), metrics
