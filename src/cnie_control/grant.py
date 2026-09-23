"""Verify signed, station-scoped offline grants without calling the cloud."""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass
from uuid import UUID

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class GrantError(ValueError):
    """A grant is malformed, invalid, expired or issued for another station."""


@dataclass(frozen=True)
class LocalGrant:
    user_id: str
    email: str
    organization_id: str
    station_id: str
    role: str
    new_work_until: int
    finish_until: int

    def can_start_new(self, now: int | None = None) -> bool:
        return (int(time.time()) if now is None else now) < self.new_work_until

    def can_finish_existing(self, now: int | None = None) -> bool:
        return (int(time.time()) if now is None else now) < self.finish_until


def _decode(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise GrantError("CONTROL_GRANT_INVALID")
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, base64.binascii.Error) as exc:
        raise GrantError("CONTROL_GRANT_INVALID") from exc
    if base64.urlsafe_b64encode(decoded).decode().rstrip("=") != value:
        raise GrantError("CONTROL_GRANT_INVALID")
    return decoded


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise GrantError("CONTROL_GRANT_INVALID")
        result[key] = value
    return result


def _json_object(value: bytes) -> dict[str, object]:
    try:
        result = json.loads(value, object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise GrantError("CONTROL_GRANT_INVALID") from exc
    if not isinstance(result, dict):
        raise GrantError("CONTROL_GRANT_INVALID")
    return result


def _uuid(value: object) -> str:
    try:
        if not isinstance(value, str):
            raise ValueError
        return str(UUID(value))
    except ValueError as exc:
        raise GrantError("CONTROL_GRANT_INVALID") from exc


def _seconds(value: object) -> int:
    if type(value) is not int or value < 0 or value > 253402300799:
        raise GrantError("CONTROL_GRANT_INVALID")
    return value


def verify_grant(token: str, *, public_keys: dict[str, bytes],
                 station_id: str, organization_id: str,
                 now: int | None = None, last_seen_at: int | None = None) -> LocalGrant:
    """Verify an EdDSA grant and return its capabilities for this station.

    ``last_seen_at`` is the greatest trusted wall-clock time persisted locally.
    A large rollback blocks use until the station can contact the service.
    """
    current = int(time.time()) if now is None else now
    if last_seen_at is not None and current < last_seen_at - 120:
        raise GrantError("CONTROL_CLOCK_ROLLBACK")
    if not isinstance(token, str) or len(token) > 4096 or token.count(".") != 2:
        raise GrantError("CONTROL_GRANT_INVALID")
    encoded_header, encoded_payload, encoded_signature = token.split(".")
    header = _json_object(_decode(encoded_header))
    if header.get("alg") != "EdDSA" or not isinstance(header.get("kid"), str):
        raise GrantError("CONTROL_GRANT_INVALID")
    key_bytes = public_keys.get(header["kid"])
    if key_bytes is None or len(key_bytes) != 32:
        raise GrantError("CONTROL_GRANT_KEY_UNKNOWN")
    try:
        Ed25519PublicKey.from_public_bytes(key_bytes).verify(
            _decode(encoded_signature), f"{encoded_header}.{encoded_payload}".encode("ascii"))
    except (InvalidSignature, ValueError) as exc:
        raise GrantError("CONTROL_GRANT_INVALID") from exc
    claims = _json_object(_decode(encoded_payload))
    if claims.get("iss") != "e-notario-control" or claims.get("aud") != "e-notario-local" \
            or claims.get("grant_type") != "local-work-v1":
        raise GrantError("CONTROL_GRANT_INVALID")
    user_id = _uuid(claims.get("sub"))
    email = claims.get("email")
    if not isinstance(email, str) or len(email) > 254 or \
            not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or \
            email != email.lower():
        raise GrantError("CONTROL_GRANT_INVALID")
    org = _uuid(claims.get("organization_id"))
    station = _uuid(claims.get("station_id"))
    if org != _uuid(organization_id) or station != _uuid(station_id):
        raise GrantError("CONTROL_GRANT_WRONG_STATION")
    role = claims.get("role")
    if role not in ("holder", "operator"):
        raise GrantError("CONTROL_GRANT_INVALID")
    issued_at = _seconds(claims.get("iat"))
    new_work_until = _seconds(claims.get("new_work_until"))
    finish_until = _seconds(claims.get("finish_until"))
    if _seconds(claims.get("exp")) != finish_until or \
            finish_until != new_work_until + 86400 or \
            new_work_until > issued_at + 7 * 86400 or \
            issued_at > current + 120:
        raise GrantError("CONTROL_GRANT_INVALID")
    if current >= finish_until:
        raise GrantError("CONTROL_GRANT_EXPIRED")
    return LocalGrant(user_id, email, org, station, role, new_work_until, finish_until)
