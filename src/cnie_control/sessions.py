"""Short-lived local sessions backed by a per-user signed station grant."""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass

from .grant import LocalGrant
from .station import ProtectedStationStore, StationStoreError


@dataclass(frozen=True)
class ControlPrincipal:
    user_id: str
    email: str
    role: str
    channel: str
    new_work_until: int
    finish_until: int

    def can_start_new(self, now: int) -> bool:
        return now < self.new_work_until

    def can_finish_existing(self, now: int) -> bool:
        return now < self.finish_until


@dataclass(frozen=True)
class _Session:
    user_id: str
    channel: str
    expires_at: int


class LocalControlSessions:
    def __init__(self, station: ProtectedStationStore, public_keys: dict[str, bytes]):
        if not public_keys:
            raise ValueError("CONTROL_LEASE_KEY_MISSING")
        self.station = station
        self.public_keys = public_keys
        self._sessions: dict[str, _Session] = {}
        self._lock = threading.RLock()

    def _issue(self, grant: LocalGrant, *, channel: str, now: int) -> tuple[str, int]:
        if channel not in ("desktop", "mobile"):
            raise ValueError("CONTROL_CHANNEL_INVALID")
        if not grant.can_finish_existing(now):
            raise StationStoreError("CONTROL_GRANT_EXPIRED")
        expires_at = min(now + 4 * 3600, grant.finish_until)
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._sessions = {key: item for key, item in self._sessions.items()
                              if item.expires_at > now}
            self._sessions[token] = _Session(grant.user_id, channel, expires_at)
        return token, expires_at

    def enroll_desktop(self, *, grant_token: str, email: str, password: str,
                       now: int | None = None) -> tuple[str, int]:
        current = int(time.time()) if now is None else now
        grant = self.station.enroll_account(token=grant_token, email=email, password=password,
                                            public_keys=self.public_keys, now=current)
        return self._issue(grant, channel="desktop", now=current)

    def login_offline(self, *, email: str, password: str,
                      now: int | None = None) -> tuple[str, int]:
        current = int(time.time()) if now is None else now
        grant = self.station.authenticate_account(email=email, password=password,
                                                  public_keys=self.public_keys, now=current)
        return self._issue(grant, channel="desktop", now=current)

    def login_mobile(self, *, email: str, password: str, expected_user_id: str,
                     now: int | None = None) -> tuple[str, int, str]:
        current = int(time.time()) if now is None else now
        grant = self.station.authenticate_account(email=email, password=password,
                                                  public_keys=self.public_keys, now=current)
        if grant.user_id != expected_user_id or not grant.can_start_new(current):
            raise StationStoreError("CONTROL_MOBILE_PAIR_FORBIDDEN")
        token, expires = self._issue(grant, channel="mobile", now=current)
        return token, expires, grant.user_id

    def mobile_count(self, *, user_id: str | None = None, now: int | None = None) -> int:
        current = int(time.time()) if now is None else now
        with self._lock:
            return sum(item.channel == "mobile" and item.expires_at > current
                       and (user_id is None or item.user_id == user_id)
                       for item in self._sessions.values())

    def revoke_mobile(self, user_id: str | None = None) -> None:
        with self._lock:
            self._sessions = {token: item for token, item in self._sessions.items()
                              if item.channel != "mobile" or
                              (user_id is not None and item.user_id != user_id)}

    def principal(self, token: str, *, now: int | None = None) -> ControlPrincipal:
        current = int(time.time()) if now is None else now
        with self._lock:
            session = self._sessions.get(token)
            if not session or session.expires_at <= current:
                raise StationStoreError("CONTROL_SESSION_EXPIRED")
        grant = self.station.current_grant(user_id=session.user_id, public_keys=self.public_keys,
                                           now=current)
        return ControlPrincipal(grant.user_id, grant.email, grant.role, session.channel,
                                grant.new_work_until, grant.finish_until)

    def logout(self, token: str) -> None:
        with self._lock:
            self._sessions.pop(token, None)
