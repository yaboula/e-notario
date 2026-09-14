import json

from PIL import Image

from cnie_rectifier.benchmark import run_benchmark


def test_benchmark_compares_all_modes_without_leaking_paths(tmp_path):
    image_path = tmp_path / "negative.png"
    Image.new("RGB", (320, 240), (60, 60, 60)).save(image_path)
    manifest = tmp_path / "manifest.jsonl"
    manifest.write_text(
        json.dumps({"image": image_path.name, "conformant": False, "negative": True})
        + "\n",
        encoding="utf-8",
    )
    report = run_benchmark(manifest)
    assert report["sample_count"] == 1
    assert set(report["summaries"]) == {"opencv", "docquadnet", "hybrid"}
    for samples in report["samples"].values():
        assert "image" not in samples[0]
