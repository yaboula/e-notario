from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from cnie_capture.api import CAPTURE_TTL, create_app


TOKEN = "test-operator-credential-with-enough-entropy"


@pytest.fixture
def client():
    with TestClient(create_app(desktop_token=TOKEN, mobile_url="https://192.168.1.20:8788", lan_mode="automatic")) as client:
        yield client


def auth(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


def pair(client):
    challenge = client.post("/api/pairing", headers=auth()).json()
    code = challenge["url"].split("#pair=")[1]
    return client.post("/api/pair", json={"code": code}).json()["token"], code


def upload(client, payload=b"invalid-png", token=TOKEN, key=None):
    return client.post("/api/captures?side=front", content=payload,
        headers={**auth(token), "Content-Type": "image/png", "Idempotency-Key": key or str(uuid4())})


def test_workspace_and_images_require_authentication(client):
    assert client.get("/api/health").json() == {
        "status": "ok", "version": "0.8.0-alpha.5", "api_version": 2,
        "background": {"ocr_worker": "running", "maintenance": "running", "storage_error": None},
    }
    assert client.get("/api/workspace").status_code == 401
    assert client.post("/api/pairing").status_code == 401
    assert client.get(f"/api/captures/{uuid4()}/original").status_code == 401
    assert client.get("/api/workspace", headers=auth()).json()["lan_mode"] == "automatic"


def test_pairing_is_one_use_and_cannot_grant_desktop_permissions(client):
    token, code = pair(client)
    assert client.post("/api/pair", json={"code": code}).status_code == 401
    assert client.post("/api/pairing", headers=auth(token)).status_code == 403
    assert client.get("/api/model", headers=auth(token)).status_code == 403
    mobile_workspace = client.get("/api/workspace", headers=auth(token)).json()
    assert mobile_workspace["mobile_url"] is None
    assert mobile_workspace["lan_mode"] is None


def test_pairing_expiration(client):
    code = client.post("/api/pairing", headers=auth()).json()["url"].split("#pair=")[1]
    client.app.state.capture.pair_deadline = 0
    assert client.post("/api/pair", json={"code": code}).status_code == 401


def test_pairing_records_temporary_operator_and_device_label(client):
    challenge = client.post("/api/pairing", headers=auth()).json()
    code = challenge["url"].split("#pair=")[1]
    response = client.post("/api/pair", json={
        "code": code, "operator_name": "  Sara  ", "device_name": " Téléphone accueil ",
    })
    assert response.status_code == 200
    result = response.json()
    assert result["actor_label"] == "Sara · Téléphone accueil"
    assert client.app.state.capture.session_labels[result["token"]] == result["actor_label"]


def test_device_isolation_and_revocation(client):
    phone1, _ = pair(client)
    phone2, _ = pair(client)
    capture = upload(client, token=phone1).json()
    assert client.get("/api/workspace", headers=auth(phone2)).json()["captures"] == []
    assert client.get(f"/api/captures/{capture['id']}/original", headers=auth(phone2)).status_code == 404
    assert client.delete(f"/api/captures/{capture['id']}", headers=auth(phone1)).status_code == 403
    assert len(client.get("/api/workspace", headers=auth()).json()["captures"]) == 1
    assert client.delete("/api/pairing", headers=auth()).status_code == 200
    assert client.get("/api/workspace", headers=auth(phone1)).status_code == 401


def test_retries_are_idempotent_and_conflicting_retries_rejected(client):
    key = str(uuid4())
    first = upload(client, key=key).json()
    assert upload(client, key=key).json()["id"] == first["id"]
    assert upload(client, payload=b"different", key=key).status_code == 409
    assert len(client.get("/api/workspace", headers=auth()).json()["captures"]) == 1


def test_rejected_image_cannot_be_accepted(client):
    capture = upload(client).json()
    assert capture["result"]["status"] == "invalid_image"
    assert capture["review"] == "retake"
    assert capture["ocr_summary"]["status"] == "not_started"
    assert client.post(f"/api/captures/{capture['id']}/review", headers=auth(),json={"decision":"accepted"}).status_code == 409
    assert client.get(f"/api/captures/{capture['id']}/rectified", headers=auth()).status_code == 404
    assert client.post(f"/api/captures/{capture['id']}/review", headers=auth(),json={"decision":"retake"}).json()["review"] == "retake"


def test_retention_purges_images_and_idempotency(client):
    capture = upload(client).json()
    client.app.state.capture.captures[capture["id"]].created -= CAPTURE_TTL + 1
    assert client.get("/api/workspace", headers=auth()).json()["captures"] == []
    assert client.app.state.capture.idempotency == {}


def test_response_headers_do_not_cache_identity_images(client):
    capture = upload(client).json()
    response = client.get(f"/api/captures/{capture['id']}/original", headers=auth())
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_upload_validation_and_delete(client, monkeypatch):
    monkeypatch.setattr("cnie_capture.api.MAX_UPLOAD", 10)
    assert upload(client, payload=b"a" * 11).status_code == 413
    assert client.post("/api/captures", content=b"abc",headers=auth()).status_code == 400
    response = upload(client, payload=b"abc")
    assert response.status_code == 200
    capture = response.json()
    assert client.delete(f"/api/captures/{capture['id']}", headers=auth()).status_code == 200
    assert client.get(f"/api/captures/{capture['id']}/original", headers=auth()).status_code == 404


def test_real_engine_upload_review_and_export(client, synthetic_capture, monkeypatch):
    # This test exercises the real local rectifier only.  Keep the OCR queue
    # inert so the test suite never consumes the operator's Google quota or
    # makes a provider request from the production credential store.
    async def no_external_ocr(self, capture):
        capture.ocr_summary.status = "queued"

    monkeypatch.setattr("cnie_capture.api.State.queue_ocr", no_external_ocr)
    payload, _ = synthetic_capture
    response = upload(client, payload=payload)
    assert response.status_code == 200
    capture = response.json()
    assert capture["result"]["status"] == "success", capture
    assert capture["review"] == "accepted"
    assert capture["ocr_summary"]["status"] == "queued"
    assert "rectified_image" not in capture["result"]
    assert "error" not in capture["result"]["docquadnet"]
    export = client.get(f"/api/captures/{capture['id']}/rectified", headers=auth())
    assert export.status_code == 200
    assert export.content[:2] == b"\xff\xd8"
    assert client.post(f"/api/captures/{capture['id']}/review",headers=auth(),json={"decision":"accepted"}).json()["review"] == "accepted"


def test_websocket_is_authenticated_and_receives_change(client):
    with client.websocket_connect("/api/events") as socket:
        socket.send_json({"token":TOKEN})
        assert socket.receive_json()["type"] == "connected"
        assert upload(client).status_code == 200
        assert socket.receive_json()["type"] == "changed"
