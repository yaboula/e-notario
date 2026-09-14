import json

import pytest

from cnie_capture import __main__ as capture_main


class RouteSocket:
    def __init__(self, address="192.168.1.42", fails=False):
        self.address = address
        self.fails = fails

    def connect(self, _target):
        if self.fails:
            raise OSError("no route")

    def getsockname(self):
        return self.address, 49152

    def close(self):
        pass


def addresses(*values):
    return [(None, None, None, None, (value, 0)) for value in values]


def test_managed_lan_override_is_validated():
    selection = capture_main.detect_lan_address({"CNIE_LAN_IP": "192.168.10.50"})
    assert selection.address == "192.168.10.50"
    assert selection.source == "managed_override"
    with pytest.raises(ValueError):
        capture_main.detect_lan_address({"CNIE_LAN_IP": "127.0.0.1"})


def test_default_route_wins_over_virtual_adapter(monkeypatch):
    monkeypatch.setattr(capture_main.socket, "getaddrinfo", lambda *_args: addresses("10.8.0.2", "192.168.1.42"))
    monkeypatch.setattr(capture_main.socket, "socket", lambda *_args: RouteSocket())
    selection = capture_main.detect_lan_address({})
    assert selection.address == "192.168.1.42"
    assert selection.source == "default_route"
    assert selection.candidates == ("10.8.0.2", "192.168.1.42")


def test_ambiguous_adapters_require_manual_fallback(monkeypatch):
    monkeypatch.setattr(capture_main.socket, "getaddrinfo", lambda *_args: addresses("10.0.0.8", "192.168.1.42"))
    monkeypatch.setattr(capture_main.socket, "socket", lambda *_args: RouteSocket(fails=True))
    selection = capture_main.detect_lan_address({})
    assert selection.address is None
    assert len(selection.candidates) == 2


def test_existing_manual_adapter_is_preserved(monkeypatch, tmp_path):
    (tmp_path / "lan.json").write_text(json.dumps({"ip": "10.0.0.8", "mode": "manual"}), encoding="utf-8")
    monkeypatch.setattr(capture_main, "settings_dir", lambda: tmp_path)
    monkeypatch.setattr(capture_main, "detect_lan_address", lambda: capture_main.LanSelection(
        "192.168.1.42", "default_route", ("10.0.0.8", "192.168.1.42")))
    monkeypatch.setattr(capture_main, "_certificate_is_current", lambda address: address == "10.0.0.8")
    assert capture_main.ensure_lan_configuration() == {"ip": "10.0.0.8", "mode": "manual"}


def test_automatic_address_rotates_leaf_configuration(monkeypatch, tmp_path):
    monkeypatch.setattr(capture_main, "settings_dir", lambda: tmp_path)
    monkeypatch.setattr(capture_main, "detect_lan_address", lambda: capture_main.LanSelection(
        "192.168.1.42", "default_route", ("192.168.1.42",)))
    monkeypatch.setattr(capture_main, "_certificate_is_current", lambda _address: False)
    configured = []
    monkeypatch.setattr(capture_main, "setup_lan", lambda address, mode: configured.append((address, mode)))
    assert capture_main.ensure_lan_configuration() == {"ip": "192.168.1.42", "mode": "automatic"}
    assert configured == [("192.168.1.42", "automatic")]
