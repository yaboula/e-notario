from __future__ import annotations

import cv2
import numpy as np
import pytest


@pytest.fixture
def synthetic_capture() -> tuple[bytes, np.ndarray]:
    image = np.full((1800, 2400, 3), (42, 55, 62), np.uint8)
    corners = np.array([[285, 310], [2115, 260], [2070, 1455], [330, 1510]], np.float32)
    cv2.fillConvexPoly(image, corners.astype(np.int32), (215, 210, 195))
    cv2.polylines(image, [corners.astype(np.int32)], True, (15, 15, 15), 12, cv2.LINE_AA)
    # Harmless synthetic detail gives realistic gradients without identity data.
    for y in range(520, 1230, 95):
        cv2.line(image, (780, y), (1840, y - 18), (80, 85, 90), 8, cv2.LINE_AA)
    cv2.rectangle(image, (430, 520), (700, 1020), (115, 120, 130), -1)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes(), corners


@pytest.fixture
def portrait_colored_capture() -> tuple[bytes, np.ndarray]:
    """Portrait phone capture with a chromatic, rounded ID-1 boundary and no PII."""
    height, width = 4032, 3024
    image = np.full((height, width, 3), (0, 205, 232), np.uint8)
    for y in range(0, height, 180):
        cv2.line(image, (0, y), (width - 1, y), (2, 202, 228), 2)
    x0, y0, x1, y1, radius = 350, 1280, 2750, 2750, 70
    card_color = (205, 216, 211)
    cv2.rectangle(image, (x0 + radius, y0), (x1 - radius, y1), card_color, -1)
    cv2.rectangle(image, (x0, y0 + radius), (x1, y1 - radius), card_color, -1)
    for center in (
        (x0 + radius, y0 + radius),
        (x1 - radius, y0 + radius),
        (x0 + radius, y1 - radius),
        (x1 - radius, y1 - radius),
    ):
        cv2.circle(image, center, radius, card_color, -1)
    cv2.rectangle(image, (x0 + 40, y0 + 40), (x1 - 40, y0 + 300), (175, 170, 205), -1)
    cv2.rectangle(image, (x0 + 180, y0 + 430), (x0 + 850, y1 - 190), (110, 105, 115), -1)
    for y in range(y0 + 450, y1 - 200, 130):
        cv2.line(image, (x0 + 1050, y), (x1 - 180, y), (65, 70, 70), 18, cv2.LINE_AA)
    cv2.rectangle(image, (x1 - 650, y0 + 510), (x1 - 180, y1 - 220), (185, 198, 190), -1)
    corners = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float32)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes(), corners


@pytest.fixture
def multiple_rectangles_capture() -> bytes:
    image = np.full((1600, 1200, 3), (45, 55, 60), np.uint8)
    cv2.rectangle(image, (80, 130), (520, 650), (205, 205, 205), -1)
    cv2.rectangle(image, (670, 760), (1130, 1450), (190, 195, 200), -1)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()
