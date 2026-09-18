from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from cnie_ocr.credentials import protect_current_user, unprotect_current_user

from .domain import CaseDraft, CaseError, MAX_CASES


STORE_SCHEMA = "enotario.case-store/v1"
DPAPI_ENTROPY = b"e-notario-v2/case-store/v1"


class DataProtector(Protocol):
    def protect(self, value: bytes) -> bytes: ...
    def unprotect(self, value: bytes) -> bytes: ...


class DpapiDataProtector:
    def __init__(self, *, entropy: bytes = DPAPI_ENTROPY,
                 description: str = "e-notario temporary case key"):
        self.entropy = entropy
        self.description = description

    def protect(self, value: bytes) -> bytes:
        return protect_current_user(value, entropy=self.entropy, description=self.description)

    def unprotect(self, value: bytes) -> bytes:
        return unprotect_current_user(value, entropy=self.entropy)


class CaseStore(Protocol):
    def create(self, item: CaseDraft) -> CaseDraft: ...
    def get(self, case_id: str) -> CaseDraft | None: ...
    def list(self) -> list[CaseDraft]: ...
    def save(self, item: CaseDraft, *, expected_revision: int) -> CaseDraft: ...
    def delete(self, case_id: str) -> bool: ...
    def clear(self) -> int: ...
    def prune(self, now: float | None = None) -> int: ...


class InMemoryCaseStore:
    def __init__(self):
        self.items: dict[str, CaseDraft] = {}
        self.lock = threading.RLock()

    def create(self, item: CaseDraft) -> CaseDraft:
        with self.lock:
            self.prune()
            if len(self.items) >= MAX_CASES:
                raise CaseError("CASE_LIMIT")
            if item.id in self.items:
                raise CaseError("CASE_ALREADY_EXISTS")
            validated = CaseDraft.from_payload(item.payload())
            self.items[item.id] = validated.clone()
            return validated

    def get(self, case_id: str) -> CaseDraft | None:
        with self.lock:
            self.prune()
            item = self.items.get(case_id)
            return item.clone() if item else None

    def list(self) -> list[CaseDraft]:
        with self.lock:
            self.prune()
            return [item.clone() for item in sorted(self.items.values(), key=lambda value: value.updated,
                                                    reverse=True)]

    def save(self, item: CaseDraft, *, expected_revision: int) -> CaseDraft:
        with self.lock:
            current = self.items.get(item.id)
            if current is None:
                raise CaseError("CASE_NOT_FOUND")
            if current.revision != expected_revision:
                raise CaseError("CASE_STALE_REVISION")
            updated = CaseDraft.from_payload(item.payload())
            updated.revision = expected_revision + 1
            updated.touch()
            self.items[item.id] = updated
            return updated.clone()

    def delete(self, case_id: str) -> bool:
        with self.lock:
            return self.items.pop(case_id, None) is not None

    def clear(self) -> int:
        with self.lock:
            count = len(self.items)
            self.items.clear()
            return count

    def prune(self, now: float | None = None) -> int:
        threshold = time.time() if now is None else now
        with self.lock:
            expired = [case_id for case_id, item in self.items.items() if item.expires <= threshold]
            for case_id in expired:
                self.items.pop(case_id, None)
            return len(expired)


