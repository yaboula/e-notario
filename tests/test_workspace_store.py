from __future__ import annotations

import sqlite3
import time
from uuid import UUID,uuid4

import pytest
from fastapi.testclient import TestClient

from cnie_capture.api import Capture,Document,OcrSummary,create_app
from cnie_ocr.domain import OcrBlock,OcrPage,OcrParagraph,OcrResult,OcrStatus,OcrWord
from cnie_capture.workspace_store import (EncryptedWorkspaceStore, WORKSPACE_SCHEMA,
                                           WorkspaceStoreError)


class FakeProtector:
    prefix = b"workspace-protected:"

    def protect(self, value: bytes) -> bytes:
        return self.prefix + value[::-1]

    def unprotect(self, value: bytes) -> bytes:
        if not value.startswith(self.prefix):
            raise ValueError("invalid key")
        return value[len(self.prefix):][::-1]


def test_workspace_store_encrypts_restart_snapshot_and_crypto_deletes(tmp_path):
    path = tmp_path / "temporary-workspace.sqlite3"
    store = EncryptedWorkspaceStore(path, FakeProtector())
    payload = {
        "schema": WORKSPACE_SCHEMA,
        "saved_at": 1,
        "sessions": {"secret-mobile-token": 9999999999},
        "captures": [{"original": "PRIVATE-IMAGE-PAYLOAD"}],
    }
    store.save(payload, updated=1)
    raw = path.read_bytes()
    assert b"secret-mobile-token" not in raw
    assert b"PRIVATE-IMAGE-PAYLOAD" not in raw
    assert EncryptedWorkspaceStore(path, FakeProtector()).load() == payload

    with sqlite3.connect(path) as connection:
        wrapped = connection.execute(
            "SELECT wrapped_key FROM temporary_workspace WHERE slot=1"
        ).fetchone()[0]
    assert bytes(wrapped).startswith(FakeProtector.prefix)
    assert store.clear() is True
    assert store.load() is None


def test_workspace_store_rejects_ciphertext_tampering(tmp_path):
    path = tmp_path / "temporary-workspace.sqlite3"
    store = EncryptedWorkspaceStore(path, FakeProtector())
    store.save({"schema": WORKSPACE_SCHEMA}, updated=1)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "UPDATE temporary_workspace SET ciphertext=? WHERE slot=1", (b"tampered",))
    with pytest.raises(WorkspaceStoreError, match="WORKSPACE_STORAGE_DECRYPT_FAILED"):
        store.load()


def test_replacing_workspace_rotates_key_and_truncates_journal(tmp_path):
    path = tmp_path / "temporary-workspace.sqlite3"
    store = EncryptedWorkspaceStore(path, FakeProtector())
    store.save({"schema": WORKSPACE_SCHEMA, "image": "synthetic-sensitive-image"}, updated=1)
    with sqlite3.connect(path) as connection:
        old_key = bytes(connection.execute(
            "SELECT wrapped_key FROM temporary_workspace WHERE slot=1").fetchone()[0])
    store.save({"schema": WORKSPACE_SCHEMA, "image": None}, updated=2)
    with sqlite3.connect(path) as connection:
        new_key = bytes(connection.execute(
            "SELECT wrapped_key FROM temporary_workspace WHERE slot=1").fetchone()[0])
    assert new_key != old_key
    assert old_key not in path.read_bytes()
    journal = path.with_name(path.name + "-wal")
    assert not journal.exists() or journal.stat().st_size == 0


def test_api_restores_mobile_session_capture_and_idempotency_after_restart(tmp_path):
    path = tmp_path / "temporary-workspace.sqlite3"
    token = "desktop-token-with-enough-entropy"
    key = "00000000-0000-4000-8000-000000000001"
    first_store = EncryptedWorkspaceStore(path, FakeProtector())
    with TestClient(create_app(desktop_token=token, workspace_store=first_store,
                               mobile_url="https://192.168.1.20:8788")) as client:
        challenge = client.post("/api/pairing", headers={
            "Authorization": f"Bearer {token}",
        }).json()
        code = challenge["url"].split("#pair=")[1]
        mobile = client.post("/api/pair", json={"code": code}).json()["token"]
        headers = {"Authorization": f"Bearer {mobile}", "Content-Type": "image/png",
                   "Idempotency-Key": key}
        capture = client.post("/api/captures?side=front", headers=headers,
                              content=b"private-invalid-image").json()

    second_store = EncryptedWorkspaceStore(path, FakeProtector())
    with TestClient(create_app(desktop_token=token, workspace_store=second_store,
                               mobile_url="https://192.168.1.20:8788")) as client:
        mobile_headers = {"Authorization": f"Bearer {mobile}"}
        workspace = client.get("/api/workspace", headers=mobile_headers)
        assert workspace.status_code == 200
        assert workspace.json()["captures"][0]["id"] == capture["id"]
        retried = client.post("/api/captures?side=front", headers={
            **mobile_headers, "Content-Type": "image/png", "Idempotency-Key": key,
        }, content=b"private-invalid-image")
        assert retried.status_code == 200
        assert retried.json()["id"] == capture["id"]


def test_queued_ocr_is_recovered_after_restart_without_real_provider(tmp_path):
    class SyntheticOcr:
        calls = 0

        def recognize(self, image, request_id):
            self.calls += 1
            assert image == b"synthetic-rectified-image"
            return OcrResult(status=OcrStatus.SUCCESS,request_id=request_id,full_text="TEST",
                             pages=[OcrPage(width=1600,height=1008,confidence=.99,blocks=[
                                 OcrBlock(text="TEST",confidence=.99,bounding_box=[],paragraphs=[
                                     OcrParagraph(text="TEST",confidence=.99,bounding_box=[],words=[
                                         OcrWord(text="TEST",confidence=.99,bounding_box=[])])])])])

    token = "desktop-token-with-enough-entropy"
    path = tmp_path / "temporary-workspace.sqlite3"
    store = EncryptedWorkspaceStore(path,FakeProtector())
    first = create_app(desktop_token=token)
    state = first.state.capture
    document_id,capture_id = str(uuid4()),str(uuid4())
    state.documents[document_id] = Document(id=document_id,owner="desktop",front_capture_id=capture_id)
    state.captures[capture_id] = Capture(
        id=capture_id,owner="desktop",side="front",document_id=document_id,
        original=b"synthetic-original",media_type="image/jpeg",result={"status":"success"},
        rectified=b"synthetic-rectified-image",review="accepted",
        ocr_summary=OcrSummary(status="processing",attempts=1),generation=1)
    store.save(state.snapshot(),updated=time.time())

    engine = SyntheticOcr()
    second = create_app(desktop_token=token,ocr_engine=engine,workspace_store=store)
    with TestClient(second) as client:
        deadline = time.monotonic()+3
        while time.monotonic()<deadline:
            capture = second.state.capture.captures[capture_id]
            if capture.ocr_summary.status=="success":
                break
            time.sleep(.01)
        assert engine.calls==1
        assert capture.ocr_summary.status=="success"
        assert capture.ocr_summary.attempts==2
        expected = capture.ocr_result.to_dict()

    third = create_app(desktop_token=token,workspace_store=store)
    restored = third.state.capture.captures[capture_id]
    assert restored.original==b"synthetic-original"
    assert restored.ocr_result.to_dict()==expected
    assert restored.ocr_result.pages[0].blocks[0].paragraphs[0].words[0].text=="TEST"
