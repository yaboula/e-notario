from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import os
import secrets
import socket
import sys
import webbrowser
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


def settings_dir() -> Path:
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "e-notario-v2"


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
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "e-notario v2 · Office CA")])
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
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "e-notario v2 capture")]))
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


async def serve(open_browser: bool):
    import uvicorn
    from .api import create_app

    token = os.environ.get("CNIE_DESKTOP_TOKEN") or secrets.token_urlsafe(32)
    packaged = getattr(sys, "_MEIPASS", None)
    root = Path(packaged) if packaged else Path(__file__).resolve().parents[2]
    lan = ensure_lan_configuration()
    mobile_url = f"https://{lan['ip']}:8788" if lan else None
    app = create_app(desktop_token=token, mobile_url=mobile_url, lan_mode=lan.get("mode") if lan else None,
        desktop_dist=root / "apps/desktop/dist", mobile_dist=root / "apps/mobile-capture/dist")
    common = dict(app=app, access_log=False, log_level="error", limit_concurrency=24, timeout_keep_alive=5)
    servers = [uvicorn.Server(uvicorn.Config(host="127.0.0.1", port=8787, **common))]
    if lan:
        folder = settings_dir() / "tls"
        servers.append(uvicorn.Server(uvicorn.Config(host=lan["ip"], port=8788,
            ssl_keyfile=str(folder / "server.key"), ssl_certfile=str(folder / "server.crt"), **common)))
    if open_browser:
        async def open_when_ready():
            for _ in range(100):
                if servers[0].started:
                    await asyncio.to_thread(webbrowser.open, f"http://127.0.0.1:8787/#token={token}")
                    return
                await asyncio.sleep(0.1)
        asyncio.create_task(open_when_ready())
    await asyncio.gather(*(server.serve() for server in servers))


def main():
    parser = argparse.ArgumentParser(prog="cnie-capture")
    sub = parser.add_subparsers(dest="command", required=True)
    server = sub.add_parser("serve")
    server.add_argument("--open", action="store_true", help="Open the local operator workspace")
    setup = sub.add_parser("setup-lan")
    setup.add_argument("--ip", required=True)
    sub.add_parser("detect-lan")
    args = parser.parse_args()
    if args.command == "setup-lan":
        setup_lan(args.ip)
    elif args.command == "detect-lan":
        selection = detect_lan_address()
        print(json.dumps({"ip": selection.address, "source": selection.source,
                          "candidates": selection.candidates}, separators=(",", ":")))
    else:
        asyncio.run(serve(args.open))


if __name__ == "__main__":
    main()
