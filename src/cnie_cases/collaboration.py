from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

from .domain import FIELD_KEY


LEASE_SECONDS = 45
MAX_ACTOR_LABEL = 128


class FieldLeaseError(ValueError):
    pass


@dataclass(frozen=True)
class FieldLease:
    case_id: str
    field_key: str
    identity: str
    actor_label: str
    token: str
    expires: float

    def public(self) -> dict[str, str | float]:
        return {
            "case_id": self.case_id,
            "field_key": self.field_key,
            "actor_label": self.actor_label,
            "expires_at": self.expires,
        }


class FieldLeaseManager:
    """Short-lived, process-local edit leases; no personal data is persisted."""

    def __init__(self, *, lease_seconds: int = LEASE_SECONDS):
        self.lease_seconds = lease_seconds
        self._leases: dict[tuple[str, str], FieldLease] = {}

    @staticmethod
    def _validate(field_key: str, actor_label: str) -> str:
        if not FIELD_KEY.fullmatch(field_key):
            raise FieldLeaseError("CASE_FIELD_INVALID")
        label = " ".join(actor_label.split()).strip()
        if not label or len(label) > MAX_ACTOR_LABEL:
            raise FieldLeaseError("CASE_ACTOR_LABEL_INVALID")
        return label

    def prune(self, now: float | None = None) -> int:
        current = time.time() if now is None else now
        expired = [key for key, lease in self._leases.items() if lease.expires <= current]
        for key in expired:
            self._leases.pop(key, None)
        return len(expired)

    def list(self, case_id: str, now: float | None = None) -> list[FieldLease]:
        self.prune(now)
        return [lease for lease in self._leases.values() if lease.case_id == case_id]

    def acquire(self, *, case_id: str, field_key: str, identity: str,
                actor_label: str, token: str | None = None,
                now: float | None = None) -> FieldLease:
        label = self._validate(field_key, actor_label)
        current = time.time() if now is None else now
        self.prune(current)
        key = (case_id, field_key)
        existing = self._leases.get(key)
        if existing and existing.identity != identity:
            raise FieldLeaseError("CASE_FIELD_LOCKED")
        if existing and token and not secrets.compare_digest(existing.token, token):
            raise FieldLeaseError("CASE_FIELD_LEASE_INVALID")
        lease = FieldLease(case_id, field_key, identity, label,
                           existing.token if existing else secrets.token_urlsafe(24),
                           current + self.lease_seconds)
        self._leases[key] = lease
        return lease

    def require(self, *, case_id: str, field_key: str, identity: str,
                token: str, now: float | None = None) -> FieldLease:
        current = time.time() if now is None else now
        self.prune(current)
        lease = self._leases.get((case_id, field_key))
        if lease is None:
            raise FieldLeaseError("CASE_FIELD_LEASE_EXPIRED")
        if lease.identity != identity or not secrets.compare_digest(lease.token, token):
            raise FieldLeaseError("CASE_FIELD_LEASE_INVALID")
        return lease

    def release(self, *, case_id: str, field_key: str, identity: str,
                token: str) -> bool:
        self.require(case_id=case_id, field_key=field_key, identity=identity, token=token)
        self._leases.pop((case_id, field_key), None)
        return True

    def clear_case(self, case_id: str) -> int:
        keys = [key for key in self._leases if key[0] == case_id]
        for key in keys:
            self._leases.pop(key, None)
        return len(keys)

    def clear(self) -> int:
        count = len(self._leases)
        self._leases.clear()
        return count
