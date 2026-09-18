from __future__ import annotations

import json
import os
import sqlite3
import threading
import zlib
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from cnie_ocr.credentials import protect_current_user, unprotect_current_user


WORKSPACE_SCHEMA = "enotario.temporary-workspace/v1"
DPAPI_ENTROPY = b"e-notario-v2/temporary-workspace/v1"
MAX_SERIALIZED_WORKSPACE = 220 * 1024 * 1024


class WorkspaceStoreError(ValueError):
    pass


class DataProtector(Protocol):
    def protect(self, value: bytes) -> bytes: ...
    def unprotect(self, value: bytes) -> bytes: ...


class DpapiWorkspaceProtector:
    def protect(self, value: bytes) -> bytes:
        return protect_current_user(value, entropy=DPAPI_ENTROPY,
                                    description="e-notario temporary workspace key")

    def unprotect(self, value: bytes) -> bytes:
        return unprotect_current_user(value, entropy=DPAPI_ENTROPY)


class EncryptedWorkspaceStore:
    """One encrypted restart snapshot for transient captures, OCR and approved identities."""

    def __init__(self, path: Path, protector: DataProtector):
        self.path = Path(path)
        self.protector = protector
        self.lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS temporary_workspace (
                    slot INTEGER PRIMARY KEY CHECK (slot = 1),
                    wrapped_key BLOB NOT NULL,
                    nonce BLOB NOT NULL,
                    ciphertext BLOB NOT NULL,
                    updated REAL NOT NULL
                )
            """)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=10000")
        connection.execute("PRAGMA secure_delete=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _aad() -> bytes:
        return WORKSPACE_SCHEMA.encode("ascii")

    def save(self, payload: dict[str, Any], *, updated: float) -> None:
        try:
            raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise WorkspaceStoreError("WORKSPACE_STORAGE_INVALID") from exc
        if len(raw) > MAX_SERIALIZED_WORKSPACE:
            raise WorkspaceStoreError("WORKSPACE_STORAGE_LIMIT")
        compressed = zlib.compress(raw, level=3)
        with self.lock, self._connect() as connection:
            # Never reuse the snapshot key: released images must not remain
            # decryptable with the key of the newer, image-free snapshot.
            key = AESGCM.generate_key(bit_length=256)
            wrapped = self.protector.protect(key)
            nonce = os.urandom(12)
            ciphertext = AESGCM(key).encrypt(nonce, compressed, self._aad())
            connection.execute(
                "INSERT INTO temporary_workspace(slot,wrapped_key,nonce,ciphertext,updated) "
                "VALUES(1,?,?,?,?) ON CONFLICT(slot) DO UPDATE SET "
                "wrapped_key=excluded.wrapped_key,nonce=excluded.nonce," 
                "ciphertext=excluded.ciphertext,updated=excluded.updated",
                (wrapped, nonce, ciphertext, updated),
            )
            connection.commit()
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    def load(self) -> dict[str, Any] | None:
        with self.lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM temporary_workspace WHERE slot=1").fetchone()
        if row is None:
            return None
        try:
            key = self.protector.unprotect(bytes(row["wrapped_key"]))
            compressed = AESGCM(key).decrypt(bytes(row["nonce"]), bytes(row["ciphertext"]),
                                              self._aad())
            inflater = zlib.decompressobj()
            raw = inflater.decompress(compressed, MAX_SERIALIZED_WORKSPACE + 1)
            if len(raw) > MAX_SERIALIZED_WORKSPACE or not inflater.eof:
                raise WorkspaceStoreError("WORKSPACE_STORAGE_LIMIT")
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict) or payload.get("schema") != WORKSPACE_SCHEMA:
                raise WorkspaceStoreError("WORKSPACE_STORAGE_CORRUPT")
            return payload
        except WorkspaceStoreError:
            raise
        except Exception as exc:
            raise WorkspaceStoreError("WORKSPACE_STORAGE_DECRYPT_FAILED") from exc

    def clear(self) -> bool:
        with self.lock:
            with self._connect() as connection:
                deleted = connection.execute(
                    "DELETE FROM temporary_workspace WHERE slot=1"
                ).rowcount == 1
            with self._connect() as connection:
                connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            return deleted
