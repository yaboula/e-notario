from __future__ import annotations

import re
import time
from dataclasses import dataclass
from uuid import UUID, uuid4

from cnie_ocr.domain import OcrResult, OcrWord, arabic_character

from .domain import ExtractionResult, ExtractionStatus, ExtractedField, FieldEvidence
from .geometry import center as _center, join_lines
from .normalize import date_iso, digits, identifier, text

TEMPLATE = "CNIE_MA_2020"


@dataclass(frozen=True)
class Region:
    side: str
    box: tuple[float, float, float, float]
    script: str = "any"


REGIONS = {
    # These boxes describe the printed CNIE_MA_2020 template in canonical
    # 1600 x 1008 coordinates.  They are deliberately narrow: the previous
    # broad boxes crossed neighbouring labels and were the source of most
    # field mixing on real Vision responses.
    "given_names_latin": Region("front", (.29, .18, .84, .31), "latin"),
    "surname_latin": Region("front", (.29, .31, .84, .41), "latin"),
    "given_names_ar": Region("front", (.75, .14, .995, .245), "arabic"),
    "surname_ar": Region("front", (.75, .245, .995, .365), "arabic"),
    "birth_date": Region("front", (.57, .35, .84, .47)),
    "birth_place_latin": Region("front", (.30, .47, .58, .61), "latin"),
    "birth_place_ar": Region("front", (.84, .36, .995, .56), "arabic"),
    "national_id": Region("front", (.06, .84, .38, .97)),
    "expiry_date": Region("front", (.56, .84, .96, .97)),
    "filiation_ar": Region("back", (.42, .08, .76, .235), "arabic"),
    "filiation_latin": Region("back", (.00, .21, .46, .37), "latin"),
    "address_ar": Region("back", (.61, .40, .995, .53), "arabic"),
    "address_latin": Region("back", (.00, .49, .47, .60), "latin"),
    "sex": Region("back", (.82, .20, .97, .31)),
}

OPTIONAL: set[str] = set()
LABELS = {
    "royaume", "maroc", "carte", "nationale", "identite", "identité", "nom", "prenom", "prénom",
    "né", "nee", "née", "le", "a", "à", "valable", "jusqu", "au", "numero", "numéro", "adresse",
    "sexe", "filiation", "المملكة", "المغربية", "البطاقة", "الوطنية", "للتعريف", "الاسم", "الشخصي",
    "العائلي", "تاريخ", "الازدياد", "مكان", "العنوان", "صالحة", "إلى", "غاية", "رقم", "الجنس",
}


def _script(value: str) -> str:
    letters = [char for char in value if char.isalpha()]
    if not letters:
        return "neutral"
    return "arabic" if sum(arabic_character(char) for char in letters) / len(letters) >= .5 else "latin"


def _words(result: OcrResult) -> list[OcrWord]:
    return [word for page in result.pages for block in page.blocks for paragraph in block.paragraphs for word in paragraph.words]


def _in_region(word: OcrWord, region: Region) -> bool:
    x, y = _center(word)
    x /= 1600
    y /= 1008
    x1, y1, x2, y2 = region.box
    return x1 <= x <= x2 and y1 <= y <= y2 and (region.script == "any" or _script(word.text) in {region.script, "neutral"})


def _is_label(value: str) -> bool:
    tokens = re.findall(r"[\w\u0600-\u06ff]+", text(value).lower())
    return bool(tokens) and all(token in LABELS for token in tokens)


def _join(words: list[OcrWord], script: str) -> str:
    if not words:
        return ""
    return join_lines([word for word in words if not _is_label(word.text)], script == "arabic")


def _confidence(words: list[OcrWord]) -> float | None:
    values = [word.confidence for word in words if word.confidence is not None]
    return round(sum(values) / len(values), 4) if values else None


def _field(key: str, source: list[OcrWord], side: str, raw: object, normalized: object,
           warnings: list[str] | None = None) -> ExtractedField:
    return ExtractedField(key=key, raw_value=raw or None, normalized_value=normalized or None,
        confidence=_confidence(source), required=key not in OPTIONAL,
        evidence=[FieldEvidence(side, [word.bounding_box for word in source], len(source))] if source else [],
        warnings=list(warnings or ([] if raw else ["EXTRACTION_REQUIRED_FIELD_MISSING"] if key not in OPTIONAL else [])))


def _national_id(value: str) -> str | None:
    candidates = [identifier(item) for item in re.findall(r"[A-Za-z]{1,3}\s*[-/]?\s*\d{4,10}", digits(value))]
    return candidates[0] if len(set(candidates)) == 1 else None


def _field_words(key: str, words: list[OcrWord]) -> list[OcrWord]:
    """Remove printed labels from evidence and value assembly.

    Vision returns labels and values as separate words.  Keeping a label in a
    value is harmless for a human, but it makes a deterministic extractor
    especially prone to assigning the next line to the wrong field.
    """
    ignored = {
        "national_id": {"n", "°", "numero", "número"},
        "birth_place_latin": {"a", "à"},
        "birth_place_ar": {"ب", "في"},
        "address_latin": {"adresse"},
        "address_ar": {"العنوان"},
        "filiation_latin": {"fille", "de", "et"},
        "sex": {"sexe", "الجنس"},
    }.get(key, set())
    selected = words if not ignored else [word for word in words if text(word.text).lower() not in ignored]
    # Numeric fields should carry only the token(s) that can actually form a
    # value.  This removes nearby decorative/Arabic signature words from the
    # evidence without relying on their language classification.
    if key in {"birth_date", "expiry_date"}:
        selected = [word for word in selected if any(char.isdigit() for char in digits(word.text))]
    return selected


