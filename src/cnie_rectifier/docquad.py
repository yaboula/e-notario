from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any

import cv2
import numpy as np

from .config import DEFAULT_MODEL_PATH, MODEL_COMMIT, MODEL_SHA256, RectifierConfig
from .domain import DetectorResult
from .geometry import (
    boundary_edge_evidence,
    edge_lengths,
    is_convex,
    is_self_intersecting,
    order_quad,
    quad_area,
    quad_inside_image,
)


@dataclass(frozen=True, slots=True)
class Letterbox:
    scale: float
    offset_x: float
    offset_y: float
    source_width: int
    source_height: int


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def preprocess(image_bgr: np.ndarray) -> tuple[np.ndarray, Letterbox]:
    """Upstream preprocessing: RGB letterbox, bilinear, black pad, NCHW /255."""
    height, width = image_bgr.shape[:2]
    scale = min(256.0 / width, 256.0 / height)
    offset_x = (256.0 - width * scale) / 2.0
    offset_y = (256.0 - height * scale) / 2.0
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    matrix = np.array([[scale, 0.0, offset_x], [0.0, scale, offset_y]], dtype=np.float32)
    canvas = cv2.warpAffine(
        rgb,
        matrix,
        (256, 256),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )
    tensor = np.transpose(canvas.astype(np.float32) / 255.0, (2, 0, 1))[None]
    return np.ascontiguousarray(tensor), Letterbox(
        scale=scale,
        offset_x=offset_x,
        offset_y=offset_y,
        source_width=width,
        source_height=height,
    )


def _sigmoid(values: np.ndarray) -> np.ndarray:
    positive = values >= 0
    output = np.empty_like(values, dtype=np.float64)
    output[positive] = 1.0 / (1.0 + np.exp(-values[positive]))
    exponential = np.exp(values[~positive])
    output[~positive] = exponential / (1.0 + exponential)
    return output


