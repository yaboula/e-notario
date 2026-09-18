"""Storage failures must pause background work, never kill or duplicate OCR."""
import asyncio
import copy
import threading
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import cnie_capture.api as api
from cnie_capture.api import Capture, Document, create_app
from cnie_ocr.domain import OcrResult, OcrStatus
from cnie_ocr.usage import UsageLedger


class MemoryWorkspace:
    def __init__(self):
        self.fail = False
        self.calls = 0
        self.fail_at = None
        self.saved = None

    def load(self):
        return None

    def save(self, payload, **_kwargs):
        self.calls += 1
        if self.fail_at == self.calls:
            self.fail = True
        if self.fail:
            raise OSError("private storage path must not escape")
        self.saved = copy.deepcopy(payload)


class CountingOcr:
    def __init__(self):
        self.calls = []

    def recognize(self, image, request_id):
        self.calls.append(image)
        return OcrResult(status=OcrStatus.SUCCESS, request_id=request_id,
                         metrics={"character_count": 1}, full_text="SYNTHETIC")


class Socket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


def make_app(tmp_path):
    store, ocr = MemoryWorkspace(), CountingOcr()
    app = create_app(desktop_token="synthetic-token", ocr_engine=ocr,
                     credential_store=object(), usage_ledger=UsageLedger(tmp_path / "usage.json"),
                     workspace_store=store)
    return app, store, ocr


def add_capture(state, image):
    document = Document(id=str(uuid4()), owner="desktop")
    capture = Capture(id=str(uuid4()), owner="desktop", side="front", document_id=document.id,
                      original=image, media_type="image/jpeg", result={}, rectified=image,
                      review="accepted")
    document.front_capture_id = capture.id
    state.documents[document.id] = document
    state.captures[capture.id] = capture
    return capture


async def until(predicate):
    async with asyncio.timeout(5):
        while not predicate():
            await asyncio.sleep(.01)


@pytest.mark.parametrize("fail_at,expected_calls", [(1, 0), (2, 1)])
def test_worker_recovers_without_lost_queue_items_or_duplicate_provider_calls(tmp_path, fail_at, expected_calls):
    app, store, ocr = make_app(tmp_path)
    state = app.state.capture
    store.fail_at = fail_at
    socket = Socket()
    state.sockets[socket] = state.desktop_token

    async def scenario():
        first, second = add_capture(state, b"first"), add_capture(state, b"second")
        await state.queue_ocr(first)
        await state.queue_ocr(second)
        task = asyncio.create_task(state.ocr_worker())
        try:
            await until(lambda: state.storage_error is not None)
            assert not task.done()
            assert len(ocr.calls) == expected_calls
            if expected_calls:
                assert state.capture_metadata(first)["ocr_summary"]["status"] == "processing"
                assert state.document_status(state.documents[first.document_id]) == "ocr_pending"
            messages_before = len(socket.messages)
            writes_before = store.calls
            await asyncio.sleep(.15)
            assert store.calls == writes_before  # bounded backoff, no hot loop
            assert len(socket.messages) == messages_before
            assert second.ocr_summary.status == "queued"
            store.fail = False
            await asyncio.wait_for(state.ocr_queue.join(), 5)
            assert ocr.calls == [b"first", b"second"]
            assert first.ocr_summary.attempts == second.ocr_summary.attempts == 1
            assert state.storage_error is None
            assert all(item["ocr_summary"]["status"] == "success" for item in store.saved["captures"])
            assert not task.done()
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(scenario())


def test_replaced_capture_is_not_sent_after_storage_recovers(tmp_path):
    app, store, ocr = make_app(tmp_path)
    state = app.state.capture
    store.fail = True

    async def scenario():
        capture = add_capture(state, b"obsolete")
        await state.queue_ocr(capture)
        task = asyncio.create_task(state.ocr_worker())
        try:
            await until(lambda: state.storage_error is not None)
            capture.generation += 1
            capture.active = False
            capture.ocr_summary.status = "cancelled"
            store.fail = False
            await asyncio.wait_for(state.ocr_queue.join(), 5)
            assert ocr.calls == []
            assert capture.ocr_summary.status == "cancelled"
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(scenario())


def test_maintenance_survives_storage_failure_and_reports_health(tmp_path, monkeypatch):
    app, store, _ = make_app(tmp_path)
    monkeypatch.setattr(api, "MAINTENANCE_INTERVAL_SECONDS", .01)
    with TestClient(app) as client:
        store.fail = True
        import time
        deadline = time.monotonic() + 3
        while not app.state.capture.storage_error and time.monotonic() < deadline:
            time.sleep(.01)
        health = client.get("/api/health").json()["background"]
        assert health == {"ocr_worker": "running", "maintenance": "running",
                          "storage_error": "TEMPORARY_STORAGE_WRITE_FAILED"}
        store.fail = False
        deadline = time.monotonic() + 3
        while app.state.capture.storage_error and time.monotonic() < deadline:
            time.sleep(.01)
        assert client.get("/api/health").json()["background"]["storage_error"] is None


def test_older_inflight_snapshot_does_not_publish_new_ocr_result(tmp_path):
    app, store, _ = make_app(tmp_path)
    state = app.state.capture
    capture = add_capture(state, b"synthetic")
    capture.ocr_summary.status = "processing"
    entered, release = threading.Event(), threading.Event()
    save = store.save
    def delayed_save(payload, **kwargs):
        entered.set()
        if not release.wait(5):
            raise TimeoutError("test snapshot was not released")
        save(payload, **kwargs)
    store.save = delayed_save

    async def scenario():
        task = asyncio.create_task(state.persist_workspace())
        try:
            await until(entered.is_set)
            capture.ocr_summary.status = "success"
            capture.ocr_result = OcrResult(status=OcrStatus.SUCCESS, request_id=uuid4())
            state.pending_ocr_commits[capture.id] = capture.generation
            release.set()
            await task
            assert state.capture_metadata(capture)["ocr_summary"]["status"] == "processing"
            assert store.saved["captures"][0]["ocr_result"] is None
            await state.persist_workspace()
            assert state.capture_metadata(capture)["ocr_summary"]["status"] == "success"
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(scenario())