def _sex_words(words: list[OcrWord]) -> list[OcrWord]:
    """Return a sex marker only when it shares a printed-label line.

    Security artwork on the back can be recognized as an isolated ``M`` or
    ``F``. A broad fixed region therefore produces confident but false values.
    Requiring geometric association with ``Sexe``/``الجنس`` converts that case
    into an explicit human-review field instead of silently choosing a sex.
    """
    labels = [word for word in words if text(word.text).lower() in {"sexe", "sex", "الجنس"}]
    markers = [word for word in words if text(word.text).upper() in {
        "M", "F", "MASCULIN", "FEMININ", "FÉMININ", "ذكر", "أنثى",
    }]
    associated: list[OcrWord] = []
    for marker in markers:
        marker_x, marker_y = _center(marker)
        if any(abs(marker_y - _center(label)[1]) <= 32 and abs(marker_x - _center(label)[0]) <= 300
               for label in labels):
            associated.append(marker)
    normalized = {
        "F" if re.search(r"\bF\b|أنثى|FEM", marker.text, re.I) else "M"
        for marker in associated
    }
    return associated if len(normalized) == 1 else []


def _clean_field_value(key: str, value: str) -> str:
    """Conservatively remove bilingual prefixes printed beside a value."""
    lines = []
    for line in value.splitlines():
        line = text(line)
        if key == "filiation_latin":
            line = re.sub(r"^(?:fille|et)\s+de\s+", "", line, flags=re.I)
        elif key == "address_latin":
            line = re.sub(r"^adresse\s*", "", line, flags=re.I)
        elif key == "address_ar":
            line = re.sub(r"^العنوان\s*", "", line)
        elif key == "birth_place_latin":
            line = re.sub(r"^(?:a|à)\s+", "", line, flags=re.I)
        elif key == "birth_place_ar":
            line = re.sub(r"^(?:مزدادة\s+بتاريخ|ب)\s*", "", line)
        if line:
            lines.append(line)
    return "\n".join(lines)


def _normalize_text_value(value: str, *, multiline: bool = False) -> str:
    if not multiline:
        return text(value)
    return "\n".join(clean for line in value.splitlines() if (clean := text(line)))


class CnieFieldExtractor:
    def extract(self, front: OcrResult, back: OcrResult, request_id: UUID | None = None) -> ExtractionResult:
        started = time.perf_counter()
        request_id = request_id or uuid4()
        front_text, back_text = front.full_text, back.full_text
        front_lower, back_lower = front_text.lower(), back_text.lower()
        front_anchor = sum(anchor in front_lower for anchor in ("royaume", "maroc", "المملكة", "البطاقة", "identite", "identité"))
        by_side = {"front": _words(front), "back": _words(back)}
        back_anchor = sum(anchor in back_lower for anchor in ("adresse", "العنوان", "filiation", "الجنس", "sexe"))
        if front_anchor < 2 or back_anchor < 2:
            return ExtractionResult(status=ExtractionStatus.UNSUPPORTED_LAYOUT, request_id=request_id,
                error_code="EXTRACTION_UNSUPPORTED_LAYOUT", metrics={"latency_ms": round((time.perf_counter()-started)*1000, 2)})

        fields: dict[str, ExtractedField] = {}
        def normalize(key: str, raw: str) -> object:
            if key == "national_id":
                return _national_id(raw)
            if key in {"birth_date", "expiry_date"}:
                return date_iso(raw)
            if key == "sex":
                if re.search(r"\bF\b|أنثى|FEM", raw, re.I):
                    return "F"
                if re.search(r"\bM\b|ذكر|MASC", raw, re.I):
                    return "M"
                return "unknown"
            return _normalize_text_value(raw, multiline=key.startswith(("filiation_", "address_")))

        for key, region in REGIONS.items():
            selected = (_sex_words(by_side[region.side]) if key == "sex" else
                        [word for word in by_side[region.side] if _in_region(word, region)])
            selected = _field_words(key, selected)
            raw = _clean_field_value(key, _join(selected, region.script))
            normalized = normalize(key, raw) if raw else None
            warnings: list[str] = []
            if key in {"birth_date", "expiry_date"} and raw and not normalized:
                warnings.append("EXTRACTION_DATA_CONFLICT")
            fields[key] = _field(key, selected, region.side, raw, normalized, warnings)

        warnings: list[str] = []
        visual_cin = fields["national_id"].normalized_value
        back_cin_words = [word for word in by_side["back"] if _center(word)[0] < 360 and _center(word)[1] < 130]
        back_cin = _national_id(_join(back_cin_words, "any"))
        if visual_cin and back_cin and visual_cin != back_cin:
            fields["national_id"].warnings.extend(["EXTRACTION_DATA_CONFLICT", "EXTRACTION_SIDE_MISMATCH"])
            warnings.extend(["EXTRACTION_DATA_CONFLICT", "EXTRACTION_SIDE_MISMATCH"])
        missing = sum(field.required and field.normalized_value in (None, "", []) for field in fields.values())
        low = sum(field.confidence is not None and field.confidence < .7 for field in fields.values())
        if missing:
            warnings.append("EXTRACTION_REQUIRED_FIELD_MISSING")
        if low:
            warnings.append("EXTRACTION_LOW_CONFIDENCE")
        return ExtractionResult(status=ExtractionStatus.REVIEW_REQUIRED, request_id=request_id, template=TEMPLATE,
            fields=fields, warnings=list(dict.fromkeys(warnings)), metrics={
                "latency_ms": round((time.perf_counter()-started)*1000, 2), "missing_required": missing,
                "low_confidence_fields": low, "field_count": len(fields)})
