"""Conservative extractor for the pre-2020 Moroccan CNIE layout.

The layout is distinct from CNIE_MA_2020: names sit on the left/centre of
the front, the visual CIN sits below the portrait, and the civil-status line
and barcode occupy the lower reverse. Only the 14 fields already reviewed by
the operator are proposed; the barcode and civil-status number are ignored.
"""

from __future__ import annotations

import re
import time
import unicodedata
from uuid import UUID

from cnie_ocr.domain import OcrResult, OcrWord

from .domain import ExtractionResult, ExtractionStatus, ExtractedField
from .normalize import date_iso

TEMPLATE = "CNIE_MA_LEGACY"
ENGINE_VERSION = "1.0.0"


def _plain(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    return " ".join("".join(char for char in value if not unicodedata.combining(char)).lower().split())


def _has_civil_status(text_value: str) -> bool:
    plain = _plain(text_value)
    return bool(re.search(r"(?:n\s*[°oº.]?\s*)?etat\s+civil", plain)) or "الحالة المدنية" in text_value


def _legacy_front(result: OcrResult) -> bool:
    from .extractor import _center, _words
    text_value = result.full_text
    plain = _plain(text_value)
    words = _words(result)
    right_cin = any(re.fullmatch(r"[A-Z]{1,3}\d{4,10}", word.text.strip().upper())
                    and _center(word)[0] > 1050 and _center(word)[1] > 700 for word in words)
    left_name_lines = {int(_center(word)[1] // 80) for word in words
                       if re.fullmatch(r"[A-Za-zÀ-ÿ]{3,}", word.text)
                       and _center(word)[0] < 520 and 300 < _center(word)[1] < 520
                       and _plain(word.text) not in {"nee", "nom", "prenom", "royaume", "maroc"}}
    return ("carte nationale" in plain and "identite" in plain
            and bool(re.search(r"ne[e]?\s+le\b", plain))
            and "valable jusqu" in plain
            and (right_cin or len(left_name_lines) >= 2))


def _legacy_back(result: OcrResult) -> bool:
    from .extractor import _center, _words
    text_value = result.full_text
    plain = _plain(text_value)
    lower_band_labels = any(_center(word)[1] > 520 and (
        _plain(word.text) in {"civil", "sexe"} or word.text in {"المدنية", "الجنس"})
        for word in _words(result))
    return (_has_civil_status(text_value)
            and (bool(re.search(r"\b(?:fille|fils)\s+de\b", plain)) or "بنت" in text_value or "ابن" in text_value)
            and ("adresse" in plain or "العنوان" in text_value)
            and lower_band_labels)


def layout(front: OcrResult, back: OcrResult) -> str:
    """Return legacy, mixed or other without guessing from a single anchor."""
    front_old = _legacy_front(front)
    back_old = _legacy_back(back)
    if front_old and back_old:
        return "legacy"
    if front_old or back_old:
        return "mixed"
    return "other"


# Canonical rectification is 1600 x 1008. Regions exclude the portrait,
# signature, security lettering, barcode and the unrelated civil-status no.
REGIONS = {
    "given_names_latin": ("front", (.015, .31, .30, .405), "latin"),
    "surname_latin": ("front", (.015, .43, .38, .515), "latin"),
    "given_names_ar": ("front", (.57, .225, .68, .325), "arabic"),
    "surname_ar": ("front", (.57, .345, .69, .445), "arabic"),
    "birth_date": ("front", (.23, .50, .43, .575), "any"),
    "birth_place_latin": ("front", (.045, .615, .52, .70), "latin"),
    "birth_place_ar": ("front", (.39, .56, .68, .65), "arabic"),
    "national_id": ("front", (.70, .74, .88, .84), "latin"),
    "expiry_date": ("front", (.27, .69, .46, .78), "any"),
    "filiation_ar": ("back", (.68, .08, .98, .245), "arabic"),
    "filiation_latin": ("back", (.12, .19, .42, .31), "latin"),
    "address_ar": ("back", (.60, .355, .90, .38), "arabic"),
    "address_latin": ("back", (.13, .475, .49, .505), "latin"),
}


def extract(front: OcrResult, back: OcrResult, request_id: UUID) -> ExtractionResult:
    # Import the unchanged 2020 helpers only after layout selection. This
    # keeps the old profile isolated and avoids any 2020 region mutation.
    from .extractor import (Region, _center, _clean_field_value, _field,
                            _field_words, _in_region, _join, _national_id,
                            _normalize_text_value, _sex_words, _words)

    started = time.perf_counter()
    by_side = {"front": _words(front), "back": _words(back)}
    fields: dict[str, ExtractedField] = {}
    for key, (side, box, script) in REGIONS.items():
        selected = _field_words(key, [word for word in by_side[side]
                                      if _in_region(word, Region(side, box, script))])
        raw = _clean_field_value(key, _join(selected, script))
        if key == "national_id":
            normalized = _national_id(raw)
        elif key in {"birth_date", "expiry_date"}:
            normalized = date_iso(raw)
        else:
            normalized = _normalize_text_value(raw, multiline=key.startswith(("filiation_", "address_")))
        warnings = ["EXTRACTION_DATA_CONFLICT"] if raw and not normalized and key in {
            "national_id", "birth_date", "expiry_date"} else []
        fields[key] = _field(key, selected, side, raw, normalized, warnings)

    sex_words = _sex_words(by_side["back"])
    sex_raw = _join(sex_words, "any")
    sex = "F" if re.search(r"\bF\b|أنثى|FEM", sex_raw, re.I) else (
        "M" if re.search(r"\bM\b|ذكر|MASC", sex_raw, re.I) else None)
    fields["sex"] = _field("sex", sex_words, "back", sex_raw, sex)

    for field in fields.values():
        if field.confidence is not None and field.confidence < .7:
            field.warnings.append("EXTRACTION_LOW_CONFIDENCE")

    warnings: list[str] = []
    # A second printed CIN on the reverse is a cross-check, never a source
    # used to silently override a conflicting front value.
    reverse_cin_words: list[OcrWord] = [word for word in by_side["back"]
                                        if _center(word)[0] < 460 and _center(word)[1] < 100]
    reverse_cin = _national_id(_join(reverse_cin_words, "any"))
    visual_cin = fields["national_id"].normalized_value
    if visual_cin and reverse_cin and visual_cin != reverse_cin:
        fields["national_id"].warnings.extend(["EXTRACTION_DATA_CONFLICT", "EXTRACTION_SIDE_MISMATCH"])
        warnings.extend(["EXTRACTION_DATA_CONFLICT", "EXTRACTION_SIDE_MISMATCH"])
    if any(field.normalized_value in (None, "", []) for field in fields.values()):
        warnings.append("EXTRACTION_REQUIRED_FIELD_MISSING")
    if any(field.confidence is not None and field.confidence < .7 for field in fields.values()):
        warnings.append("EXTRACTION_LOW_CONFIDENCE")
    return ExtractionResult(status=ExtractionStatus.REVIEW_REQUIRED, request_id=request_id,
                            template=TEMPLATE, engine_version=ENGINE_VERSION, fields=fields,
                            warnings=list(dict.fromkeys(warnings)), metrics={
                                "latency_ms": round((time.perf_counter()-started)*1000, 2),
                                "missing_required": sum(field.normalized_value in (None, "", [])
                                                        for field in fields.values()),
                                "field_count": len(fields)})
