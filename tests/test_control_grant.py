import base64
import json
import time
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from cnie_control import (GrantError, LocalControlSessions, ProtectedStationStore,
                          StationStoreError, verify_grant)
from cnie_capture.api import create_app


def _part(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode().rstrip("=")


def _grant(key, *, user, org, station, issued=1000, new_until=2000,
           role="operator", email="operator@example.ma", kid="test-key"):
    header = _part({"alg": "EdDSA", "kid": kid})
    payload = _part({"iss": "e-notario-control", "aud": "e-notario-local",
                     "sub": user, "email": email, "organization_id": org,
                     "station_id": station,
                     "role": role, "grant_type": "local-work-v1",
                     "iat": issued, "new_work_until": new_until,
                     "finish_until": new_until + 86400, "exp": new_until + 86400})
    message = f"{header}.{payload}"
    signature = base64.urlsafe_b64encode(key.sign(message.encode())).decode().rstrip("=")
    return f"{message}.{signature}"


def test_offline_grant_restricts_new_work_but_allows_finishing():
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    user, org, station = (str(uuid4()) for _ in range(3))
    token = _grant(private, user=user, org=org, station=station)
    grant = verify_grant(token, public_keys={"test-key": public},
                         station_id=station, organization_id=org, now=2000)
    assert grant.user_id == user
    assert not grant.can_start_new(2000)
    assert grant.can_finish_existing(2000)
    assert not grant.can_finish_existing(88400)


def test_rotation_keyring_accepts_grants_from_old_and_new_signers():
    old_private, new_private = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    keys = {
        "lease.2026-01": old_private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw),
        "lease.2026-02": new_private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw),
    }
    user, org, station = (str(uuid4()) for _ in range(3))
    for private, kid in ((old_private, "lease.2026-01"),
                         (new_private, "lease.2026-02")):
        grant = verify_grant(_grant(private, user=user, org=org, station=station, kid=kid),
                             public_keys=keys, station_id=station,
                             organization_id=org, now=1500)
        assert grant.user_id == user


def test_grant_rejects_tampering_other_station_and_clock_rollback():
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    user, org, station = (str(uuid4()) for _ in range(3))
    token = _grant(private, user=user, org=org, station=station)
    args = {"public_keys": {"test-key": public}, "station_id": station,
            "organization_id": org, "now": 1500}
    with pytest.raises(GrantError, match="CONTROL_GRANT_WRONG_STATION"):
        verify_grant(token, **{**args, "station_id": str(uuid4())})
    with pytest.raises(GrantError, match="CONTROL_CLOCK_ROLLBACK"):
        verify_grant(token, **{**args, "last_seen_at": 2000})
    pieces = token.split(".")
    payload = json.loads(base64.urlsafe_b64decode(pieces[1] + "=="))
    payload["role"] = "holder"
    pieces[1] = _part(payload)
    with pytest.raises(GrantError, match="CONTROL_GRANT_INVALID"):
        verify_grant(".".join(pieces), **args)


def test_expired_grant_does_not_authorize_existing_work():
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    org, station = str(uuid4()), str(uuid4())
    token = _grant(private, user=str(uuid4()), org=org, station=station)
    with pytest.raises(GrantError, match="CONTROL_GRANT_EXPIRED"):
        verify_grant(token, public_keys={"test-key": public}, station_id=station,
                     organization_id=org, now=88400)


def test_station_store_proves_its_key_and_keeps_grants_separate(tmp_path):
    class Protector:
        def protect(self, value):
            return b"protected:" + value

        def unprotect(self, value):
            if not value.startswith(b"protected:"):
                raise ValueError("invalid ciphertext")
            return value[len(b"protected:"):]

    path = tmp_path / "station.dpapi"
    store = ProtectedStationStore(path, Protector())
    station, org = str(uuid4()), str(uuid4())
    station_public = base64.urlsafe_b64decode(store.initialize() + "=")
    store.bind(station_id=station, organization_id=org)
    user_a, user_b, challenge = str(uuid4()), str(uuid4()), str(uuid4())
    nonce = base64.urlsafe_b64encode(b"n" * 32).decode().rstrip("=")
    signature = base64.urlsafe_b64decode(
        store.sign_challenge(user_id=user_a, challenge_id=challenge, nonce=nonce) + "==")
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    Ed25519PublicKey.from_public_bytes(station_public).verify(signature,
        f"e-notario/station-lease/v1\n{station}\n{user_a}\n{challenge}\n{nonce}".encode())

    issuer = Ed25519PrivateKey.generate()
    issuer_public = issuer.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    keys = {"test-key": issuer_public}
    for user in (user_a, user_b):
        store.save_grant(_grant(issuer, user=user, org=org, station=station),
                         public_keys=keys, now=1500)
    recovered = ProtectedStationStore(path, Protector())
    assert recovered.current_grant(user_id=user_a, public_keys=keys, now=1500).user_id == user_a
    assert recovered.current_grant(user_id=user_b, public_keys=keys, now=1500).user_id == user_b
    recovered.current_grant(user_id=user_a, public_keys=keys, now=1600)
    with pytest.raises(GrantError, match="CONTROL_CLOCK_ROLLBACK"):
        ProtectedStationStore(path, Protector()).current_grant(
            user_id=user_a, public_keys=keys, now=1400)
    with pytest.raises(StationStoreError, match="CONTROL_STATION_ALREADY_BOUND"):
        recovered.bind(station_id=str(uuid4()), organization_id=org)


