from __future__ import annotations

import sys
import asyncio
import time
import signal

from cnie_capture.api import create_app
from cnie_capture.workspace_store import EncryptedWorkspaceStore

from cnie_capture import __main__ as capture_main


def test_serve_keyboard_interrupt_is_a_clean_shutdown(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["cnie-capture", "serve"])

    def interrupted(_coroutine):
        _coroutine.close()
        raise KeyboardInterrupt

    monkeypatch.setattr(capture_main.asyncio, "run", interrupted)
    capture_main.main()


def test_two_listeners_share_one_lifespan_and_preserve_sessions_on_shutdown(tmp_path):
    class TestProtector:
        def protect(self, value):
            return value

        def unprotect(self, value):
            return value

    store = EncryptedWorkspaceStore(tmp_path / "workspace.sqlite3", TestProtector())
    app = create_app(desktop_token="synthetic-desktop-token", workspace_store=store)
    state = app.state.capture
    seen = []

    class Listener:
        def __init__(self, token):
            self.token = token

        async def serve(self):
            state.sessions[self.token] = time.time() + 600
            state.session_labels[self.token] = "QA synthetic listener"
            seen.append(self.token)
            await asyncio.sleep(0)

    asyncio.run(capture_main.run_shared_app(app, [Listener("synthetic-http-session"),
                                                Listener("synthetic-https-session")]))
    assert len(seen) == 2
    assert not state.sessions  # Memory is cleared only after the one final snapshot.
    restored = create_app(desktop_token="synthetic-desktop-token", workspace_store=store)
    assert set(restored.state.capture.sessions) == {"synthetic-http-session", "synthetic-https-session"}
    assert len(restored.state.capture.session_labels) == 2


def test_shared_shutdown_signal_stops_both_listeners_and_restores_handler():
    from contextlib import asynccontextmanager
    from types import SimpleNamespace

    events = []

    @asynccontextmanager
    async def lifespan(_app):
        events.append("start")
        try:
            yield
        finally:
            events.append("stop")

    class Listener:
        should_exit = False

        async def serve(self):
            while not self.should_exit:
                await asyncio.sleep(0)

    first, second = Listener(), Listener()
    app = SimpleNamespace(router=SimpleNamespace(lifespan_context=lifespan))
    original = signal.getsignal(signal.SIGTERM)

    async def exercise():
        task = asyncio.create_task(capture_main.run_shared_app(app, [first, second]))
        await asyncio.sleep(0)
        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
        await asyncio.wait_for(task, 1)

    asyncio.run(exercise())
    assert first.should_exit and second.should_exit
    assert events == ["start", "stop"]
    assert signal.getsignal(signal.SIGTERM) == original
