from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Protocol

from cnie_cases.store import DataProtector

from .domain import MAX_PROFILES, ProfessionalProfile, ProfileError


class ProfileStore(Protocol):
    def list(self, *, include_inactive: bool = True) -> list[ProfessionalProfile]: ...
    def get(self, profile_id: str) -> ProfessionalProfile | None: ...
    def create(self, item: ProfessionalProfile) -> ProfessionalProfile: ...
    def save(self, item: ProfessionalProfile, *, expected_revision: int) -> ProfessionalProfile: ...
    def delete(self, profile_id: str) -> bool: ...


class InMemoryProfileStore:
    def __init__(self):
        self.items: dict[str, ProfessionalProfile] = {}
        self.lock = threading.RLock()

    @staticmethod
    def _clone(item: ProfessionalProfile) -> ProfessionalProfile:
        return ProfessionalProfile.from_payload(item.payload())

    def list(self, *, include_inactive: bool = True) -> list[ProfessionalProfile]:
        with self.lock:
            values = [item for item in self.items.values() if include_inactive or item.active]
            return [self._clone(item) for item in sorted(values, key=lambda value: value.display_name_ar)]

    def get(self, profile_id: str) -> ProfessionalProfile | None:
        with self.lock:
            item = self.items.get(profile_id)
            return self._clone(item) if item else None

    def create(self, item: ProfessionalProfile) -> ProfessionalProfile:
        with self.lock:
            if len(self.items) >= MAX_PROFILES:
                raise ProfileError("PROFILE_LIMIT")
            if item.id in self.items:
                raise ProfileError("PROFILE_ALREADY_EXISTS")
            item = self._clone(item)
            self.items[item.id] = item
            return self._clone(item)

    def save(self, item: ProfessionalProfile, *, expected_revision: int) -> ProfessionalProfile:
        with self.lock:
            current = self.items.get(item.id)
            if current is None:
                raise ProfileError("PROFILE_NOT_FOUND")
            if current.revision != expected_revision:
                raise ProfileError("PROFILE_STALE_REVISION")
            updated = self._clone(item)
            updated.revision += 1
            updated.updated = time.time()
            self.items[item.id] = updated
            return self._clone(updated)

    def delete(self, profile_id: str) -> bool:
        with self.lock:
            return self.items.pop(profile_id, None) is not None


class ProtectedProfileStore(InMemoryProfileStore):
    """Small DPAPI-protected profile catalog written atomically as one document."""

    def __init__(self, path: Path, protector: DataProtector):
        super().__init__()
        self.path = Path(path)
        self.protector = protector
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            payload = self.protector.unprotect(self.path.read_bytes())
            raw = json.loads(payload.decode("utf-8"))
            if raw.get("schema") != "enotario.professional-profiles/v1":
                raise ValueError
            values = [ProfessionalProfile.from_payload(item) for item in raw["profiles"]]
            if len(values) > MAX_PROFILES or len({item.id for item in values}) != len(values):
                raise ValueError
            self.items = {item.id: item for item in values}
        except (OSError, ValueError, TypeError, UnicodeError, ProfileError) as exc:
            raise ProfileError("PROFILE_STORAGE_DECRYPT_FAILED") from exc

    def _persist(self) -> None:
        temporary: Path | None = None
        try:
            raw = {"schema": "enotario.professional-profiles/v1",
                   "profiles": [item.payload() for item in self.items.values()]}
            encrypted = self.protector.protect(
                json.dumps(raw, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=self.path.parent,
                prefix=f".{self.path.name}.",
                suffix=".tmp",
                delete=False,
            ) as stream:
                temporary = Path(stream.name)
                stream.write(encrypted)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            temporary = None
        except Exception as exc:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
            raise ProfileError("PROFILE_STORAGE_WRITE_FAILED") from exc

    def create(self, item: ProfessionalProfile) -> ProfessionalProfile:
        with self.lock:
            created = super().create(item)
            try:
                self._persist()
            except ProfileError:
                self.items.pop(created.id, None)
                raise
            return created

    def save(self, item: ProfessionalProfile, *, expected_revision: int) -> ProfessionalProfile:
        with self.lock:
            previous = self.items.get(item.id)
            previous = self._clone(previous) if previous else None
            updated = super().save(item, expected_revision=expected_revision)
            try:
                self._persist()
            except ProfileError:
                if previous is not None:
                    self.items[previous.id] = previous
                raise
            return updated

    def delete(self, profile_id: str) -> bool:
        with self.lock:
            previous = self.items.get(profile_id)
            previous = self._clone(previous) if previous else None
            deleted = super().delete(profile_id)
            if deleted:
                try:
                    self._persist()
                except ProfileError:
                    if previous is not None:
                        self.items[profile_id] = previous
                    raise
            return deleted
