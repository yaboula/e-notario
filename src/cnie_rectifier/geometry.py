from __future__ import annotations

import math

import cv2
import numpy as np


def order_quad(points: np.ndarray) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float32).reshape(4, 2)
    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    ordered = pts[np.argsort(angles)]
    start = int(np.argmin(ordered.sum(axis=1)))
    ordered = np.roll(ordered, -start, axis=0)
    # After angular sorting in image coordinates the order is TL, TR, BR, BL.
    if signed_area(ordered) < 0:
        ordered = ordered[[0, 3, 2, 1]]
    return ordered.astype(np.float32)


def signed_area(quad: np.ndarray) -> float:
    q = np.asarray(quad, dtype=np.float64)
    return float(0.5 * np.sum(q[:, 0] * np.roll(q[:, 1], -1) - q[:, 1] * np.roll(q[:, 0], -1)))


def quad_area(quad: np.ndarray) -> float:
    return abs(signed_area(quad))


def is_convex(quad: np.ndarray) -> bool:
    q = np.asarray(quad, dtype=np.float32).reshape(4, 2)
    return bool(cv2.isContourConvex(q.reshape(-1, 1, 2)))


def _orientation(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    ab = b - a
    ac = c - a
    return float(ab[0] * ac[1] - ab[1] * ac[0])


def _proper_intersection(a: np.ndarray, b: np.ndarray, c: np.ndarray, d: np.ndarray) -> bool:
    o1, o2 = _orientation(a, b, c), _orientation(a, b, d)
    o3, o4 = _orientation(c, d, a), _orientation(c, d, b)
    return o1 * o2 < 0 and o3 * o4 < 0


def is_self_intersecting(quad: np.ndarray) -> bool:
    q = np.asarray(quad, dtype=np.float64).reshape(4, 2)
    return _proper_intersection(q[0], q[1], q[2], q[3]) or _proper_intersection(
        q[1], q[2], q[3], q[0]
    )


def quad_inside_image(quad: np.ndarray, width: int, height: int, tolerance: float = 0.0) -> bool:
    q = np.asarray(quad, dtype=np.float64)
    return bool(
        np.isfinite(q).all()
        and np.all(q[:, 0] >= -tolerance)
        and np.all(q[:, 1] >= -tolerance)
        and np.all(q[:, 0] <= width - 1 + tolerance)
        and np.all(q[:, 1] <= height - 1 + tolerance)
    )


def edge_lengths(quad: np.ndarray) -> np.ndarray:
    q = np.asarray(quad, dtype=np.float64)
    return np.linalg.norm(q - np.roll(q, -1, axis=0), axis=1)


def estimated_short_side(quad: np.ndarray) -> float:
    lengths = edge_lengths(quad)
    return float(min((lengths[0] + lengths[2]) / 2, (lengths[1] + lengths[3]) / 2))


def card_diagonal_ratio(quad: np.ndarray, width: int, height: int) -> float:
    """Orientation-independent occupancy of the frame by the document."""
    q = order_quad(quad).astype(np.float64)
    card_diagonal = max(float(np.linalg.norm(q[2] - q[0])), float(np.linalg.norm(q[3] - q[1])))
    return card_diagonal / max(math.hypot(width, height), 1.0)


def border_distance_ratio(quad: np.ndarray, width: int, height: int) -> float:
    q = np.asarray(quad, dtype=np.float64)
    distances = np.column_stack((q[:, 0], q[:, 1], width - 1 - q[:, 0], height - 1 - q[:, 1]))
    return float(np.min(distances) / max(math.hypot(width, height), 1.0))


def quad_iou(a: np.ndarray, b: np.ndarray) -> float:
    qa = order_quad(a).astype(np.float32)
    qb = order_quad(b).astype(np.float32)
    area_a, area_b = quad_area(qa), quad_area(qb)
    if area_a <= 0 or area_b <= 0:
        return 0.0
    intersection, _ = cv2.intersectConvexConvex(qa, qb)
    union = area_a + area_b - float(intersection)
    return 0.0 if union <= 0 else float(intersection / union)


def mean_corner_distance_ratio(a: np.ndarray, b: np.ndarray, width: int, height: int) -> float:
    qa, qb = order_quad(a), order_quad(b)
    return float(np.linalg.norm(qa - qb, axis=1).mean() / math.hypot(width, height))


def _sample_edge_support(edges: np.ndarray, quad: np.ndarray, radius: int = 3) -> float:
    h, w = edges.shape
    dilated = cv2.dilate(edges, np.ones((radius * 2 + 1, radius * 2 + 1), np.uint8))
    supported = total = 0
    q = np.asarray(quad, dtype=np.float32)
    for p0, p1 in zip(q, np.roll(q, -1, axis=0)):
        count = max(20, int(np.linalg.norm(p1 - p0) / 3))
        samples = np.linspace(p0, p1, count)
        xs = np.clip(np.rint(samples[:, 0]).astype(int), 0, w - 1)
        ys = np.clip(np.rint(samples[:, 1]).astype(int), 0, h - 1)
        supported += int(np.count_nonzero(dilated[ys, xs]))
        total += count
    return float(supported / max(total, 1))


def edge_support(gray: np.ndarray, quad: np.ndarray) -> float:
    median = float(np.median(gray))
    low = int(max(20, 0.66 * median))
    high = int(min(255, max(low + 30, 1.33 * median)))
    edges = cv2.Canny(gray, low, high, L2gradient=True)
    return _sample_edge_support(edges, quad)


def _edge_support_by_side(edges: np.ndarray, quad: np.ndarray, radius: int = 4) -> list[float]:
    h, w = edges.shape
    dilated = cv2.dilate(edges, np.ones((radius * 2 + 1, radius * 2 + 1), np.uint8))
    output: list[float] = []
    q = order_quad(quad)
    for p0, p1 in zip(q, np.roll(q, -1, axis=0)):
        count = max(20, int(np.linalg.norm(p1 - p0) / 3))
        samples = np.linspace(p0, p1, count)
        xs = np.clip(np.rint(samples[:, 0]).astype(int), 0, w - 1)
        ys = np.clip(np.rint(samples[:, 1]).astype(int), 0, h - 1)
        output.append(float(np.mean(dilated[ys, xs] > 0)))
    return output


def boundary_edge_evidence(
    image_bgr: np.ndarray,
    quad: np.ndarray,
    *,
    max_side: int = 1600,
    side_threshold: float = 0.15,
) -> dict[str, float | int | list[float]]:
    """Measure document boundaries in luminance and chroma on a bounded copy.

    CNIE borders can have little grayscale contrast against a bright surface but
    still have a strong colour transition. Keeping both measurements prevents a
    global Canny threshold from becoming a single point of failure.
    """
    height, width = image_bgr.shape[:2]
    scale = min(1.0, float(max_side) / max(width, height))
    if scale < 1.0:
        work = cv2.resize(
            image_bgr,
            (round(width * scale), round(height * scale)),
            interpolation=cv2.INTER_AREA,
        )
    else:
        work = image_bgr
    work_quad = order_quad(quad) * scale
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(work, cv2.COLOR_BGR2LAB)
    blurred_gray = cv2.GaussianBlur(gray, (5, 5), 0)
    gray_edges = cv2.Canny(blurred_gray, 25, 100, L2gradient=True)
    edge_maps = [gray_edges]
    for channel in (1, 2):
        chroma = cv2.GaussianBlur(lab[:, :, channel], (5, 5), 0)
        edge_maps.append(cv2.Canny(chroma, 8, 28, L2gradient=True))
    color_edges = np.maximum.reduce(edge_maps)
    side_support = _edge_support_by_side(color_edges, work_quad, radius=4)
    return {
        "grayscale_edge_support": _sample_edge_support(gray_edges, work_quad, radius=4),
        "color_edge_support": _sample_edge_support(color_edges, work_quad, radius=4),
        "boundary_side_support": side_support,
        "boundary_supported_sides": int(sum(value >= side_threshold for value in side_support)),
        "boundary_analysis_scale": scale,
    }


def refine_quad_with_edges(
    image_bgr: np.ndarray, initial: np.ndarray, max_side: int = 1600
) -> np.ndarray:
    """Fit four edge lines on a bounded working copy and map intersections to source coordinates."""
    original_h, original_w = image_bgr.shape[:2]
    scale = min(1.0, max_side / max(original_w, original_h))
    if scale < 1.0:
        work = cv2.resize(
            image_bgr,
            (round(original_w * scale), round(original_h * scale)),
            interpolation=cv2.INTER_AREA,
        )
    else:
        work = image_bgr
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 45, 140, L2gradient=True)
    ys, xs = np.nonzero(edges)
    pixels = np.column_stack((xs, ys)).astype(np.float32)
    q = order_quad(initial) * scale
    fitted: list[tuple[np.ndarray, np.ndarray]] = []
    for a, b in zip(q, np.roll(q, -1, axis=0)):
        vector = b - a
        length = float(np.linalg.norm(vector))
        if length < 20 or pixels.size == 0:
            return order_quad(initial)
        unit = vector / length
        rel = pixels - a
        along = rel @ unit
        perpendicular = np.abs(rel[:, 0] * unit[1] - rel[:, 1] * unit[0])
        band = max(3.0, min(12.0, length * 0.012))
        selected = pixels[(along >= -band) & (along <= length + band) & (perpendicular <= band)]
        if len(selected) < max(20, int(length * 0.08)):
            return order_quad(initial)
        vx, vy, x0, y0 = cv2.fitLine(selected, cv2.DIST_HUBER, 0, 0.01, 0.01).reshape(-1)
        fitted.append((np.array([x0, y0], np.float64), np.array([vx, vy], np.float64)))

    intersections = []
    for index in range(4):
        p1, d1 = fitted[index - 1]
        p2, d2 = fitted[index]
        matrix = np.column_stack((d1, -d2))
        det = float(np.linalg.det(matrix))
        if abs(det) < 1e-5:
            return order_quad(initial)
        t = np.linalg.solve(matrix, p2 - p1)[0]
        intersections.append(p1 + t * d1)
    refined = order_quad(np.asarray(intersections, dtype=np.float32))
    displacement = np.linalg.norm(refined - q, axis=1)
    if np.max(displacement) > max(work.shape[:2]) * 0.04:
        return order_quad(initial)
    return refined / scale


