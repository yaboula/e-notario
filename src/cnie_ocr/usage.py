from __future__ import annotations

import json
import os
import threading
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


class UsageLimitReached(RuntimeError):
    pass


class UsageStorageError(RuntimeError):
    """The local cost ledger cannot be trusted or durably updated."""


@dataclass(frozen=True)
class UsageSummary:
    daily_limit: int
    monthly_limit: int
    used_today: int
    used_month: int

    def to_dict(self) -> dict[str, int]:
        return {
            "daily_limit": self.daily_limit,
            "monthly_limit": self.monthly_limit,
            "used_today": self.used_today,
            "used_month": self.used_month,
        }


class UsageLedger:
    def __init__(self, path: Path, *, daily_limit: int = 60, monthly_limit: int = 900):
        self.path = Path(path)
        self.daily_limit = daily_limit
        self.monthly_limit = monthly_limit
        self._lock = threading.Lock()

    def _read(self) -> dict[str, int]:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError):
            raise UsageStorageError("OCR_USAGE_READ_FAILED") from None
        if not isinstance(value, dict):
            raise UsageStorageError("OCR_USAGE_READ_FAILED")
        for key, count in value.items():
            try:
                valid_day = datetime.strptime(key, "%Y-%m-%d").strftime("%Y-%m-%d") == key
            except (ValueError, TypeError):
                valid_day = False
            if not valid_day or type(count) is not int or count < 0:
                raise UsageStorageError("OCR_USAGE_READ_FAILED")
        return value

    def _write(self, value: dict[str, int]) -> None:
        temporary = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                             prefix=self.path.name + ".", suffix=".tmp",
                                             delete=False) as output:
                temporary = Path(output.name)
                output.write(json.dumps(value, separators=(",", ":")))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
        except OSError:
            raise UsageStorageError("OCR_USAGE_WRITE_FAILED") from None
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass

    @staticmethod
    def _keys(now: datetime | None = None) -> tuple[str, str]:
        current = now or datetime.now(timezone.utc)
        return current.strftime("%Y-%m-%d"), current.strftime("%Y-%m")

    def summary(self, now: datetime | None = None) -> UsageSummary:
        day, month = self._keys(now)
        with self._lock:
            data = self._read()
        used_month = sum(count for key, count in data.items() if key.startswith(month + "-"))
        return UsageSummary(self.daily_limit, self.monthly_limit, data.get(day, 0), used_month)

    def reserve(self, now: datetime | None = None) -> UsageSummary:
        day, month = self._keys(now)
        with self._lock:
            data = self._read()
            used_day = data.get(day, 0)
            used_month = sum(count for key, count in data.items() if key.startswith(month + "-"))
            if used_day >= self.daily_limit or used_month >= self.monthly_limit:
                raise UsageLimitReached("OCR_LOCAL_LIMIT_REACHED")
            data[day] = used_day + 1
            # Keep only the current and immediately previous month-sized tail.
            if len(data) > 70:
                data = dict(sorted(data.items())[-70:])
            self._write(data)
            return UsageSummary(self.daily_limit, self.monthly_limit, used_day + 1, used_month + 1)
