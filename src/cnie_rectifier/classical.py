from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

import cv2
import numpy as np

from .config import RectifierConfig
from .domain import DetectorResult
from .geometry import (
    border_distance_ratio,
    edge_lengths,
    edge_support,
    is_convex,
    is_self_intersecting,
    order_quad,
    quad_area,
    quad_inside_image,
    refine_quad_with_edges,
)


@dataclass(slots=True)
class _Candidate:
    corners: np.ndarray
    score: float
    metrics: dict[str, float | str]


class OpenCvDetector:
    def __init__(self, config: RectifierConfig):
        self.config = config

    def detect(self, image_bgr: np.ndarray) -> DetectorResult:
        started = perf_counter()
        original_h, original_w = image_bgr.shape[:2]
        scale = min(1.0, self.config.work_max_side / max(original_w, original_h))
        if scale < 1.0:
            work = cv2.resize(
                image_bgr,
                (round(original_w * scale), round(original_h * scale)),
                interpolation=cv2.INTER_AREA,
            )
        else:
            work = image_bgr
        gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
        recipes = self._edge_recipes(gray)
        candidates: list[_Candidate] = []
        for recipe_name, binary in recipes:
            candidates.extend(self._extract(binary, gray, recipe_name))

        if not candidates:
            return DetectorResult(
                valid=False,
                rejection_codes=["NO_DOCUMENT_QUADRILATERAL"],
                metrics={
                    "work_scale": scale,
                    "recipes": len(recipes),
                    "candidate_count": 0,
                    "elapsed_ms": (perf_counter() - started) * 1000,
                },
            )

        candidates.sort(key=lambda item: item.score, reverse=True)
        best = candidates[0]
        original_quad = best.corners / scale
        refined = refine_quad_with_edges(image_bgr, original_quad)
        original_gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        refined_support = edge_support(original_gray, refined)
        final_score = 0.8 * best.score + 0.2 * refined_support
        rejection_codes: list[str] = []
        if final_score < self.config.min_classical_score:
            rejection_codes.append("LOW_CLASSICAL_CONFIDENCE")
        if not quad_inside_image(refined, original_w, original_h, tolerance=1.0):
            rejection_codes.append("QUADRILATERAL_OUT_OF_BOUNDS")
        if not is_convex(refined) or is_self_intersecting(refined):
            rejection_codes.append("INVALID_QUADRILATERAL_GEOMETRY")
        metrics = dict(best.metrics)
        metrics.update(
            {
                "work_scale": scale,
                "recipes": len(recipes),
                "candidate_count": len(candidates),
                "refined_edge_support": refined_support,
                "elapsed_ms": (perf_counter() - started) * 1000,
            }
        )
        return DetectorResult(
            valid=not rejection_codes,
            corners=refined,
            score=final_score,
            metrics=metrics,
            rejection_codes=rejection_codes,
        )

    @staticmethod
    def _edge_recipes(gray: np.ndarray) -> list[tuple[str, np.ndarray]]:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
        gaussian = cv2.GaussianBlur(gray, (5, 5), 0)
        bilateral = cv2.bilateralFilter(clahe, 7, 50, 50)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        results: list[tuple[str, np.ndarray]] = []
        for name, source, low, high in (
            ("gray_canny", gaussian, 40, 120),
            ("clahe_canny", bilateral, 55, 165),
            ("wide_canny", gaussian, 25, 200),
        ):
            edges = cv2.Canny(source, low, high, L2gradient=True)
            results.append((name, cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)))
        adaptive = cv2.adaptiveThreshold(
            clahe, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 7
        )
        gradient = cv2.morphologyEx(adaptive, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
        results.append(("adaptive", cv2.morphologyEx(gradient, cv2.MORPH_CLOSE, kernel)))
        return results

    def _extract(self, binary: np.ndarray, gray: np.ndarray, recipe: str) -> list[_Candidate]:
        h, w = gray.shape
        image_area = float(w * h)
        contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        output: list[_Candidate] = []
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:80]
        for contour in contours:
            contour_area = float(cv2.contourArea(contour))
            if contour_area < image_area * 0.12:
                break
            perimeter = float(cv2.arcLength(contour, True))
            if perimeter <= 0:
                continue
            for epsilon_ratio in (0.012, 0.018, 0.025, 0.035):
                approx = cv2.approxPolyDP(contour, epsilon_ratio * perimeter, True)
                if len(approx) != 4:
                    continue
                quad = order_quad(approx.reshape(4, 2))
                if not is_convex(quad) or is_self_intersecting(quad):
                    continue
                area = quad_area(quad)
                area_ratio = area / image_area
                if not 0.12 <= area_ratio <= 0.98:
                    continue
                lengths = edge_lengths(quad)
                if float(lengths.min()) < 30 or float(lengths.max() / lengths.min()) > 12:
                    continue
                support = edge_support(gray, quad)
                margin = border_distance_ratio(quad, w, h)
                rectangularity = min(1.0, contour_area / max(area, 1.0))
                area_component = min(1.0, area_ratio / 0.55)
                margin_component = min(1.0, max(0.0, margin) / 0.025)
                score = (
                    0.44 * support
                    + 0.26 * area_component
                    + 0.18 * rectangularity
                    + 0.12 * margin_component
                )
                output.append(
                    _Candidate(
                        quad,
                        float(score),
                        {
                            "recipe": recipe,
                            "area_ratio": area_ratio,
                            "edge_support": support,
                            "border_distance_ratio": margin,
                            "rectangularity": rectangularity,
                        },
                    )
                )
                break
        return output