class EncryptedSqliteCaseStore:
    """Encrypted payload store with one disposable AES key per temporary case."""

    def __init__(self, path: Path, protector: DataProtector):
        self.path = Path(path)
        self.protector = protector
        self.lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS case_drafts (
                    id TEXT PRIMARY KEY,
                    wrapped_key BLOB NOT NULL,
                    nonce BLOB NOT NULL,
                    ciphertext BLOB NOT NULL,
                    created REAL NOT NULL,
                    updated REAL NOT NULL,
                    expires REAL NOT NULL,
                    revision INTEGER NOT NULL
                )
            """)
            connection.execute("CREATE INDEX IF NOT EXISTS idx_case_drafts_expires ON case_drafts(expires)")

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=5000")
        connection.execute("PRAGMA secure_delete=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _aad(case_id: str) -> bytes:
        return f"{STORE_SCHEMA}:{case_id}".encode("ascii")

    def _encrypt(self, item: CaseDraft, key: bytes) -> tuple[bytes, bytes]:
        payload = json.dumps(item.payload(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        nonce = os.urandom(12)
        return nonce, AESGCM(key).encrypt(nonce, payload, self._aad(item.id))

    def _decrypt(self, row: sqlite3.Row) -> CaseDraft:
        try:
            key = self.protector.unprotect(bytes(row["wrapped_key"]))
            payload = AESGCM(key).decrypt(bytes(row["nonce"]), bytes(row["ciphertext"]),
                                          self._aad(str(row["id"])))
            item = CaseDraft.from_payload(json.loads(payload.decode("utf-8")))
            if item.id != row["id"] or item.revision != row["revision"]:
                raise CaseError("CASE_STORAGE_CORRUPT")
            return item
        except CaseError:
            raise
        except Exception as exc:
            raise CaseError("CASE_STORAGE_DECRYPT_FAILED") from exc

    def create(self, item: CaseDraft) -> CaseDraft:
        self.prune()
        with self.lock, self._connect() as connection:
            item = CaseDraft.from_payload(item.payload())
            count = connection.execute("SELECT COUNT(*) FROM case_drafts").fetchone()[0]
            if count >= MAX_CASES:
                raise CaseError("CASE_LIMIT")
            key = AESGCM.generate_key(bit_length=256)
            wrapped = self.protector.protect(key)
            nonce, ciphertext = self._encrypt(item, key)
            try:
                connection.execute(
                    "INSERT INTO case_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (item.id, wrapped, nonce, ciphertext, item.created, item.updated,
                     item.expires, item.revision),
                )
            except sqlite3.IntegrityError as exc:
                raise CaseError("CASE_ALREADY_EXISTS") from exc
            return item.clone()

    def get(self, case_id: str) -> CaseDraft | None:
        self.prune()
        with self.lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM case_drafts WHERE id = ?", (case_id,)).fetchone()
            return self._decrypt(row) if row else None

    def list(self) -> list[CaseDraft]:
        self.prune()
        with self.lock, self._connect() as connection:
            rows = connection.execute("SELECT * FROM case_drafts ORDER BY updated DESC").fetchall()
            return [self._decrypt(row) for row in rows]

    def save(self, item: CaseDraft, *, expected_revision: int) -> CaseDraft:
        with self.lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM case_drafts WHERE id = ?", (item.id,)).fetchone()
            if row is None:
                raise CaseError("CASE_NOT_FOUND")
            if int(row["revision"]) != expected_revision:
                raise CaseError("CASE_STALE_REVISION")
            key = self.protector.unprotect(bytes(row["wrapped_key"]))
            updated = CaseDraft.from_payload(item.payload())
            updated.revision = expected_revision + 1
            updated.touch()
            nonce, ciphertext = self._encrypt(updated, key)
            cursor = connection.execute(
                "UPDATE case_drafts SET nonce=?, ciphertext=?, updated=?, expires=?, revision=? "
                "WHERE id=? AND revision=?",
                (nonce, ciphertext, updated.updated, updated.expires, updated.revision,
                 updated.id, expected_revision),
            )
            if cursor.rowcount != 1:
                raise CaseError("CASE_STALE_REVISION")
            return updated

    def delete(self, case_id: str) -> bool:
        with self.lock:
            with self._connect() as connection:
                deleted = connection.execute("DELETE FROM case_drafts WHERE id = ?", (case_id,)).rowcount == 1
            if deleted:
                with self._connect() as connection:
                    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            return deleted

    def clear(self) -> int:
        with self.lock:
            with self._connect() as connection:
                count = connection.execute("SELECT COUNT(*) FROM case_drafts").fetchone()[0]
                connection.execute("DELETE FROM case_drafts")
            with self._connect() as connection:
                connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            return int(count)

    def prune(self, now: float | None = None) -> int:
        with self.lock:
            with self._connect() as connection:
                count = self._prune_connection(connection, time.time() if now is None else now)
            if count:
                with self._connect() as connection:
                    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            return count

    @staticmethod
    def _prune_connection(connection: sqlite3.Connection, now: float) -> int:
        return connection.execute("DELETE FROM case_drafts WHERE expires <= ?", (now,)).rowcount
