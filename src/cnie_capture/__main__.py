from __future__ import annotations

import argparse
import asyncio
import base64
import ipaddress
import json
import os
import re
import secrets
import signal
import socket
import sys
import threading
import webbrowser
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


def settings_dir() -> Path:
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "e-notario-v2"


def reset_control_station(expected_station_id: str, *, path: Path | None = None,
                          protector=None) -> None:
    """Remove only a deactivated station identity after verifying its exact UUID."""
    from uuid import UUID
    from cnie_cases import DpapiDataProtector
    from cnie_control import ProtectedStationStore, StationStoreError

    try:
        expected = str(UUID(expected_station_id))
    except ValueError as exc:
        raise RuntimeError("CONTROL_RESET_STATION_ID_INVALID") from exc
    station_path = path or settings_dir() / "control-station.dpapi"
    if not station_path.is_file():
        raise RuntimeError("CONTROL_RESET_STATION_MISSING")
    active_protector = protector or DpapiDataProtector(
        entropy=b"e-notario-v2/control-station/v1",
        description="Valiris Desk station identity and offline accounts")
    try:
        station = ProtectedStationStore(station_path, active_protector)
    except StationStoreError as exc:
        raise RuntimeError(str(exc)) from exc
    if station.station_id != expected:
        raise RuntimeError("CONTROL_RESET_STATION_ID_MISMATCH")
    try:
        station_path.unlink()
    except OSError as exc:
        raise RuntimeError("CONTROL_RESET_STATION_DELETE_FAILED") from exc


def control_public_keys(environ: dict[str, str] | None = None) -> dict[str, bytes]:
    """Load one current key or a small rotation keyring from the packaged environment."""
    environment = os.environ if environ is None else environ
    configured = environment.get("CNIE_CONTROL_LEASE_PUBLIC_KEYS", "").strip()
    if configured:
        entries = configured.split(";")
    else:
        key_id = environment.get("CNIE_CONTROL_LEASE_KEY_ID", "").strip()
        encoded = environment.get("CNIE_CONTROL_LEASE_PUBLIC_KEY", "").strip()
        entries = [f"{key_id}={encoded}"]
    if not 1 <= len(entries) <= 3:
        raise RuntimeError("CONTROL_LEASE_KEY_INVALID")
    result: dict[str, bytes] = {}
    encoded_values: set[str] = set()
    for entry in entries:
        key_id, separator, encoded = entry.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", key_id) or \
                not re.fullmatch(r"[A-Za-z0-9_-]{43}", encoded) or \
                key_id in result or encoded in encoded_values:
            raise RuntimeError("CONTROL_LEASE_KEY_INVALID")
        try:
            public_key = base64.urlsafe_b64decode(encoded + "=")
        except (ValueError, base64.binascii.Error) as exc:
            raise RuntimeError("CONTROL_LEASE_KEY_INVALID") from exc
        if len(public_key) != 32 or \
                base64.urlsafe_b64encode(public_key).decode().rstrip("=") != encoded:
            raise RuntimeError("CONTROL_LEASE_KEY_INVALID")
        result[key_id] = public_key
        encoded_values.add(encoded)
    return result


@dataclass(frozen=True)
class LanSelection:
    address: str | None
    source: str | None
    candidates: tuple[str, ...]


def _private_ipv4(address: str) -> str | None:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return None
    if ip.version != 4 or not ip.is_private or ip.is_loopback or ip.is_unspecified or ip.is_link_local:
        return None
    return str(ip)


def detect_lan_address(environ: dict[str, str] | None = None) -> LanSelection:
    """Select the private IPv4 used by the active route without sending traffic."""
    environment = os.environ if environ is None else environ
    override = environment.get("CNIE_LAN_IP", "").strip()
    if override:
        address = _private_ipv4(override)
        if not address:
            raise ValueError("CNIE_LAN_IP must be a private IPv4 address")
        return LanSelection(address, "managed_override", (address,))

    candidates: set[str] = set()
    try:
        for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_DGRAM):
            address = _private_ipv4(item[4][0])
            if address:
                candidates.add(address)
    except OSError:
        pass

    routed: str | None = None
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # UDP connect only asks Windows to select a route; no packet is transmitted.
        probe.connect(("192.0.2.1", 9))
        routed = _private_ipv4(probe.getsockname()[0])
        if routed:
            candidates.add(routed)
    except OSError:
        pass
    finally:
        probe.close()

    ordered = tuple(sorted(candidates, key=lambda value: tuple(int(part) for part in value.split("."))))
    if routed:
        return LanSelection(routed, "default_route", ordered)
    if len(ordered) == 1:
        return LanSelection(ordered[0], "single_private_adapter", ordered)
    return LanSelection(None, None, ordered)


