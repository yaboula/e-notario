from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .config import DEFAULT_MODEL_PATH, RectifierConfig
from .geometry import order_quad, quad_iou
from .rectifier import CnieRectifier


MODES = ("opencv", "docquadnet", "hybrid")


def _percentile(values: list[float], percentile: float) -> float | None:
    return None if not values else float(np.percentile(values, percentile))


def _dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def run_benchmark(
    manifest_path: Path,
    *,
    model_path: Path | str = DEFAULT_MODEL_PATH,
    config: RectifierConfig | None = None,
) -> dict[str, Any]:
    config = config or RectifierConfig()
    records = _load_manifest(manifest_path)
    engines = {
        mode: CnieRectifier(config=config, model_path=model_path, detector_mode=mode)
        for mode in MODES
    }
    raw: dict[str, list[dict[str, Any]]] = {mode: [] for mode in MODES}
    for index, record in enumerate(records):
        image_path = Path(record["image"])
        if not image_path.is_absolute():
            image_path = manifest_path.parent / image_path
        payload = image_path.read_bytes()
        width, height = _dimensions(image_path)
        diagonal = math.hypot(width, height)
        truth = None
        if record.get("corners") is not None:
            truth = order_quad(np.asarray(record["corners"], dtype=np.float32))
        for mode, engine in engines.items():
            try:
                result = engine.rectify(payload)
                result_meta: dict[str, Any] = {
                    "sample": index,
                    "status": result.status.value,
                    "success": result.status.value == "success",
                    "conformant": bool(record.get("conformant", False)),
                    "negative": bool(record.get("negative", False)),
                    "latency_ms": result.timings_ms.get("total"),
                    "warnings": result.warnings,
                    "rejection_codes": result.rejection_codes,
                    "crash": False,
                    "geometry_safe": (
                        bool(result.quality_metrics.get("quad_inside_image", False))
                        and bool(result.quality_metrics.get("quad_convex", False))
                        and not bool(result.quality_metrics.get("quad_self_intersecting", True))
                    ) if result.status.value == "success" else None,
                }
                if truth is not None and result.corners is not None:
                    predicted = order_quad(np.asarray(result.corners, dtype=np.float32))
                    result_meta["iou"] = quad_iou(predicted, truth)
                    result_meta["corner_errors"] = (
                        np.linalg.norm(predicted - truth, axis=1) / diagonal
                    ).tolist()
                raw[mode].append(result_meta)
            except Exception as exc:  # benchmark must record, not abort, a crash
                raw[mode].append(
                    {
                        "sample": index,
                        "success": False,
                        "conformant": bool(record.get("conformant", False)),
                        "negative": bool(record.get("negative", False)),
                        "crash": True,
                        "error_type": type(exc).__name__,
                    }
                )

    summaries = {mode: _summarize(items) for mode, items in raw.items()}
    hybrid = summaries["hybrid"]
    opencv = summaries["opencv"]
    gate = {
        "zero_crashes": hybrid["crashes"] == 0,
        "zero_unsafe_quadrilaterals_accepted": hybrid["unsafe_geometry_accepts"] == 0,
        "zero_negative_false_accepts": hybrid["negative_false_accepts"] == 0,
        "conformant_recall_at_least_0_95": (hybrid["conformant_recall"] or 0) >= 0.95,
        "median_iou_at_least_0_97": (hybrid["iou_median"] or 0) >= 0.97,
        "corner_error_p95_at_most_0_015": (hybrid["corner_error_p95"] or math.inf) <= 0.015,
        "latency_p95_at_most_250_ms": (hybrid["latency_p95_ms"] or math.inf) <= 250,
        "all_rejections_actionable": hybrid["rejections_without_code"] == 0,
    }
    gate["passed"] = all(gate.values())
    hybrid_promoted = (
        hybrid["negative_false_accepts"] == 0
        and hybrid["conformant_recall"] is not None
        and opencv["conformant_recall"] is not None
        and hybrid["conformant_recall"] > opencv["conformant_recall"]
    )
    return {
        "schema_version": 1,
        "sample_count": len(records),
        "summaries": summaries,
        "gate": gate,
        "recommendation": (
            "promote_hybrid" if hybrid_promoted else "keep_opencv_production_docquad_experimental"
        ),
        "samples": raw,
    }


def _load_manifest(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            record = json.loads(line)
            if "image" not in record:
                raise ValueError(f"Manifest line {line_number} has no image")
            corners = record.get("corners")
            if corners is not None and np.asarray(corners).shape != (4, 2):
                raise ValueError(f"Manifest line {line_number} corners must be 4x2")
            records.append(record)
    if not records:
        raise ValueError("Manifest is empty")
    return records


def _summarize(items: list[dict[str, Any]]) -> dict[str, Any]:
    conformant = [item for item in items if item["conformant"]]
    negatives = [item for item in items if item["negative"]]
    nonconformant = [item for item in items if not item["conformant"]]
    latencies = [float(item["latency_ms"]) for item in items if item.get("latency_ms") is not None]
    ious = [float(item["iou"]) for item in items if item.get("iou") is not None]
    corner_errors = [
        float(value) for item in items for value in item.get("corner_errors", [])
    ]
    successes = sum(bool(item.get("success")) for item in conformant)
    rejected_nonconformant = sum(not bool(item.get("success")) for item in nonconformant)
    return {
        "samples": len(items),
        "crashes": sum(bool(item.get("crash")) for item in items),
        "conformant_count": len(conformant),
        "conformant_recall": None if not conformant else successes / len(conformant),
        "nonconformant_correct_rejection": (
            None if not nonconformant else rejected_nonconformant / len(nonconformant)
        ),
        "negative_count": len(negatives),
        "negative_false_accepts": sum(bool(item.get("success")) for item in negatives),
        "unsafe_geometry_accepts": sum(
            bool(item.get("success")) and item.get("geometry_safe") is not True
            for item in items
        ),
        "iou_median": _percentile(ious, 50),
        "corner_error_mean": None if not corner_errors else float(np.mean(corner_errors)),
        "corner_error_p95": _percentile(corner_errors, 95),
        "latency_p50_ms": _percentile(latencies, 50),
        "latency_p95_ms": _percentile(latencies, 95),
        "detector_disagreements": sum(
            "DETECTOR_DISAGREEMENT" in item.get("rejection_codes", []) for item in items
        ),
        "model_fallbacks": sum(
            "MODEL_DETECTOR_MISSED" in item.get("warnings", []) for item in items
        ),
        "classical_fallbacks": sum(
            "CLASSICAL_DETECTOR_MISSED" in item.get("warnings", []) for item in items
        ),
        "rejections_without_code": sum(
            not bool(item.get("success"))
            and not bool(item.get("rejection_codes"))
            and not bool(item.get("crash"))
            for item in items
        ),
    }
