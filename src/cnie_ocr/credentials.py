from __future__ import annotations

import ctypes
import json
import os
import re
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.serialization import load_pem_private_key

MAX_CREDENTIAL_SIZE = 64 * 1024
TOKEN_URI = "https://oauth2.googleapis.com/token"
ENTROPY = b"e-notario-v2/google-vision/eu/v1"


class CredentialError(ValueError):
    pass


@dataclass(frozen=True)
class CredentialMetadata:
    project_id: str
    client_email: str
    credential_type: str = "service_account"

    def to_dict(self) -> dict[str, str]:
        return {
            "project_id": self.project_id,
            "client_email": self.client_email,
            "credential_type": self.credential_type,
        }


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def _blob(value: bytes) -> tuple[_Blob, Any]:
    buffer = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
    return _Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer


def _crypt(value: bytes, protect: bool, *, entropy_value: bytes = ENTROPY,
           description: str = "e-notario Google Vision") -> bytes:
    if os.name != "nt":
        raise CredentialError("OCR_CREDENTIAL_STORAGE_UNAVAILABLE")
    source, source_buffer = _blob(value)
    entropy, entropy_buffer = _blob(entropy_value)
    destination = _Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    function = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    function.restype = wintypes.BOOL
    second_argument = ctypes.c_wchar_p if protect else ctypes.POINTER(ctypes.c_wchar_p)
    function.argtypes = [
        ctypes.POINTER(_Blob), second_argument, ctypes.POINTER(_Blob), ctypes.c_void_p,
        ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_Blob),
    ]
    kernel32.LocalFree.restype = ctypes.c_void_p
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    protected_description = description if protect else None
    arguments = (
        ctypes.byref(source), protected_description, ctypes.byref(entropy), None, None,
        0x1, ctypes.byref(destination),
    ) if protect else (
        ctypes.byref(source), None, ctypes.byref(entropy), None, None,
        0x1, ctypes.byref(destination),
    )
    if not function(*arguments):
        raise CredentialError("OCR_CREDENTIAL_DECRYPT_FAILED")
    try:
        return ctypes.string_at(destination.pbData, destination.cbData)
    finally:
        # Keep the input buffers alive through the native call.
        _ = source_buffer, entropy_buffer
        kernel32.LocalFree(ctypes.cast(destination.pbData, ctypes.c_void_p))


def protect_current_user(value: bytes, *, entropy: bytes = ENTROPY,
                         description: str = "e-notario protected data") -> bytes:
    return _crypt(value, True, entropy_value=entropy, description=description)


def unprotect_current_user(value: bytes, *, entropy: bytes = ENTROPY) -> bytes:
    return _crypt(value, False, entropy_value=entropy)


def validate_service_account(payload: bytes) -> tuple[CredentialMetadata, dict[str, Any]]:
    if not payload or len(payload) > MAX_CREDENTIAL_SIZE:
        raise CredentialError("OCR_CREDENTIAL_INVALID")
    try:
        info = json.loads(payload.decode("utf-8"))
        if not isinstance(info, dict):
            raise ValueError
        if info.get("type") != "service_account" or info.get("token_uri") != TOKEN_URI:
            raise ValueError
        project = str(info["project_id"]).strip()
        email = str(info["client_email"]).strip()
        private_key = str(info["private_key"])
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project) or not email.endswith(".gserviceaccount.com"):
            raise ValueError
        load_pem_private_key(private_key.encode("utf-8"), password=None)
    except (KeyError, TypeError, ValueError, UnicodeError, UnsupportedAlgorithm):
        raise CredentialError("OCR_CREDENTIAL_INVALID") from None
    return CredentialMetadata(project, email), info


class DpapiCredentialStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def import_bytes(self, payload: bytes) -> CredentialMetadata:
        metadata, _ = validate_service_account(payload)
        encrypted = _crypt(payload, True)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(encrypted)
        os.replace(temporary, self.path)
        return metadata

    def load(self) -> dict[str, Any]:
        try:
            encrypted = self.path.read_bytes()
        except OSError:
            raise CredentialError("OCR_NOT_CONFIGURED") from None
        payload = _crypt(encrypted, False)
        _, info = validate_service_account(payload)
        return info

    def metadata(self) -> CredentialMetadata | None:
        try:
            info = self.load()
            return CredentialMetadata(str(info["project_id"]), str(info["client_email"]))
        except CredentialError:
            return None

    def delete(self) -> bool:
        try:
            self.path.unlink()
            return True
        except FileNotFoundError:
            return False
