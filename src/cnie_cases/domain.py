from __future__ import annotations

import copy
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4


CASE_RETENTION_SECONDS = 24 * 60 * 60
MAX_CASES = 64
MAX_CASE_FIELDS = 96
MAX_FIELD_LENGTH = 4096
MAX_ASSIGNMENTS_PER_ROLE = 12
FIELD_KEY = re.compile(r"^[a-z][a-z0-9_.-]{0,127}$")


class CaseError(ValueError):
    pass


def _timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def validate_fields(values: dict[str, Any]) -> dict[str, str | list[str] | None]:
    if len(values) > MAX_CASE_FIELDS:
        raise CaseError("CASE_FIELD_LIMIT")
    normalized: dict[str, str | list[str] | None] = {}
    for key, value in values.items():
        if not FIELD_KEY.fullmatch(key):
            raise CaseError("CASE_FIELD_INVALID")
        if value is None:
            normalized[key] = None
        elif isinstance(value, str):
            if len(value) > MAX_FIELD_LENGTH:
                raise CaseError("CASE_FIELD_TOO_LONG")
            normalized[key] = value
        elif isinstance(value, list) and len(value) <= MAX_ASSIGNMENTS_PER_ROLE:
            if any(not isinstance(item, str) or len(item) > MAX_FIELD_LENGTH for item in value):
                raise CaseError("CASE_FIELD_INVALID")
            normalized[key] = list(value)
        else:
            raise CaseError("CASE_FIELD_INVALID")
    return normalized


def validate_assignments(values: dict[str, list[str]]) -> dict[str, list[str]]:
    normalized: dict[str, list[str]] = {}
    for role, identity_ids in values.items():
        if not FIELD_KEY.fullmatch(role) or len(identity_ids) > MAX_ASSIGNMENTS_PER_ROLE:
            raise CaseError("CASE_ASSIGNMENT_INVALID")
        if len(identity_ids) != len(set(identity_ids)):
            raise CaseError("CASE_ASSIGNMENT_DUPLICATE")
        normalized[role] = list(identity_ids)
    return normalized


@dataclass
class CaseDraft:
    id: str
    owner: str
    template_id: str
    template_version: str
    mode: Literal["partial", "complete"]
    status: Literal["editing", "final_review", "completed"] = "editing"
    revision: int = 0
    fields: dict[str, str | list[str] | None] = field(default_factory=dict)
    assignments: dict[str, list[str]] = field(default_factory=dict)
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)
    expires: float = 0.0

    def __post_init__(self) -> None:
        if not self.expires:
            self.expires = self.updated + CASE_RETENTION_SECONDS
        self.fields = validate_fields(self.fields)
        self.assignments = validate_assignments(self.assignments)

    @classmethod
    def create(cls, *, owner: str, template_id: str, template_version: str,
               mode: Literal["partial", "complete"]) -> "CaseDraft":
        now = time.time()
        return cls(str(uuid4()), owner, template_id, template_version, mode,
                   created=now, updated=now, expires=now + CASE_RETENTION_SECONDS)

    def clone(self) -> "CaseDraft":
        return copy.deepcopy(self)

    def touch(self, now: float | None = None) -> None:
        self.updated = time.time() if now is None else now
        self.expires = self.updated + CASE_RETENTION_SECONDS

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "template_id": self.template_id,
            "template_version": self.template_version,
            "mode": self.mode,
            "status": self.status,
            "revision": self.revision,
            "source": "desktop" if self.owner == "desktop" else "mobile",
            "field_count": len(self.fields),
            "assignment_count": sum(len(items) for items in self.assignments.values()),
            "created_at": _timestamp(self.created),
            "updated_at": _timestamp(self.updated),
            "expires_at": _timestamp(self.expires),
        }

    def detail(self) -> dict[str, Any]:
        return {**self.summary(), "fields": copy.deepcopy(self.fields),
                "assignments": copy.deepcopy(self.assignments)}

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.id, "owner": self.owner,
            "template_id": self.template_id, "template_version": self.template_version,
            "mode": self.mode, "status": self.status, "revision": self.revision,
            "fields": self.fields, "assignments": self.assignments,
            "created": self.created, "updated": self.updated, "expires": self.expires,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "CaseDraft":
        try:
            return cls(
                id=str(payload["id"]), owner=str(payload["owner"]),
                template_id=str(payload["template_id"]),
                template_version=str(payload["template_version"]), mode=payload["mode"],
                status=payload["status"], revision=int(payload["revision"]),
                fields=dict(payload.get("fields", {})),
                assignments={key: list(value) for key, value in payload.get("assignments", {}).items()},
                created=float(payload["created"]), updated=float(payload["updated"]),
                expires=float(payload["expires"]),
            )
        except CaseError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise CaseError("CASE_STORAGE_CORRUPT") from exc
