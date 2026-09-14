from pathlib import Path

import numpy as np

from cnie_rectifier.config import DEFAULT_MODEL_PATH, MODEL_SHA256, RectifierConfig
from cnie_rectifier.docquad import DocQuadDetector, map_to_original, preprocess, refined_heatmap_corners


def test_preprocess_contract_and_black_letterbox():
    image = np.full((100, 200, 3), 255, np.uint8)
    tensor, letterbox = preprocess(image)
    assert tensor.shape == (1, 3, 256, 256)
    assert tensor.dtype == np.float32
    assert np.all(tensor[:, :, :50, :] == 0)
    assert letterbox.offset_y == 64
    mapped = map_to_original(
        np.array([[0, 64], [256, 64], [256, 192], [0, 192]], np.float64), letterbox
    )
    assert np.allclose(mapped, [[0, 0], [200, 0], [200, 100], [0, 100]])


def test_heatmap_refinement_uses_pixel_centers():
    heatmaps = np.full((1, 4, 64, 64), -20, np.float32)
    coordinates = [(2, 3), (60, 4), (59, 61), (3, 60)]
    for channel, (x, y) in enumerate(coordinates):
        heatmaps[0, channel, y, x] = 10
    corners, logits = refined_heatmap_corners(heatmaps)
    expected = np.array([[(x + 0.5) * 4, (y + 0.5) * 4] for x, y in coordinates])
    assert np.allclose(corners, expected, atol=1e-5)
    assert np.all(logits == 10)


def test_pinned_model_is_valid_and_loadable():
    assert Path(DEFAULT_MODEL_PATH).is_file()
    info = DocQuadDetector(RectifierConfig()).model_info()
    assert info["sha256"] == MODEL_SHA256
    assert info["onnx_checker"] == "ok"
    assert info["inputs"][0]["shape"] == [1, 3, 256, 256]
    assert {item["name"] for item in info["outputs"]} == {"corner_heatmaps", "mask_logits"}


def test_pinned_model_runs_cpu_inference():
    image = np.full((720, 1280, 3), 45, np.uint8)
    image[120:600, 180:1100] = (205, 210, 215)
    result = DocQuadDetector(RectifierConfig(min_edge_support=0.0)).detect(image)
    assert result.available is True
    assert result.corners is not None
    assert result.corners.shape == (4, 2)
    assert result.metrics["inference_ms"] >= 0
