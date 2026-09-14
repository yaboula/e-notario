from __future__ import annotations

import re
import unicodedata
from datetime import date

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def text(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value or "")).strip()


def digits(value: str) -> str:
    return text(value).translate(_DIGITS)


def identifier(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", digits(value).upper())


def date_iso(value: str) -> str | None:
    candidate = digits(value)
    for pattern in (r"(\d{2})[./\-](\d{2})[./\-](\d{4})", r"(\d{4})[./\-](\d{2})[./\-](\d{2})"):
        match = re.search(pattern, candidate)
        if not match:
            continue
        parts = [int(part) for part in match.groups()]
        day, month, year = (parts[0], parts[1], parts[2]) if pattern.startswith("(\\d{2})") else (parts[2], parts[1], parts[0])
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return None
    return None
