import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from cnie_ocr.credentials import CredentialError, DpapiCredentialStore, validate_service_account


def credential_bytes():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()).decode()
    return json.dumps({
        "type": "service_account",
        "project_id": "valid-project-123",
        "private_key_id": "not-secret-test-id",
        "private_key": private,
        "client_email": "vision@valid-project-123.iam.gserviceaccount.com",
        "client_id": "1",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }).encode()


def test_validation_and_dpapi_roundtrip_without_plaintext(tmp_path):
    payload = credential_bytes()
    metadata, _ = validate_service_account(payload)
    assert metadata.project_id == "valid-project-123"
    store = DpapiCredentialStore(tmp_path / "credential.dpapi")
    store.import_bytes(payload)
    encrypted = store.path.read_bytes()
    assert b"PRIVATE KEY" not in encrypted
    assert b"valid-project-123" not in encrypted
    assert store.load()["client_email"].endswith(".gserviceaccount.com")
    assert store.delete() is True
    assert store.delete() is False


def test_invalid_type_token_uri_size_and_project_are_rejected():
    value = json.loads(credential_bytes())
    for field, invalid in (("type", "user"), ("token_uri", "https://example.com/token"),
                           ("project_id", "../../bad")):
        changed = {**value, field: invalid}
        with pytest.raises(CredentialError, match="OCR_CREDENTIAL_INVALID"):
            validate_service_account(json.dumps(changed).encode())
    with pytest.raises(CredentialError):
        validate_service_account(b"x" * (64 * 1024 + 1))
