import json
import time
from dataclasses import dataclass
from uuid import uuid4

from fastapi.testclient import TestClient

from cnie_capture.api import create_app
from cnie_extract import ExtractionResult, ExtractionStatus, ExtractedField
from cnie_ocr.domain import OcrResult, OcrStatus
from cnie_ocr.usage import UsageLedger
from cnie_rectifier import DetectorKind, RectificationResult, RectificationStatus

TOKEN = "desktop-token-for-extraction-tests"


class Rectifier:
    def rectify(self, payload):
        return RectificationResult(status=RectificationStatus.SUCCESS, request_id=uuid4(),
            original_dimensions=(2000, 1500), rectified_dimensions=(1600, 1008),
            corners=[[1, 1], [1999, 1], [1999, 1499], [1, 1499]],
            detector_used=DetectorKind.OPENCV, rectified_image=b"rectified-" + payload)


class Ocr:
    def recognize(self, image, request_id=None):
        return OcrResult(OcrStatus.SUCCESS, request_id or uuid4(), full_text="SECRET " + image.decode(),
                         metrics={"character_count": 20, "mean_word_confidence": .95})


class Extractor:
    def extract(self, front, back, request_id=None):
        values = {"national_id": "AA123456", "birth_date": "1990-01-01",
                  "expiry_date": "2030-01-01", "sex": "F",
                  "given_names_ar": "اختبار", "given_names_latin": "TEST",
                  "surname_ar": "مثال", "surname_latin": "SPECIMEN",
                  "birth_place_ar": "الرباط", "birth_place_latin": "RABAT",
                  "filiation_ar": ["والد", "والدة"], "filiation_latin": ["PARENT ONE", "PARENT TWO"],
                  "address_ar": ["عنوان"], "address_latin": ["ADDRESS"]}
        fields = {key: ExtractedField(key, value, value, .96, True) for key, value in values.items()}
        return ExtractionResult(ExtractionStatus.REVIEW_REQUIRED, request_id or uuid4(),
                                template="CNIE_MA_2020", fields=fields)


class MismatchExtractor(Extractor):
    def extract(self, front, back, request_id=None):
        result = super().extract(front, back, request_id)
        result.warnings = ["EXTRACTION_SIDE_MISMATCH"]
        result.fields["national_id"].warnings = ["EXTRACTION_SIDE_MISMATCH"]
        return result


@dataclass
class Metadata:
    project_id: str = "project"
    client_email: str = "vision@example.test"


class Store:
    def metadata(self): return Metadata()
    def import_bytes(self, _): return Metadata()
    def delete(self): return True


def auth(token=TOKEN): return {"Authorization": f"Bearer {token}"}


def wait_extraction(client, document_id):
    for _ in range(200):
        document = client.get("/api/workspace", headers=auth()).json()["documents"][0]
        if document["id"] == document_id and document["extraction_summary"]["status"] == "review_required":
            return document
        time.sleep(.01)
    raise AssertionError("Extraction did not finish")


def upload(client, side, payload, document_id=None, token=TOKEN):
    query = f"side={side}" + (f"&document_id={document_id}" if document_id else "")
    return client.post(f"/api/captures?{query}", content=payload, headers={**auth(token),
        "Content-Type": "image/jpeg", "Idempotency-Key": str(uuid4())}).json()