def test_personal_local_session_requires_password_and_valid_grant(tmp_path):
    class Protector:
        def protect(self, value):
            return b"protected:" + value

        def unprotect(self, value):
            assert value.startswith(b"protected:")
            return value[len(b"protected:"):]

    station, org, user = (str(uuid4()) for _ in range(3))
    path = tmp_path / "station.dpapi"
    store = ProtectedStationStore(path, Protector())
    store.bind(station_id=station, organization_id=org)
    issuer = Ed25519PrivateKey.generate()
    public = issuer.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    keys = {"test-key": public}
    sessions = LocalControlSessions(store, keys)
    with pytest.raises(StationStoreError, match="CONTROL_ACCOUNT_EMAIL_MISMATCH"):
        sessions.enroll_desktop(
            grant_token=_grant(issuer, user=user, org=org, station=station,
                               new_until=5000),
            email="someone-else@example.ma", password="long-example-password",
            now=1500)
    token, expires = sessions.enroll_desktop(
        grant_token=_grant(issuer, user=user, org=org, station=station, new_until=5000),
        email=" Operator@Example.ma ", password="long-example-password", now=1500)
    assert expires == 1500 + 4 * 3600
    assert sessions.principal(token, now=2000).user_id == user
    assert sessions.principal(token, now=2000).can_start_new(2000)
    sessions.logout(token)
    with pytest.raises(StationStoreError, match="CONTROL_SESSION_EXPIRED"):
        sessions.principal(token, now=2000)

    recovered = LocalControlSessions(ProtectedStationStore(path, Protector()), keys)
    with pytest.raises(StationStoreError, match="CONTROL_ACCOUNT_CREDENTIALS_INVALID"):
        recovered.login_offline(email="operator@example.ma", password="wrong-password", now=2000)
    offline_token, _ = recovered.login_offline(
        email="operator@example.ma", password="long-example-password", now=5000)
    assert not recovered.principal(offline_token, now=5000).can_start_new(5000)
    assert recovered.principal(offline_token, now=5000).can_finish_existing(5000)

    # A known account may refresh during the 24-hour finishing window, but a
    # new account cannot be enrolled after new work has closed.
    refreshed = _grant(issuer, user=user, org=org, station=station,
                       issued=5000, new_until=5000)
    refreshed_token, _ = recovered.enroll_desktop(
        grant_token=refreshed, email="operator@example.ma",
        password="new-long-example-password", now=5000)
    assert not recovered.principal(refreshed_token, now=5000).can_start_new(5000)
    with pytest.raises(GrantError, match="CONTROL_NEW_WORK_EXPIRED"):
        recovered.enroll_desktop(grant_token=_grant(
            issuer, user=str(uuid4()), org=org, station=station,
            issued=5000, new_until=5000, email="new@example.ma"),
            email="new@example.ma",
            password="another-long-password", now=5000)

    changed_email = _grant(issuer, user=user, org=org, station=station,
                           issued=5000, new_until=6000, email="updated@example.ma")
    recovered.station.save_grant(changed_email, public_keys=keys, now=5000)
    with pytest.raises(StationStoreError, match="CONTROL_ACCOUNT_EMAIL_MISMATCH"):
        recovered.login_offline(email="operator@example.ma",
                                password="new-long-example-password", now=5000)
    renewed_token, _ = recovered.enroll_desktop(
        grant_token=changed_email, email="updated@example.ma",
        password="new-long-example-password", now=5000)
    assert recovered.principal(renewed_token, now=5000).user_id == user