def warp_card(image_bgr: np.ndarray, quad: np.ndarray, width: int, height: int) -> tuple[np.ndarray, dict[str, float]]:
    source = order_quad(quad).astype(np.float32)
    lengths = edge_lengths(source)
    rotated_to_landscape = False
    if (lengths[0] + lengths[2]) < (lengths[1] + lengths[3]):
        source = np.roll(source, -1, axis=0)
        rotated_to_landscape = True
    target = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(source, target)
    if not np.isfinite(matrix).all() or abs(float(np.linalg.det(matrix))) < 1e-12:
        raise ValueError("DEGENERATE_HOMOGRAPHY")
    condition = float(np.linalg.cond(matrix))
    if not np.isfinite(condition) or condition > 1e12:
        raise ValueError("DEGENERATE_HOMOGRAPHY")
    warped = cv2.warpPerspective(
        image_bgr,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )
    rim = np.zeros((height, width), dtype=np.uint8)
    thickness = max(2, min(width, height) // 250)
    rim[:thickness] = 1
    rim[-thickness:] = 1
    rim[:, :thickness] = 1
    rim[:, -thickness:] = 1
    black = np.all(warped <= 2, axis=2)
    black_border_ratio = float(np.count_nonzero(black & (rim > 0)) / np.count_nonzero(rim))
    return warped, {
        "homography_condition": condition,
        "black_border_ratio": black_border_ratio,
        "rotated_to_landscape": rotated_to_landscape,
    }
