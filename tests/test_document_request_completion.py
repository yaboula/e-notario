from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi.testclient import TestClient

from cnie_capture.api import ApprovedIdentity, DocumentGenerationRequestState, create_app
from cnie_capture.workspace_store import EncryptedWorkspaceStore, WorkspaceStoreError

TOKEN = "desktop-document-completion-test-token"


class SyntheticProtector:
    def protect(self,value):
        return b"synthetic:"+value[::-1]

    def unprotect(self,value):
        assert value.startswith(b"synthetic:")
        return value[10:][::-1]


def headers(key=None, token=TOKEN):
    result = {"Authorization": f"Bearer {token}"}
    if key:
        result["Idempotency-Key"] = key
    return result


def add_request(app):
    state = app.state.capture
    now = time.time()
    identity_id = str(uuid4())
    state.approved_identities[identity_id] = ApprovedIdentity(
        id=identity_id, owner="desktop", document_id=str(uuid4()), extraction_revision=1,
        source="desktop", card_template="CNIE_MA_2020", values={
            "given_names_ar": "محمد", "surname_ar": "الاختبار", "filiation_ar": "الأب والأم",
            "birth_date": "1990-01-02", "birth_place_ar": "الرباط",
            "national_id": "AA123456", "address_ar": ["عنوان اصطناعي"], "sex": "M",
        }, created=now, expires=now+86400)
    item = DocumentGenerationRequestState(id=str(uuid4()),owner="desktop",
        template_id="ma.inheritance",template_version="1.4.0",
        assignments={"applicant":[],"heir":[identity_id],"witness":[]})
    state.document_generation_requests[item.id] = item
    return item


def test_completion_is_revision_bound_desktop_only_and_idempotent():
    app = create_app(desktop_token=TOKEN,mobile_url="https://192.168.1.20:8788")
    with TestClient(app) as client:
        item = add_request(app)
        challenge = client.post("/api/pairing",headers=headers()).json()
        mobile = client.post("/api/pair",json={"code":challenge["url"].split("#pair=")[1]}).json()["token"]
        path = f"/api/document-generation-requests/{item.id}/complete"
        key = str(uuid4())
        denied = client.post(path,headers=headers(key,mobile),json={"revision":0})
        assert denied.status_code == 403
        stale = client.post(path,headers=headers(key),json={"revision":1})
        assert stale.status_code == 409
        assert item.id in app.state.capture.document_generation_requests
        completed = client.post(path,headers=headers(key),json={"revision":0})
        assert completed.status_code == 200
        assert completed.json()["reason"] == "saved"
        assert item.id not in app.state.capture.document_generation_requests
        replay = client.post(path,headers=headers(key),json={"revision":0})
        assert replay.json() == completed.json()
        conflict = client.post(path,headers=headers(key),json={"revision":1})
        assert conflict.status_code == 409
        assert conflict.json()["detail"] == "IDEMPOTENCY_CONFLICT"
        assert completed.headers["cache-control"] == "no-store"


def test_generation_returns_exact_revision_and_exposes_it_to_desktop_origin():
    app = create_app(desktop_token=TOKEN)
    with TestClient(app) as client:
        item = add_request(app)
        path = f"/api/document-generation-requests/{item.id}/generate"
        wrong = client.post(path,headers=headers(),json={"revision":9})
        assert wrong.status_code == 409
        generated = client.post(path,headers={**headers(),"Origin":"http://localhost:1420"},json={"revision":0})
        assert generated.status_code == 200, generated.text
        assert generated.headers["X-eNotario-Document-Request-Revision"] == "0"
        assert "X-eNotario-Document-Request-Revision" in generated.headers["access-control-expose-headers"]
        assert generated.content.startswith(b"PK\x03\x04")


def test_request_changed_during_render_does_not_return_a_stale_docx():
    app = create_app(desktop_token=TOKEN)
    with TestClient(app) as client:
        item = add_request(app)
        catalog = app.state.capture.document_catalog
        render = catalog.render
        entered, release = threading.Event(),threading.Event()

        def delayed_render(*args,**kwargs):
            entered.set()
            assert release.wait(5)
            return render(*args,**kwargs)

        catalog.render = delayed_render
        path = f"/api/document-generation-requests/{item.id}"
        with ThreadPoolExecutor(max_workers=1) as executor:
            output = executor.submit(client.post,path+"/generate",headers=headers(),json={"revision":0})
            try:
                assert entered.wait(5)
                changed = client.patch(path,headers=headers(str(uuid4())),json={
                    "revision":0,"assignments":item.assignments,
                })
                assert changed.status_code == 200
            finally:
                release.set()
            generated = output.result(timeout=5)
        assert generated.status_code == 409
        assert generated.json()["detail"] == "DOCUMENT_REQUEST_STALE_REVISION"


def test_completion_receipt_can_be_replayed_after_encrypted_restart(tmp_path):
    store = EncryptedWorkspaceStore(tmp_path/"workspace.sqlite3",SyntheticProtector())
    app = create_app(desktop_token=TOKEN,workspace_store=store)
    key = str(uuid4())
    with TestClient(app) as client:
        item = add_request(app)
        path = f"/api/document-generation-requests/{item.id}/complete"
        completed = client.post(path,headers=headers(key),json={"revision":0})
        assert completed.status_code == 200
    restarted = create_app(desktop_token=TOKEN,workspace_store=store)
    with TestClient(restarted) as client:
        replay = client.post(path,headers=headers(key),json={"revision":0})
        assert replay.status_code == 200
        assert replay.json() == completed.json()
        assert restarted.state.capture.document_generation_requests == {}


def test_cached_completion_is_not_acknowledged_until_failed_storage_is_retried(tmp_path,monkeypatch):
    store = EncryptedWorkspaceStore(tmp_path/"workspace.sqlite3",SyntheticProtector())
    app = create_app(desktop_token=TOKEN,workspace_store=store)
    with TestClient(app) as client:
        item = add_request(app)
        store.save(app.state.capture.snapshot(),updated=time.time())
        actual_save = store.save
        calls = 0

        def fail_once(*args,**kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise WorkspaceStoreError("synthetic-storage-failure")
            return actual_save(*args,**kwargs)

        monkeypatch.setattr(store,"save",fail_once)
        key = str(uuid4())
        path = f"/api/document-generation-requests/{item.id}/complete"
        first = client.post(path,headers=headers(key),json={"revision":0})
        assert first.status_code == 503
        assert first.json()["detail"] == "TEMPORARY_STORAGE_WRITE_FAILED"
        assert store.load()["document_requests"][0]["id"] == item.id
        retry = client.post(path,headers=headers(key),json={"revision":0})
        assert retry.status_code == 200
        assert store.load()["document_requests"] == []
        assert any(entry[1] == key for entry in store.load()["document_request_idempotency"])


def test_expired_completion_receipts_are_not_retained_indefinitely():
    app = create_app(desktop_token=TOKEN)
    state = app.state.capture
    state.document_request_idempotency[("desktop",str(uuid4()))] = (
        "synthetic-digest",{"id":str(uuid4()),"status":"deleted","deleted_at":time.time()-86401})
    state.prune()
    assert state.document_request_idempotency == {}