def test_control_api_rejects_bootstrap_for_data_and_isolates_accounts(tmp_path, monkeypatch):
    class Protector:
        def protect(self, value):
            return b"protected:" + value

        def unprotect(self, value):
            assert value.startswith(b"protected:")
            return value[len(b"protected:"):]

    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    station, org, operator, other_operator, holder = (str(uuid4()) for _ in range(5))
    now = int(time.time())
    store = ProtectedStationStore(tmp_path / "station.dpapi", Protector())
    sessions = LocalControlSessions(store, {"test-key": public})
    bootstrap = "local-bootstrap-only"
    with TestClient(create_app(desktop_token=bootstrap, control_sessions=sessions,
                               mobile_url="https://192.168.1.20:8788")) as client:
        boot_auth = {"Authorization": f"Bearer {bootstrap}"}
        assert client.get("/api/workspace", headers=boot_auth).status_code == 401
        assert client.get("/api/control/station", headers=boot_auth).json()["public_key"]
        assert client.post("/api/control/station/bind", headers=boot_auth, json={
            "station_id": station, "organization_id": org}).status_code == 200
        tokens = {}
        for user_id, role, email in ((operator, "operator", "one@example.ma"),
                                     (other_operator, "operator", "two@example.ma"),
                                     (holder, "holder", "holder@example.ma")):
            response = client.post("/api/control/session/online", headers=boot_auth, json={
                "grant_token": _grant(private, user=user_id, org=org, station=station,
                                      issued=now, new_until=now+3600, role=role,
                                      email=email),
                "email": email, "password": "long-example-password"})
            assert response.status_code == 200, response.json()
            assert response.json()["email"] == email
            assert response.json()["new_work_until"] == now + 3600
            assert response.json()["finish_until"] == now + 3600 + 86400
            tokens[user_id] = {"Authorization": f"Bearer {response.json()['token']}"}
            assert client.app.state.capture.actor_label(user_id) == email
        assert client.get("/api/workspace", headers=tokens[operator]).json()[
            "mobile_url"] == "https://192.168.1.20:8788"
        case = client.post("/api/cases", headers={**tokens[operator],
            "Idempotency-Key": str(uuid4())}, json={
            "template_id": "ma.marriage", "template_version": "1.7.0", "mode": "partial"})
        assert case.status_code == 201, case.json()
        assert len(client.get("/api/cases", headers=tokens[operator]).json()) == 1
        assert client.get("/api/cases", headers=tokens[other_operator]).json() == []
        assert client.get(f"/api/cases/{case.json()['id']}",
                          headers=tokens[other_operator]).status_code == 404
        assert len(client.get("/api/cases", headers=tokens[holder]).json()) == 1
        assert client.get("/api/ocr/config", headers=tokens[operator]).status_code == 403
        assert client.get("/api/ocr/config", headers=tokens[holder]).status_code == 200

        pairing = client.post("/api/pairing", headers=tokens[operator])
        assert pairing.status_code == 200
        assert "control=1" in pairing.json()["url"]
        pair_code = pairing.json()["url"].split("#pair=")[1].split("&")[0]
        wrong = client.post("/api/pair", json={"code": pair_code,
            "email": "two@example.ma", "password": "long-example-password",
            "device_name": "Téléphone test"})
        assert wrong.status_code == 401
        paired = client.post("/api/pair", json={"code": pair_code,
            "email": "one@example.ma", "password": "long-example-password",
            "device_name": "Téléphone test"})
        assert paired.status_code == 200, paired.json()
        mobile = {"Authorization": f"Bearer {paired.json()['token']}"}
        assert len(client.get("/api/cases", headers=mobile).json()) == 1
        assert client.get("/api/ocr/config", headers=mobile).status_code == 403
        assert client.get("/api/workspace", headers=tokens[operator]).json()["connected_devices"] == 1
        assert client.get("/api/workspace", headers=tokens[other_operator]).json()["connected_devices"] == 0
        assert client.get("/api/workspace", headers=tokens[holder]).json()["connected_devices"] == 1

        # At the exact new-work boundary, existing drafts remain reviewable and
        # exportable while a new draft is refused.
        expired_new_work = now + 3600
        monkeypatch.setattr("cnie_capture.api.time.time", lambda: expired_new_work)
        monkeypatch.setattr("cnie_control.sessions.time.time", lambda: expired_new_work)
        blocked = client.post("/api/cases", headers={**tokens[operator],
            "Idempotency-Key": str(uuid4())}, json={
            "template_id": "ma.marriage", "template_version": "1.7.0", "mode": "partial"})
        assert blocked.status_code == 403
        blocked_partial = client.post("/api/document-generation-requests",
            headers={**tokens[operator], "Idempotency-Key": str(uuid4())}, json={
                "template_id": "ma.marriage", "template_version": "1.7.0",
                "assignments": {}})
        assert blocked_partial.status_code == 403
        assert blocked_partial.json()["detail"] == "CONTROL_NEW_WORK_EXPIRED"
        reviewed = client.post(f"/api/cases/{case.json()['id']}/final-review",
            headers=tokens[operator], json={"revision": case.json()["revision"]})
        assert reviewed.status_code == 200, reviewed.json()
        generated = client.post(f"/api/cases/{case.json()['id']}/generate",
            headers=tokens[operator], json={"revision": reviewed.json()["revision"]})
        assert generated.status_code == 200
        assert generated.content.startswith(b"PK")