def _certificate_is_current(address: str, *, minimum_days: int = 14) -> bool:
    from cryptography import x509

    folder = settings_dir() / "tls"
    paths = [folder / "office-ca.key", folder / "office-ca.crt", folder / "server.key", folder / "server.crt"]
    if not all(path.is_file() for path in paths):
        return False
    try:
        cert = x509.load_pem_x509_certificate((folder / "server.crt").read_bytes())
        expires = getattr(cert, "not_valid_after_utc", None)
        if expires is None:
            expires = cert.not_valid_after.replace(tzinfo=timezone.utc)
        names = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        return (expires > datetime.now(timezone.utc) + timedelta(days=minimum_days)
                and ipaddress.ip_address(address) in names.get_values_for_type(x509.IPAddress))
    except (OSError, ValueError, x509.ExtensionNotFound):
        return False


def setup_lan(address: str, *, mode: str = "manual"):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

    ip = ipaddress.ip_address(address)
    if not ip.is_private or ip.is_loopback or ip.is_unspecified:
        raise ValueError("Use the private LAN IPv4/IPv6 address of this PC")
    folder = settings_dir() / "tls"
    folder.mkdir(parents=True, exist_ok=True)
    ca_key_path = folder / "office-ca.key"
    ca_cert_path = folder / "office-ca.crt"
    now = datetime.now(timezone.utc)
    if ca_key_path.exists() and ca_cert_path.exists():
        ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)
        ca_cert = x509.load_pem_x509_certificate(ca_cert_path.read_bytes())
    else:
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Valiris Desk · Office CA")])
        ca_cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                   .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=730))
                   .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                   .add_extension(x509.KeyUsage(digital_signature=True, key_encipherment=False,
                       content_commitment=False, data_encipherment=False, key_agreement=False,
                       key_cert_sign=True, crl_sign=True, encipher_only=None, decipher_only=None), critical=True)
                   .sign(ca_key, hashes.SHA256()))
        ca_key_path.write_bytes(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        ca_cert_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Valiris Desk capture")]))
            .issuer_name(ca_cert.subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=90))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ip), x509.DNSName("localhost")]), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(ca_key, hashes.SHA256()))
    (folder / "server.key").write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (folder / "server.crt").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (settings_dir() / "lan.json").write_text(
        json.dumps({"ip": str(ip), "mode": mode}, separators=(",", ":")), encoding="utf-8")
    if mode == "manual":
        print(f"LAN configured: https://{ip}:8788/capture/")
        print(f"Install only this public CA certificate on authorized phones: {ca_cert_path}")
        print("Private keys stay on this PC. Restart the capture service after configuration.")


def ensure_lan_configuration() -> dict[str, str] | None:
    config_file = settings_dir() / "lan.json"
    try:
        current = json.loads(config_file.read_text(encoding="utf-8")) if config_file.exists() else None
    except (OSError, ValueError, TypeError):
        current = None
    selection = detect_lan_address()

    # Keep an explicit secondary office adapter while it is still present.
    if current and current.get("mode") == "manual":
        configured = _private_ipv4(str(current.get("ip", "")))
        if configured in selection.candidates and _certificate_is_current(configured):
            return {"ip": configured, "mode": "manual"}

    address = selection.address
    if not address:
        return None
    mode = "managed" if selection.source == "managed_override" else "automatic"
    if not current or current.get("ip") != address or not _certificate_is_current(address):
        setup_lan(address, mode=mode)
    return {"ip": address, "mode": mode}


async def run_shared_app(app, servers):
    """Own the shared state lifecycle once, not once per HTTP/HTTPS listener."""
    original_handlers = {}

    def request_shutdown(sig, _frame):
        for server in servers:
            if getattr(server, "should_exit", False) and sig == signal.SIGINT:
                server.force_exit = True
            server.should_exit = True

    if threading.current_thread() is threading.main_thread():
        signals = [signal.SIGINT, signal.SIGTERM]
        if hasattr(signal, "SIGBREAK"):
            signals.append(signal.SIGBREAK)
        original_handlers = {sig: signal.signal(sig, request_shutdown) for sig in signals}
    try:
        async with app.router.lifespan_context(app):
            await asyncio.gather(*(server.serve() for server in servers))
    finally:
        for sig, handler in original_handlers.items():
            signal.signal(sig, handler)


