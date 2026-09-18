from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


MAX_PROFILES = 64


class ProfileError(ValueError):
    pass


def _clean(value: str, *, required: bool = False) -> str:
    normalized = " ".join(value.split())
    if (required and not normalized) or len(normalized) > 160:
        raise ProfileError("PROFILE_INVALID")
    return normalized


@dataclass
class ProfessionalProfile:
    id: str
    display_name_ar: str
    display_name_fr: str
    function_fr: str
    active: bool = True
    revision: int = 0
    created: float = 0.0
    updated: float = 0.0

    def __post_init__(self) -> None:
        self.display_name_ar = _clean(self.display_name_ar, required=True)
        self.display_name_fr = _clean(self.display_name_fr)
        self.function_fr = _clean(self.function_fr)
        if not self.created:
            self.created = time.time()
        if not self.updated:
            self.updated = self.created

    @classmethod
    def create(cls, *, display_name_ar: str, display_name_fr: str,
               function_fr: str, profile_id: str | None = None) -> "ProfessionalProfile":
        return cls(profile_id or str(uuid4()), display_name_ar, display_name_fr, function_fr)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "display_name_ar": self.display_name_ar,
            "display_name_fr": self.display_name_fr, "function_fr": self.function_fr,
            "active": self.active, "revision": self.revision,
            "created_at": datetime.fromtimestamp(self.created, timezone.utc).isoformat(),
            "updated_at": datetime.fromtimestamp(self.updated, timezone.utc).isoformat(),
        }

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.id, "display_name_ar": self.display_name_ar,
            "display_name_fr": self.display_name_fr, "function_fr": self.function_fr,
            "active": self.active, "revision": self.revision,
            "created": self.created, "updated": self.updated,
        }

    @classmethod
    def from_payload(cls, value: dict[str, Any]) -> "ProfessionalProfile":
        try:
            return cls(str(value["id"]), str(value["display_name_ar"]),
                       str(value.get("display_name_fr", "")), str(value.get("function_fr", "")),
                       bool(value.get("active", True)), int(value.get("revision", 0)),
                       float(value["created"]), float(value["updated"]))
        except ProfileError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise ProfileError("PROFILE_STORAGE_CORRUPT") from exc