def refined_heatmap_corners(heatmaps: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if tuple(heatmaps.shape) != (1, 4, 64, 64):
        raise ValueError(f"Unexpected corner_heatmaps shape: {tuple(heatmaps.shape)}")
    corners = np.zeros((4, 2), dtype=np.float64)
    peak_logits = np.zeros(4, dtype=np.float64)
    for channel in range(4):
        heatmap = heatmaps[0, channel]
        flat_index = int(np.argmax(heatmap))
        y, x = divmod(flat_index, 64)
        peak_logits[channel] = float(heatmap[y, x])
        x0, x1 = max(0, x - 1), min(63, x + 1)
        y0, y1 = max(0, y - 1), min(63, y + 1)
        window = heatmap[y0 : y1 + 1, x0 : x1 + 1].astype(np.float64)
        weights = np.exp(window - np.max(window))
        grid_y, grid_x = np.mgrid[y0 : y1 + 1, x0 : x1 + 1]
        total = float(weights.sum())
        if total == 0 or not math.isfinite(total):
            x64, y64 = x + 0.5, y + 0.5
        else:
            x64 = float(np.sum(weights * (grid_x + 0.5)) / total)
            y64 = float(np.sum(weights * (grid_y + 0.5)) / total)
        corners[channel] = (x64 * 4.0, y64 * 4.0)
    return corners, peak_logits


def corner_peak_prominences(heatmaps: np.ndarray, exclusion_radius: int = 3) -> np.ndarray:
    """Logit distance from each peak to the best spatially distinct alternative."""
    if tuple(heatmaps.shape) != (1, 4, 64, 64):
        raise ValueError(f"Unexpected corner_heatmaps shape: {tuple(heatmaps.shape)}")
    output = np.zeros(4, dtype=np.float64)
    for channel in range(4):
        heatmap = heatmaps[0, channel]
        flat_index = int(np.argmax(heatmap))
        y, x = divmod(flat_index, 64)
        alternatives = np.ones(heatmap.shape, dtype=bool)
        alternatives[
            max(0, y - exclusion_radius) : min(64, y + exclusion_radius + 1),
            max(0, x - exclusion_radius) : min(64, x + exclusion_radius + 1),
        ] = False
        second = float(np.max(heatmap[alternatives]))
        output[channel] = float(heatmap[y, x]) - second
    return output


def mask_alignment_metrics(mask_logits: np.ndarray, quad256: np.ndarray) -> dict[str, float | int]:
    """Compare the selected quadrilateral with the model mask and its topology."""
    if tuple(mask_logits.shape) != (1, 1, 64, 64):
        raise ValueError(f"Unexpected mask_logits shape: {tuple(mask_logits.shape)}")
    mask = (_sigmoid(mask_logits[0, 0]) > 0.5).astype(np.uint8)
    polygon = np.zeros((64, 64), dtype=np.uint8)
    cv2.fillConvexPoly(polygon, np.rint(order_quad(quad256) / 4.0).astype(np.int32), 1)
    intersection = int(np.count_nonzero((mask > 0) & (polygon > 0)))
    union = int(np.count_nonzero((mask > 0) | (polygon > 0)))
    mask_pixels = int(np.count_nonzero(mask))
    component_count, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    component_areas = stats[1:, cv2.CC_STAT_AREA] if component_count > 1 else np.empty(0)
    material_components = component_areas[component_areas >= 8]
    largest_ratio = (
        float(material_components.max() / mask_pixels)
        if mask_pixels and material_components.size
        else 0.0
    )
    return {
        "mask_quad_iou": float(intersection / max(union, 1)),
        "mask_material_components": int(material_components.size),
        "mask_largest_component_ratio": largest_ratio,
    }


def quad_from_mask(mask_logits: np.ndarray, fallback: np.ndarray) -> tuple[np.ndarray, bool, dict[str, float | int]]:
    if tuple(mask_logits.shape) != (1, 1, 64, 64):
        raise ValueError(f"Unexpected mask_logits shape: {tuple(mask_logits.shape)}")
    probabilities = _sigmoid(mask_logits[0, 0])
    ys, xs = np.nonzero(probabilities > 0.5)
    stats: dict[str, float | int] = {
        "mask_pixel_count": int(len(xs)),
        "mask_probability_mean": float(probabilities.mean()),
    }
    if len(xs) == 0:
        return fallback.copy(), True, stats
    points = np.column_stack((xs + 0.5, ys + 0.5)).astype(np.float64)
    center = points.mean(axis=0)
    centered = points - center
    covariance = centered.T @ centered / len(points)
    trace = float(np.trace(covariance))
    if not math.isfinite(trace) or trace < 1e-12:
        return fallback.copy(), True, stats
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    v1 = eigenvectors[:, int(np.argmax(eigenvalues))]
    # Match the source's deterministic sign sufficiently; canonicalization removes it.
    if abs(v1[0]) >= abs(v1[1]) and v1[0] < 0 or abs(v1[1]) > abs(v1[0]) and v1[1] < 0:
        v1 = -v1
    v2 = np.array([-v1[1], v1[0]])
    u = centered @ v1
    v = centered @ v2
    u_min, u_max = float(u.min()), float(u.max())
    v_min, v_max = float(v.min()), float(v.max())
    if u_max - u_min < 1e-12 or v_max - v_min < 1e-12:
        return fallback.copy(), True, stats
    quad64 = np.array(
        [
            center + u_max * v1 + v_max * v2,
            center + u_min * v1 + v_max * v2,
            center + u_min * v1 + v_min * v2,
            center + u_max * v1 + v_min * v2,
        ]
    )
    return order_quad(quad64 * 4.0).astype(np.float64), False, stats


def _geometry_penalty(quad: np.ndarray) -> float:
    q = np.asarray(quad, dtype=np.float64)
    if q.shape != (4, 2) or not np.isfinite(q).all():
        return 1e6
    penalty = 0.0
    under = np.maximum(0.0, -2.0 - q)
    over = np.maximum(0.0, q - 257.0)
    oob = np.maximum(under, over)
    penalty += float(oob.sum()) * 10.0
    oob_max = float(oob.max())
    if oob_max > 16:
        penalty += 1e5 + (oob_max - 16) * 1000
    if is_self_intersecting(q):
        penalty += 1e6
    if not is_convex(q):
        penalty += 1e6
    if quad_area(q) <= 1:
        penalty += 1e6
    lengths = edge_lengths(q)
    edge_min, edge_max = float(lengths.min()), float(lengths.max())
    if edge_min < 8:
        penalty += (8 - edge_min) * 1000
    ratio = edge_max / max(edge_min, 1e-9)
    if ratio > 25:
        penalty += (ratio - 25) * 100
    return penalty


def _mask_disagreement(quad: np.ndarray, mask_logits: np.ndarray) -> float:
    contour = (np.asarray(quad, dtype=np.float32) / 4.0).reshape(-1, 1, 2)
    probabilities = _sigmoid(mask_logits[0, 0])
    disagree = 0
    for y in range(0, 64, 8):
        for x in range(0, 64, 8):
            inside = cv2.pointPolygonTest(contour, (x + 0.5, y + 0.5), False) >= 0
            if inside != bool(probabilities[y, x] > 0.5):
                disagree += 1
    return float(disagree * 10)


def choose_model_quad(corners: np.ndarray, mask_quad: np.ndarray, mask_fallback: bool, mask_logits: np.ndarray) -> tuple[np.ndarray, str, float, float]:
    corner_geometry = _geometry_penalty(corners)
    corner_penalty = corner_geometry + _mask_disagreement(corners, mask_logits)
    if mask_fallback:
        return corners, "corners", corner_penalty, math.inf
    mask_penalty = _geometry_penalty(mask_quad)
    if corner_geometry >= 1e5 and mask_penalty < 1e5:
        return mask_quad, "mask", corner_penalty, mask_penalty
    if mask_penalty >= 1e5:
        return corners, "corners", corner_penalty, mask_penalty
    if float(np.linalg.norm(corners - mask_quad, axis=1).max()) > 32.0:
        return corners, "corners", corner_penalty, mask_penalty
    if mask_penalty < corner_geometry - 50.0:
        return mask_quad, "mask", corner_penalty, mask_penalty
    return corners, "corners", corner_penalty, mask_penalty


def map_to_original(quad256: np.ndarray, letterbox: Letterbox) -> np.ndarray:
    result = np.asarray(quad256, dtype=np.float64).copy()
    result[:, 0] = (result[:, 0] - letterbox.offset_x) / letterbox.scale
    result[:, 1] = (result[:, 1] - letterbox.offset_y) / letterbox.scale
    return order_quad(result)


class DocQuadDetector:
    def __init__(self, config: RectifierConfig, model_path: Path | str = DEFAULT_MODEL_PATH):
        self.config = config
        self.model_path = Path(model_path)
        self._session: Any | None = None
        self._load_error: str | None = None

    def _load(self) -> Any:
        if self._session is not None:
            return self._session
        if self._load_error is not None:
            raise RuntimeError(self._load_error)
        try:
            import onnxruntime as ort

            if not self.model_path.is_file():
                raise FileNotFoundError("DocQuadNet model file is missing")
            actual_hash = _sha256(self.model_path)
            if actual_hash.lower() != MODEL_SHA256:
                raise ValueError("DocQuadNet model SHA-256 does not match the pinned artifact")
            options = ort.SessionOptions()
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            options.intra_op_num_threads = 0
            self._session = ort.InferenceSession(
                str(self.model_path), sess_options=options, providers=["CPUExecutionProvider"]
            )
            self._verify_contract(self._session)
            return self._session
        except Exception as exc:
            self._load_error = f"{type(exc).__name__}: {exc}"
            raise RuntimeError(self._load_error) from exc

    @staticmethod
    def _verify_contract(session: Any) -> None:
        inputs = session.get_inputs()
        outputs = {output.name: output for output in session.get_outputs()}
        if len(inputs) != 1 or inputs[0].name != "input" or list(inputs[0].shape) != [1, 3, 256, 256]:
            raise ValueError("Unexpected DocQuadNet input contract")
        if "corner_heatmaps" not in outputs or list(outputs["corner_heatmaps"].shape) != [1, 4, 64, 64]:
            raise ValueError("Unexpected corner_heatmaps contract")
        if "mask_logits" not in outputs or list(outputs["mask_logits"].shape) != [1, 1, 64, 64]:
            raise ValueError("Unexpected mask_logits contract")

    def detect(self, image_bgr: np.ndarray) -> DetectorResult:
        started = perf_counter()
        try:
            session = self._load()
            tensor, letterbox = preprocess(image_bgr)
            inference_started = perf_counter()
            heatmaps, mask_logits = session.run(
                ["corner_heatmaps", "mask_logits"], {"input": tensor}
            )
            inference_ms = (perf_counter() - inference_started) * 1000
            corners, peak_logits = refined_heatmap_corners(heatmaps)
            peak_prominences = corner_peak_prominences(heatmaps)
            mask_quad, mask_fallback, mask_stats = quad_from_mask(mask_logits, corners)
            chosen, source, corner_penalty, mask_penalty = choose_model_quad(
                corners, mask_quad, mask_fallback, mask_logits
            )
            original = map_to_original(chosen, letterbox)
            height, width = image_bgr.shape[:2]
            peak_scores = _sigmoid(peak_logits)
            mask_alignment = mask_alignment_metrics(mask_logits, chosen)
            boundary = boundary_edge_evidence(
                image_bgr,
                original,
                max_side=self.config.work_max_side,
                side_threshold=self.config.min_boundary_side_support,
            )
            color_support = float(boundary["color_edge_support"])
            # A ranking score only; it is deliberately not exposed as a calibrated probability.
            score = float(
                0.35 * np.min(peak_scores)
                + 0.25 * float(mask_alignment["mask_quad_iou"])
                + 0.20 * float(mask_alignment["mask_largest_component_ratio"])
                + 0.20 * color_support
            )
            rejection_codes: list[str] = []
            if not quad_inside_image(original, width, height, tolerance=1.0):
                rejection_codes.append("QUADRILATERAL_OUT_OF_BOUNDS")
            if not is_convex(original) or is_self_intersecting(original) or quad_area(original) <= 1:
                rejection_codes.append("INVALID_QUADRILATERAL_GEOMETRY")
            if (
                color_support < self.config.min_color_edge_support
                or int(boundary["boundary_supported_sides"])
                < self.config.min_boundary_supported_sides
            ):
                rejection_codes.append("INSUFFICIENT_EDGE_SUPPORT")
            if float(np.min(peak_scores)) < self.config.min_docquad_corner_score:
                rejection_codes.append("WEAK_CORNER_EVIDENCE")
            if float(np.min(peak_prominences)) < self.config.min_docquad_peak_prominence:
                rejection_codes.append("AMBIGUOUS_CORNER_EVIDENCE")
            if (
                float(mask_alignment["mask_quad_iou"]) < self.config.min_docquad_mask_iou
                or float(mask_alignment["mask_largest_component_ratio"])
                < self.config.min_docquad_mask_component_ratio
            ):
                rejection_codes.append("MODEL_MASK_DISAGREEMENT")
            if score < self.config.min_docquad_score:
                rejection_codes.append("LOW_MODEL_SCORE")
            return DetectorResult(
                valid=not rejection_codes,
                corners=original,
                score=score,
                rejection_codes=rejection_codes,
                metrics={
                    **mask_stats,
                    "chosen_source": source,
                    "corner_penalty": corner_penalty,
                    "mask_penalty": None if not math.isfinite(mask_penalty) else mask_penalty,
                    "corner_peak_scores": peak_scores.tolist(),
                    "corner_peak_prominences": peak_prominences.tolist(),
                    **mask_alignment,
                    **boundary,
                    "inference_ms": inference_ms,
                    "elapsed_ms": (perf_counter() - started) * 1000,
                },
            )
        except Exception as exc:
            return DetectorResult(
                valid=False,
                available=False,
                error=f"{type(exc).__name__}: {exc}",
                rejection_codes=["MODEL_UNAVAILABLE"],
                metrics={"elapsed_ms": (perf_counter() - started) * 1000},
            )

    def model_info(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "path_present": self.model_path.is_file(),
            "sha256_expected": MODEL_SHA256,
            "commit": MODEL_COMMIT,
            "provider_requested": "CPUExecutionProvider",
        }
        if not self.model_path.is_file():
            return info
        info["sha256"] = _sha256(self.model_path)
        try:
            import onnx

            model = onnx.load(str(self.model_path), load_external_data=False)
            onnx.checker.check_model(model)
            info["onnx_checker"] = "ok"
            info["opsets"] = [
                {"domain": item.domain or "ai.onnx", "version": item.version}
                for item in model.opset_import
            ]
        except Exception as exc:
            info["onnx_checker"] = f"error: {type(exc).__name__}: {exc}"
        try:
            session = self._load()
            info["providers"] = session.get_providers()
            info["inputs"] = [
                {"name": item.name, "shape": item.shape, "type": item.type}
                for item in session.get_inputs()
            ]
            info["outputs"] = [
                {"name": item.name, "shape": item.shape, "type": item.type}
                for item in session.get_outputs()
            ]
        except Exception as exc:
            info["load_error"] = f"{type(exc).__name__}: {exc}"
        return info
