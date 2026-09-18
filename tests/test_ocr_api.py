import time
from dataclasses import dataclass
from uuid import uuid4

from fastapi.testclient import TestClient

from cnie_capture.api import create_app
from cnie_ocr.domain import OcrResult, OcrStatus
from cnie_ocr.usage import UsageLedger
from cnie_rectifier import DetectorKind, RectificationResult, RectificationStatus

TOKEN = "desktop-token-with-enough-entropy-for-tests"


class Rectifier:
    def rectify(self, _):
        return RectificationResult(
            status=RectificationStatus.SUCCESS,
            request_id=uuid4(),
            original_dimensions=(2000, 1500),
            rectified_dimensions=(1600, 1008),
            corners=[[1, 1], [1999, 1], [1999, 1499], [1, 1499]],
            detector_used=DetectorKind.OPENCV,
            rectified_image=b"rectified-jpeg",
        )


class Ocr:
    def __init__(self):
        self.calls = []

    def recognize(self, image, request_id=None):
        self.calls.append(image)
        return OcrResult(status=OcrStatus.SUCCESS, request_id=request_id or uuid4(),
                         full_text="SECRET OCR TEXT", arabic_text="نص سري",
                         metrics={"character_count": 15, "mean_word_confidence": .95, "latency_ms": 8})


@dataclass
class Metadata:
    project_id: str = "valid-project-123"
    client_email: str = "vision@valid-project-123.iam.gserviceaccount.com"


class Store:
    def metadata(self): return Metadata()
    def import_bytes(self, _): return Metadata()
    def delete(self): return True


def auth(token=TOKEN): return {"Authorization": f"Bearer {token}"}


def wait_for(client, capture_id, status):
    for _ in range(100):
        capture = client.get("/api/workspace", headers=auth()).json()["captures"][0]
        if capture["id"] == capture_id and capture["ocr_summary"]["status"] == status:
            return capture
        time.sleep(.01)
    raise AssertionError(f"OCR did not reach {status}")


def test_local_acceptance_queues_ocr_automatically_and_manual_reaccept_is_idempotent(tmp_path):
    ocr = Ocr()
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=ocr,
                     credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"))
    with TestClient(app) as client:
        uploaded = client.post("/api/captures?side=front", content=b"image", headers={**auth(),
            "Content-Type": "image/jpeg", "Idempotency-Key": str(uuid4())}).json()
        assert uploaded["review"] == "accepted"
        wait_for(client, uploaded["id"], "success")
        assert ocr.calls == [b"rectified-jpeg"]
        accepted = client.post(f"/api/captures/{uploaded['id']}/review", headers=auth(),
                               json={"decision": "accepted"})
        assert accepted.status_code == 200
        client.post(f"/api/captures/{uploaded['id']}/review", headers=auth(), json={"decision": "accepted"})
        time.sleep(.03)
        assert len(ocr.calls) == 1
        result = client.get(f"/api/captures/{uploaded['id']}/ocr", headers=auth()).json()
        assert result["arabic_text"] == "نص سري"


def test_document_groups_faces_and_mobile_cannot_read_text(tmp_path):
    ocr = Ocr()
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=ocr,
                     credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"),
                     mobile_url="https://192.168.1.2:8788")
    with TestClient(app) as client:
        challenge = client.post("/api/pairing", headers=auth()).json()
        phone = client.post("/api/pair", json={"code": challenge["url"].split("#pair=")[1]}).json()["token"]
        first = client.post("/api/captures?side=front", content=b"front", headers={**auth(phone),
            "Content-Type":"image/jpeg", "Idempotency-Key":str(uuid4())}).json()
        second = client.post(f"/api/captures?side=back&document_id={first['document_id']}", content=b"back",
            headers={**auth(phone), "Content-Type":"image/jpeg", "Idempotency-Key":str(uuid4())}).json()
        workspace = client.get("/api/workspace", headers=auth(phone)).json()
        assert len(workspace["documents"]) == 1
        assert workspace["documents"][0]["front_capture_id"] == first["id"]
        assert workspace["documents"][0]["back_capture_id"] == second["id"]
        assert "SECRET OCR TEXT" not in str(workspace)
        assert client.get(f"/api/captures/{first['id']}/ocr", headers=auth(phone)).status_code == 403
        assert client.get("/api/ocr/config", headers=auth(phone)).status_code == 403


def test_replacement_marks_previous_inactive_and_cancels_ocr(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(),
                     credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"))
    with TestClient(app) as client:
        first = client.post("/api/captures?side=front", content=b"one", headers={**auth(),
            "Content-Type":"image/jpeg", "Idempotency-Key":str(uuid4())}).json()
        second = client.post(f"/api/captures?side=front&document_id={first['document_id']}", content=b"two",
            headers={**auth(), "Content-Type":"image/jpeg", "Idempotency-Key":str(uuid4())}).json()
        captures = client.get("/api/workspace", headers=auth()).json()["captures"]
        old = next(value for value in captures if value["id"] == first["id"])
        assert old["active"] is False
        assert old["ocr_summary"]["status"] == "cancelled"
        assert second["attempt"] == 2


def test_credential_endpoints_are_desktop_only_and_size_limited(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(),
                     credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"))
    with TestClient(app) as client:
        assert client.put("/api/ocr/config/credential", content=b"x" * (64*1024+1),
                          headers={**auth(), "Content-Type":"application/json"}).status_code == 413
        assert client.get("/api/ocr/config", headers=auth("not-a-session")).status_code == 401


def test_corrupt_usage_returns_storage_error_without_private_details(tmp_path):
    path = tmp_path / "usage.json"
    path.write_text("corrupt", encoding="utf-8")
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(),
                     credential_store=Store(), usage_ledger=UsageLedger(path))
    with TestClient(app) as client:
        for endpoint in ["/api/ocr/config", "/api/ocr/usage"]:
            response = client.get(endpoint, headers=auth())
            assert response.status_code == 503
            assert response.json() == {"detail": "OCR_USAGE_READ_FAILED"}
            assert response.headers["Cache-Control"] == "no-store"
