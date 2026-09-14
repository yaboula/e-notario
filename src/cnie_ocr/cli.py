from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import unicodedata
from pathlib import Path

from .credentials import DpapiCredentialStore
from .google_vision import GoogleVisionOcrEngine
from .usage import UsageLedger


def _data_directory() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise RuntimeError("LOCALAPPDATA is not available")
    return Path(local) / "e-notario-v2"


def _engine() -> GoogleVisionOcrEngine:
    root = _data_directory()
    store = DpapiCredentialStore(root / "google-vision.credential.dpapi")
    usage = UsageLedger(root / "ocr-usage.json")
    return GoogleVisionOcrEngine(store.load, usage)


def _inspect(arguments: argparse.Namespace) -> int:
    image = Path(arguments.input).read_bytes()
    hints = ["ar", "fr"] if arguments.language_mode == "ar-fr" else None
    result = _engine().recognize(image, language_hints=hints)
    encoded = json.dumps(result.to_dict(), ensure_ascii=False, indent=2)
    if arguments.output:
        Path(arguments.output).write_text(encoded, encoding="utf-8")
    else:
        sys.stdout.write(encoded + "\n")
    return 0 if result.status.value == "success" else 2


def _normalize_arabic(value: str) -> str:
    substitutions = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه", "ـ": ""})
    normalized = unicodedata.normalize("NFKC", value).translate(substitutions)
    return "".join(character for character in normalized if not unicodedata.combining(character) and not character.isspace())


def _distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for row, left_character in enumerate(left, 1):
        current = [row]
        for column, right_character in enumerate(right, 1):
            current.append(min(current[-1] + 1, previous[column] + 1,
                               previous[column - 1] + (left_character != right_character)))
        previous = current
    return previous[-1]


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def _benchmark(arguments: argparse.Namespace) -> int:
    manifest_path = Path(arguments.manifest).resolve()
    entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not entries:
        raise ValueError("The manifest must be a non-empty JSON array")
    service = _engine()
    report: dict[str, object] = {"sample_count": len(entries), "modes": {}}
    for mode, hints in (("auto", None), ("ar-fr", ["ar", "fr"])):
        samples = []
        for index, entry in enumerate(entries):
            image_path = (manifest_path.parent / str(entry["image"])).resolve()
            result = service.recognize(image_path.read_bytes(), language_hints=hints)
            truth = _normalize_arabic(str(entry.get("arabic_truth", "")))
            predicted = _normalize_arabic(result.arabic_text)
            cer = _distance(truth, predicted) / max(1, len(truth))
            samples.append({"id": str(entry.get("id", index + 1)), "status": result.status.value,
                            "cer": cer, "latency_ms": result.metrics.get("latency_ms")})
        latencies = [float(sample["latency_ms"]) for sample in samples if sample["latency_ms"] is not None]
        cers = [float(sample["cer"]) for sample in samples]
        report["modes"][mode] = {"mean_cer": statistics.fmean(cers),
                                 "latency_p50_ms": _percentile(latencies, .5),
                                 "latency_p95_ms": _percentile(latencies, .95), "samples": samples}
    Path(arguments.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="cnie-ocr", description="Google Vision OCR diagnostic CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)
    inspect = subparsers.add_parser("inspect", help="OCR one rectified image")
    inspect.add_argument("--input", required=True)
    inspect.add_argument("--output")
    inspect.add_argument("--language-mode", choices=["auto", "ar-fr"], default="auto")
    inspect.set_defaults(handler=_inspect)
    benchmark = subparsers.add_parser("benchmark", help="Compare automatic language detection with ar+fr")
    benchmark.add_argument("--manifest", required=True, help="JSON array with image, arabic_truth and optional id")
    benchmark.add_argument("--output", required=True)
    benchmark.set_defaults(handler=_benchmark)
    arguments = parser.parse_args()
    return int(arguments.handler(arguments))


if __name__ == "__main__":
    raise SystemExit(main())