def test_extraction_review_approval_export_and_mobile_isolation(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=Extractor(),
        credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"),
        mobile_url="https://192.168.1.2:8788")
    with TestClient(app) as client:
        challenge = client.post("/api/pairing", headers=auth()).json()
        mobile = client.post("/api/pair", json={"code": challenge["url"].split("#pair=")[1]}).json()["token"]
        front = upload(client, "front", b"front", token=mobile)
        back = upload(client, "back", b"back", front["document_id"], token=mobile)
        for capture in (front, back):
            client.post(f"/api/captures/{capture['id']}/review", headers=auth(), json={"decision": "accepted"})
        wait_extraction(client, front["document_id"])
        url = f"/api/documents/{front['document_id']}/extraction"
        extraction = client.get(url, headers=auth(mobile)).json()
        assert len(extraction["fields"]) == 14
        assert "result" not in extraction and "effective_mrz" not in extraction
        assert '"mrz"' not in json.dumps(extraction).lower()
        assert all("raw_value" not in field and "evidence" not in field for field in extraction["fields"].values())
        malformed = client.patch(url + "/review", headers=auth(mobile), json={"revision": extraction["revision"],
            "fields": {"national_id": {"decision": "corrected", "value": ["AA123456"]}}})
        assert malformed.status_code == 400
        reviews = {key: {"decision": "confirmed", "value": None}
                   for key, field in extraction["fields"].items() if field["required"]}
        with client.websocket_connect("/api/events") as socket:
            socket.send_json({"token": TOKEN})
            assert socket.receive_json()["type"] == "connected"
            reviewed = client.patch(url + "/review", headers=auth(mobile),
                                    json={"revision": extraction["revision"], "fields": reviews}).json()
            assert socket.receive_json()["type"] == "changed"
        assert reviewed["revision"] == extraction["revision"] + 1
        assert all(review["reviewed_by"] == "mobile" for review in reviewed["reviews"].values())
        assert client.patch(url + "/review", headers=auth(mobile),
                            json={"revision": extraction["revision"], "fields": reviews}).status_code == 409
        approved = client.post(url + "/approve", headers=auth(mobile), json={"revision": reviewed["revision"]})
        assert approved.status_code == 200, approved.text
        assert approved.json()["approved_by"] == "mobile"
        desktop_view = client.get(url, headers=auth()).json()
        assert desktop_view["status"] == "approved"
        assert desktop_view["approved_by"] == "mobile"
        exported = client.get(f"/api/documents/{front['document_id']}/export", headers=auth())
        assert exported.status_code == 200
        assert exported.json()["schema_version"] == "cnie.ma.2020/v2"
        assert exported.json()["data"]["national_id"] == "AA123456"
        assert not {"issuing_authority_ar", "can", "civil_status_act_number", "marital_mention", "mrz"} & exported.json()["data"].keys()
        assert "SECRET" not in exported.text
        assert client.get(f"/api/documents/{front['document_id']}/export", headers=auth(mobile)).status_code == 403
        assert client.patch(url + "/review", headers=auth(mobile), json={"revision": approved.json()["revision"],
            "fields": {"sex": {"decision": "confirmed", "value": None}}}).status_code == 409

        challenge2 = client.post("/api/pairing", headers=auth()).json()
        other_mobile = client.post("/api/pair", json={"code": challenge2["url"].split("#pair=")[1]}).json()["token"]
        assert client.get(url, headers=auth(other_mobile)).status_code == 404


def test_replacing_a_face_invalidates_approved_extraction(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=Extractor(),
        credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"))
    with TestClient(app) as client:
        front = upload(client, "front", b"front")
        back = upload(client, "back", b"back", front["document_id"])
        for capture in (front, back):
            client.post(f"/api/captures/{capture['id']}/review", headers=auth(), json={"decision": "accepted"})
        wait_extraction(client, front["document_id"])
        replacement = upload(client, "back", b"replacement", front["document_id"])
        document = client.get("/api/workspace", headers=auth()).json()["documents"][0]
        assert document["back_capture_id"] == replacement["id"]
        assert document["extraction_summary"]["status"] == "waiting_for_ocr"
        assert client.get(f"/api/documents/{front['document_id']}/extraction", headers=auth()).status_code == 409


def test_side_mismatch_and_invalid_visual_values_block_approval_without_mrz(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=MismatchExtractor(),
        credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"))
    with TestClient(app) as client:
        front = upload(client, "front", b"front")
        back = upload(client, "back", b"back", front["document_id"])
        for capture in (front, back):
            client.post(f"/api/captures/{capture['id']}/review", headers=auth(), json={"decision": "accepted"})
        wait_extraction(client, front["document_id"])
        url = f"/api/documents/{front['document_id']}/extraction"
        extraction = client.get(url, headers=auth()).json()
        reviews = {key: {"decision": "confirmed", "value": None} for key in extraction["fields"]}
        reviewed = client.patch(url + "/review", headers=auth(),
                                json={"revision": extraction["revision"], "fields": reviews}).json()
        mismatch = client.post(url + "/approve", headers=auth(), json={"revision": reviewed["revision"]})
        assert mismatch.status_code == 409
        assert mismatch.json()["detail"] == "EXTRACTION_SIDE_MISMATCH"

    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=Extractor(),
        credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage-2.json"))
    with TestClient(app) as client:
        front = upload(client, "front", b"front")
        back = upload(client, "back", b"back", front["document_id"])
        for capture in (front, back):
            client.post(f"/api/captures/{capture['id']}/review", headers=auth(), json={"decision": "accepted"})
        wait_extraction(client, front["document_id"])
        url = f"/api/documents/{front['document_id']}/extraction"
        extraction = client.get(url, headers=auth()).json()
        reviews = {key: {"decision": "confirmed", "value": None} for key in extraction["fields"]}
        reviews["sex"] = {"decision": "corrected", "value": "unknown"}
        reviewed = client.patch(url + "/review", headers=auth(),
                                json={"revision": extraction["revision"], "fields": reviews}).json()
        invalid = client.post(url + "/approve", headers=auth(), json={"revision": reviewed["revision"]})
        assert invalid.status_code == 409
        assert invalid.json()["detail"] == "EXTRACTION_DATA_CONFLICT"
