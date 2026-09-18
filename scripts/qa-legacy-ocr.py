"""Ephemeral, value-free QA of two canonical pre-2020 CNIE captures.

This sends the images to the configured EU Vision endpoint, as the normal
capture workflow does. It never saves OCR responses or prints personal data.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image

from cnie_capture.api import _default_ocr_components
from cnie_extract import CnieFieldExtractor
from cnie_extract.legacy import layout
from cnie_extract.legacy import REGIONS


def canonical_jpeg(path: Path) -> bytes:
    with Image.open(path) as source:
        if source.size != (1600, 1008):
            raise ValueError("CAPTURE_NOT_CANONICAL")
        output = io.BytesIO()
        source.convert("RGB").save(output, format="JPEG", quality=95)
        return output.getvalue()


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: qa-legacy-ocr.py <front> <back>", file=sys.stderr)
        return 2
    _, _, engine = _default_ocr_components()
    front = engine.recognize(canonical_jpeg(Path(sys.argv[1])))
    back = engine.recognize(canonical_jpeg(Path(sys.argv[2])))
    summary = {"front_ocr": front.status.value, "back_ocr": back.status.value,
               "front_error": front.error_code, "back_error": back.error_code,
               "front_words": front.metrics.get("word_count"),
               "back_words": back.metrics.get("word_count")}
    if front.status.value == back.status.value == "success":
        summary["layout"] = layout(front, back)
        result = CnieFieldExtractor().extract(front, back)
        summary["extraction_status"] = result.status.value
        summary["template"] = result.template
        summary["fields_present"] = sorted(key for key, field in result.fields.items()
                                           if field.normalized_value not in (None, "", []))
        summary["fields_missing"] = sorted(key for key, field in result.fields.items()
                                           if field.normalized_value in (None, "", []))
        summary["warnings"] = result.warnings
        summary["field_warnings"] = {key: field.warnings for key, field in result.fields.items()
                                     if field.warnings}
        summary["confidence"] = {key: field.confidence for key, field in result.fields.items()}
        summary["evidence_words"] = {key: sum(item.word_count for item in field.evidence)
                                     for key, field in result.fields.items()}
        summary["value_characters"] = {key: len(str(field.normalized_value or ""))
                                       for key, field in result.fields.items()}
        summary["value_lines"] = {key: len(str(field.normalized_value or "").splitlines())
                                  for key, field in result.fields.items()}
        from cnie_extract.extractor import Region, _center, _field_words, _in_region, _words
        geometry = {}
        for key in ("filiation_latin", "address_ar", "address_latin"):
            side, box, script = REGIONS[key]
            selected = _field_words(key, [word for word in _words(front if side == "front" else back)
                                          if _in_region(word, Region(side, box, script))])
            geometry[key] = [[round(_center(word)[0]), round(_center(word)[1]),
                              None if word.confidence is None else round(word.confidence, 2)]
                             for word in selected]
        summary["geometry"] = geometry
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0 if summary.get("template") == "CNIE_MA_LEGACY" else 1


if __name__ == "__main__":
    raise SystemExit(main())
