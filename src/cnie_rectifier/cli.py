from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .benchmark import run_benchmark
from .config import DEFAULT_MODEL_PATH
from .docquad import DocQuadDetector
from .rectifier import CnieRectifier


def _json_dump(data: object) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cnie-rectifier")
    subcommands = parser.add_subparsers(dest="command", required=True)

    inspect = subcommands.add_parser("inspect", help="Detect and rectify one capture")
    inspect.add_argument("--input", type=Path, required=True)
    inspect.add_argument("--output-image", type=Path)
    inspect.add_argument("--output-json", type=Path)
    inspect.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    inspect.add_argument(
        "--detector", choices=("hybrid", "opencv", "docquadnet"), default="hybrid"
    )

    benchmark = subcommands.add_parser("benchmark", help="Evaluate all detector strategies")
    benchmark.add_argument("--manifest", type=Path, required=True)
    benchmark.add_argument("--output", type=Path, required=True)
    benchmark.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)

    model_info = subcommands.add_parser("model-info", help="Inspect the pinned ONNX model")
    model_info.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "model-info":
            print(_json_dump(DocQuadDetector(config=_default_config(), model_path=args.model).model_info()))
            return 0
        if args.command == "inspect":
            result = CnieRectifier(model_path=args.model, detector_mode=args.detector).rectify(
                args.input.read_bytes()
            )
            metadata = result.to_dict()
            if args.output_json is not None:
                args.output_json.parent.mkdir(parents=True, exist_ok=True)
                args.output_json.write_text(_json_dump(metadata) + "\n", encoding="utf-8")
            if args.output_image is not None and result.rectified_image is not None:
                args.output_image.parent.mkdir(parents=True, exist_ok=True)
                args.output_image.write_bytes(result.rectified_image)
            print(_json_dump(metadata))
            return 0 if result.status.value == "success" else 2
        report = run_benchmark(args.manifest, model_path=args.model)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(_json_dump(report) + "\n", encoding="utf-8")
        print(_json_dump({"sample_count": report["sample_count"], "gate": report["gate"], "recommendation": report["recommendation"]}))
        return 0
    except OSError as exc:
        print(f"error: {type(exc).__name__}", file=sys.stderr)
        return 1
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


def _default_config():
    from .config import RectifierConfig

    return RectifierConfig()


if __name__ == "__main__":
    raise SystemExit(main())