async def serve(open_browser: bool):
    import uvicorn
    from .api import create_app
    from cnie_cases import DpapiDataProtector, EncryptedSqliteCaseStore
    from .workspace_store import DpapiWorkspaceProtector, EncryptedWorkspaceStore
    from cnie_profiles import ProtectedProfileStore
    from cnie_control import LocalControlSessions, ProtectedStationStore

    class SharedStateServer(uvicorn.Server):
        @contextmanager
        def capture_signals(self):
            # The process coordinator stops both listeners; neither owns signals.
            yield

    token = os.environ.get("CNIE_DESKTOP_TOKEN") or secrets.token_urlsafe(32)
    packaged = getattr(sys, "_MEIPASS", None)
    root = Path(packaged) if packaged else Path(__file__).resolve().parents[2]
    lan = ensure_lan_configuration()
    mobile_url = f"https://{lan['ip']}:8788" if lan else None
    case_store = EncryptedSqliteCaseStore(
        settings_dir() / "temporary-cases.sqlite3", DpapiDataProtector())
    profile_store = ProtectedProfileStore(
        settings_dir() / "professional-profiles.dpapi",
        DpapiDataProtector(entropy=b"e-notario-v2/professional-profiles/v1",
                           description="Valiris Desk professional profiles"))
    workspace_store = EncryptedWorkspaceStore(
        settings_dir() / "temporary-workspace.sqlite3", DpapiWorkspaceProtector())
    control_sessions = None
    if os.environ.get("CNIE_CONTROL_MODE") == "required":
        public_keys = control_public_keys()
        station_store = ProtectedStationStore(
            settings_dir() / "control-station.dpapi",
            DpapiDataProtector(entropy=b"e-notario-v2/control-station/v1",
                               description="Valiris Desk station identity and offline accounts"))
        control_sessions = LocalControlSessions(station_store, public_keys)
    app = create_app(desktop_token=token, mobile_url=mobile_url, lan_mode=lan.get("mode") if lan else None,
        case_store=case_store, profile_store=profile_store, workspace_store=workspace_store,
        control_sessions=control_sessions,
        saved_receipts_path=settings_dir() / "saved-case-receipts.dpapi",
        desktop_dist=root / "apps/desktop/dist", mobile_dist=root / "apps/mobile-capture/dist")
    common = dict(app=app, lifespan="off", access_log=False, log_level="error",
                  limit_concurrency=24, timeout_keep_alive=5)
    servers = [SharedStateServer(uvicorn.Config(host="127.0.0.1", port=8787, **common))]
    if lan:
        folder = settings_dir() / "tls"
        servers.append(SharedStateServer(uvicorn.Config(host=lan["ip"], port=8788,
            ssl_keyfile=str(folder / "server.key"), ssl_certfile=str(folder / "server.crt"), **common)))
    if open_browser:
        async def open_when_ready():
            for _ in range(100):
                if servers[0].started:
                    await asyncio.to_thread(webbrowser.open, f"http://127.0.0.1:8787/#token={token}")
                    return
                await asyncio.sleep(0.1)
        asyncio.create_task(open_when_ready())
    await run_shared_app(app, servers)


def main():
    parser = argparse.ArgumentParser(prog="cnie-capture")
    sub = parser.add_subparsers(dest="command", required=True)
    server = sub.add_parser("serve")
    server.add_argument("--open", action="store_true", help="Open the local operator workspace")
    setup = sub.add_parser("setup-lan")
    setup.add_argument("--ip", required=True)
    sub.add_parser("detect-lan")
    reset_station = sub.add_parser("reset-control-station")
    reset_station.add_argument("--station-id", required=True,
        help="Exact UUID of the station already deactivated in the portal")
    args = parser.parse_args()
    if args.command == "setup-lan":
        setup_lan(args.ip)
    elif args.command == "detect-lan":
        selection = detect_lan_address()
        print(json.dumps({"ip": selection.address, "source": selection.source,
                          "candidates": selection.candidates}, separators=(",", ":")))
    elif args.command == "reset-control-station":
        reset_control_station(args.station_id)
        print("CONTROL_STATION_IDENTITY_RESET")
    else:
        try:
            asyncio.run(serve(args.open))
        except KeyboardInterrupt:
            # Console and service-manager shutdown is expected, not a crash.
            pass


if __name__ == "__main__":
    main()
