"""Protected station enrollment and offline grant state.

The caller supplies a CurrentUser DPAPI protector in production. A station is
bound to one organization; changing organization requires an explicit reset.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Protocol
from uuid import UUID

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .grant import GrantError, LocalGrant, verify_grant


class StationStoreError(ValueError):
    pass


class Protector(Protocol):
    def protect(self, value: bytes) -> bytes: ...
    def unprotect(self, value: bytes) -> bytes: ...


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode(value: str) -> bytes:
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, base64.binascii.Error) as exc:
        raise StationStoreError("CONTROL_STATION_STORAGE_INVALID") from exc
    if _encode(decoded) != value:
        raise StationStoreError("CONTROL_STATION_STORAGE_INVALID")
    return decoded


class ProtectedStationStore:
    def __init__(self, path: Path, protector: Protector):
        self.path = Path(path)
        self.protector = protector
        self._state: dict | None = None
        if self.path.exists():
            try:
                raw = self.protector.unprotect(self.path.read_bytes())
                state = json.loads(raw)
                if not isinstance(state, dict) or state.get("schema") != "enotario.control-station/v1":
                    raise ValueError
                key = _decode(state["private_key"])
                if len(key) != 32 or not isinstance(state.get("public_key"), str):
                    raise ValueError
                public = Ed25519PrivateKey.from_private_bytes(key).public_key().public_bytes(
                    encoding=serialization.Encoding.Raw,
                    format=serialization.PublicFormat.Raw)
                if _encode(public) != state["public_key"]:
                    raise ValueError
                for field in ("station_id", "organization_id"):
                    if state.get(field) is not None:
                        state[field] = str(UUID(state[field]))
                if (state.get("station_id") is None) != (state.get("organization_id") is None):
                    raise ValueError
                grants = state.get("grants")
                if not isinstance(grants, dict) or len(grants) > 64 or any(
                        not isinstance(token, str) or str(UUID(user_id)) != user_id
                        for user_id, token in grants.items()):
                    raise ValueError
                accounts = state.setdefault("accounts", {})
                if not isinstance(accounts, dict) or len(accounts) > 64:
                    raise ValueError
                for user_id, account in accounts.items():
                    if str(UUID(user_id)) != user_id or not isinstance(account, dict) or \
                            not isinstance(account.get("email"), str) or \
                            len(account["email"]) > 254 or \
                            not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", account["email"]) or \
                            account["email"] != account["email"].lower() or \
                            len(_decode(account.get("salt", ""))) != 16 or \
                            len(_decode(account.get("verifier", ""))) != 32 or \
                            user_id not in grants:
                        raise ValueError
                if type(state.get("last_seen_at")) is not int or state["last_seen_at"] < 0:
                    raise ValueError
                self._state = state
            except (OSError, ValueError, TypeError, KeyError, UnicodeError) as exc:
                raise StationStoreError("CONTROL_STATION_STORAGE_INVALID") from exc

    def _persist(self, state: dict) -> None:
        temporary: Path | None = None
        try:
            payload = json.dumps(state, separators=(",", ":")).encode()
            protected = self.protector.protect(payload)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="wb", dir=self.path.parent,
                    prefix=f".{self.path.name}.", suffix=".tmp", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(protected)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            temporary = None
            self._state = state
        except Exception as exc:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            raise StationStoreError("CONTROL_STATION_STORAGE_WRITE_FAILED") from exc

    def initialize(self) -> str:
        if self._state is None:
            private = Ed25519PrivateKey.generate()
            raw_private = private.private_bytes(
                encoding=serialization.Encoding.Raw,
                format=serialization.PrivateFormat.Raw,
                encryption_algorithm=serialization.NoEncryption())
            raw_public = private.public_key().public_bytes(
                encoding=serialization.Encoding.Raw,
                format=serialization.PublicFormat.Raw)
            self._persist({"schema": "enotario.control-station/v1",
                           "private_key": _encode(raw_private), "public_key": _encode(raw_public),
                           "station_id": None, "organization_id": None,
                           "grants": {}, "accounts": {}, "last_seen_at": 0})
        return self._state["public_key"]

    @property
    def station_id(self) -> str | None:
        return self._state.get("station_id") if self._state else None

    @property
    def organization_id(self) -> str | None:
        return self._state.get("organization_id") if self._state else None

    def bind(self, *, station_id: str, organization_id: str) -> None:
        self.initialize()
        station, organization = str(UUID(station_id)), str(UUID(organization_id))
        if self.station_id is not None and (self.station_id, self.organization_id) != (station, organization):
            raise StationStoreError("CONTROL_STATION_ALREADY_BOUND")
        if self.station_id is None:
            self._persist({**self._state, "station_id": station,
                           "organization_id": organization})

    def sign_challenge(self, *, user_id: str, challenge_id: str, nonce: str) -> str:
        if self._state is None or self.station_id is None:
            raise StationStoreError("CONTROL_STATION_NOT_BOUND")
        user, challenge = str(UUID(user_id)), str(UUID(challenge_id))
        if len(nonce) != 43 or len(_decode(nonce)) != 32:
            raise StationStoreError("CONTROL_CHALLENGE_INVALID")
        message = (f"e-notario/station-lease/v1\n{self.station_id}\n{user}\n{challenge}\n{nonce}")
        private = Ed25519PrivateKey.from_private_bytes(_decode(self._state["private_key"]))
        return _encode(private.sign(message.encode()))

    def save_grant(self, token: str, *, public_keys: dict[str, bytes], now: int) -> LocalGrant:
        if self.station_id is None or self.organization_id is None:
            raise StationStoreError("CONTROL_STATION_NOT_BOUND")
        grant = verify_grant(token, public_keys=public_keys, station_id=self.station_id,
                             organization_id=self.organization_id, now=now,
                             last_seen_at=self._state["last_seen_at"])
        grants = {**self._state["grants"], grant.user_id: token}
        if len(grants) > 64:
            raise StationStoreError("CONTROL_STATION_MEMBER_LIMIT")
        self._persist({**self._state, "grants": grants,
                       "last_seen_at": max(now, self._state["last_seen_at"])})
        return grant

    def current_grant(self, *, user_id: str, public_keys: dict[str, bytes], now: int) -> LocalGrant:
        user = str(UUID(user_id))
        if self.station_id is None or self.organization_id is None or \
                not self._state["grants"].get(user):
            raise GrantError("CONTROL_GRANT_MISSING")
        grant = verify_grant(self._state["grants"][user], public_keys=public_keys,
                            station_id=self.station_id, organization_id=self.organization_id,
                            now=now, last_seen_at=self._state["last_seen_at"])
        if grant.user_id != user:
            raise GrantError("CONTROL_GRANT_INVALID")
        if now >= self._state["last_seen_at"] + 60:
            self._persist({**self._state, "last_seen_at": now})
        return grant

    def enroll_account(self, *, token: str, email: str, password: str,
                       public_keys: dict[str, bytes], now: int) -> LocalGrant:
        if self.station_id is None or self.organization_id is None:
            raise StationStoreError("CONTROL_STATION_NOT_BOUND")
        normalized = email.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized) or \
                len(normalized) > 254 or not 12 <= len(password) <= 1024:
            raise StationStoreError("CONTROL_ACCOUNT_INVALID")
        grant = verify_grant(token, public_keys=public_keys, station_id=self.station_id,
                             organization_id=self.organization_id, now=now,
                             last_seen_at=self._state["last_seen_at"])
        if normalized != grant.email:
            raise StationStoreError("CONTROL_ACCOUNT_EMAIL_MISMATCH")
        existing = self._state["accounts"].get(grant.user_id)
        if not grant.can_start_new(now) and (existing is None or existing["email"] != normalized):
            raise GrantError("CONTROL_NEW_WORK_EXPIRED")
        if any(account["email"] == normalized and user_id != grant.user_id
               for user_id, account in self._state["accounts"].items()):
            raise StationStoreError("CONTROL_ACCOUNT_CONFLICT")
        salt = os.urandom(16)
        verifier = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1,
                                  dklen=32, maxmem=32 * 1024 * 1024)
        accounts = {**self._state["accounts"], grant.user_id: {
            "email": normalized, "salt": _encode(salt), "verifier": _encode(verifier)}}
        grants = {**self._state["grants"], grant.user_id: token}
        if len(accounts) > 64 or len(grants) > 64:
            raise StationStoreError("CONTROL_STATION_MEMBER_LIMIT")
        self._persist({**self._state, "accounts": accounts, "grants": grants,
                       "last_seen_at": max(now, self._state["last_seen_at"])})
        return grant

    def authenticate_account(self, *, email: str, password: str,
                             public_keys: dict[str, bytes], now: int) -> LocalGrant:
        normalized = email.strip().lower()
        if len(normalized) > 254 or len(password) > 1024:
            raise StationStoreError("CONTROL_ACCOUNT_INVALID")
        for user_id, account in (self._state or {}).get("accounts", {}).items():
            if account["email"] != normalized:
                continue
            verifier = hashlib.scrypt(password.encode(), salt=_decode(account["salt"]),
                                      n=2**14, r=8, p=1, dklen=32,
                                      maxmem=32 * 1024 * 1024)
            if hmac.compare_digest(verifier, _decode(account["verifier"])):
                grant = self.current_grant(user_id=user_id, public_keys=public_keys, now=now)
                if grant.email != normalized:
                    raise StationStoreError("CONTROL_ACCOUNT_EMAIL_MISMATCH")
                return grant
        raise StationStoreError("CONTROL_ACCOUNT_CREDENTIALS_INVALID")
