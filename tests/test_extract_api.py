import json
import time
from dataclasses import dataclass, replace
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


class LegacyExtractor(Extractor):
    def extract(self, front, back, request_id=None):
        result = super().extract(front, back, request_id)
        result.template = "CNIE_MA_LEGACY"
        result.engine_version = "1.0.0"
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


def wait_attention(client, document_id):
    for _ in range(200):
        document = next(item for item in client.get("/api/workspace", headers=auth()).json()["documents"]
                        if item["id"] == document_id)
        if document["extraction_summary"]["status"] == "attention":
            return document
        time.sleep(.01)
    raise AssertionError("Model mismatch did not block extraction")


def upload(client, side, payload, document_id=None, token=TOKEN, card_model="CNIE_MA_2020"):
    query = f"side={side}&card_model={card_model}" + (f"&document_id={document_id}" if document_id else "")
    return client.post(f"/api/captures?{query}", content=payload, headers={**auth(token),
        "Content-Type": "image/jpeg", "Idempotency-Key": str(uuid4())}).json()


def test_valid_images_enter_data_review_without_manual_image_approval(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=Extractor(),
        credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"))
    with TestClient(app) as client:
        front = upload(client, "front", b"front")
        back = upload(client, "back", b"back", front["document_id"])
        assert front["review"] == back["review"] == "accepted"
        assert front["ocr_summary"]["status"] in {"queued", "processing", "success"}
        assert wait_extraction(client, front["document_id"])["status"] == "data_review_required"
        assert client.get(f"/api/documents/{front['document_id']}/extraction", headers=auth()).status_code == 200


def test_legacy_profile_keeps_fourteen_reviews_and_exports_its_own_schema(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=LegacyExtractor(),
        credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"))
    with TestClient(app) as client:
        front = upload(client, "front", b"front", card_model="CNIE_MA_LEGACY")
        upload(client, "back", b"back", front["document_id"], card_model="CNIE_MA_LEGACY")
        assert wait_extraction(client, front["document_id"])["card_model"] == "CNIE_MA_LEGACY"
        url = f"/api/documents/{front['document_id']}/extraction"
        extraction = client.get(url, headers=auth()).json()
        assert extraction["engine"] == {"template": "CNIE_MA_LEGACY", "version": "1.0.0"}
        assert len(extraction["fields"]) == 14
        reviews = {key: {"decision": "confirmed", "value": None} for key in extraction["fields"]}
        reviewed = client.patch(url + "/review", headers=auth(), json={
            "revision": extraction["revision"], "fields": reviews}).json()
        assert client.post(url + "/approve", headers=auth(), json={"revision": reviewed["revision"]}).status_code == 200
        exported = client.get(f"/api/documents/{front['document_id']}/export", headers=auth()).json()
        assert exported["schema_version"] == "cnie.ma.legacy/v1"
        assert exported["extractor"] == {"template": "CNIE_MA_LEGACY", "version": "1.0.0"}
        identity = client.get("/api/workspace", headers=auth()).json()["approved_identities"][0]
        assert identity["card_template"] == "CNIE_MA_LEGACY"
        inheritance = next(item for item in client.get("/api/document-templates", headers=auth()).json()
                           if item["slug"] == "herencia")
        request = client.post("/api/document-generation-requests", headers={
            **auth(), "Idempotency-Key": str(uuid4())}, json={
                "template_id": inheritance["id"], "template_version": inheritance["version"],
                "assignments": {"heir": [identity["id"]]}})
        assert request.status_code == 200, request.text
        generated = client.post(f"/api/document-generation-requests/{request.json()['id']}/generate",
                                headers=auth())
        assert generated.status_code == 200, generated.text
        assert generated.content.startswith(b"PK")


def test_card_model_selection_is_fixed_for_both_faces_and_defaults_to_current(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=Extractor(),
        credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage.json"))
    with TestClient(app) as client:
        front = upload(client, "front", b"front")
        document_id = front["document_id"]
        assert client.get("/api/workspace", headers=auth()).json()["documents"][0]["card_model"] == "CNIE_MA_2020"
        wrong = client.post(f"/api/captures?side=back&document_id={document_id}&card_model=CNIE_MA_LEGACY",
            content=b"back", headers={**auth(), "Content-Type": "image/jpeg", "Idempotency-Key": str(uuid4())})
        assert wrong.status_code == 409 and wrong.json()["detail"] == "DOCUMENT_CARD_MODEL_LOCKED"
        assert client.get("/api/workspace", headers=auth()).json()["documents"][0]["back_capture_id"] is None
        upload(client, "back", b"back", document_id)
        assert wait_extraction(client, document_id)["card_model"] == "CNIE_MA_2020"


def test_selected_model_must_match_detected_extraction_before_review(tmp_path):
    for chosen, extractor in (("CNIE_MA_2020", LegacyExtractor()), ("CNIE_MA_LEGACY", Extractor())):
        app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=extractor,
            credential_store=Store(), usage_ledger=UsageLedger(tmp_path / chosen / "usage.json"))
        with TestClient(app) as client:
            front = upload(client, "front", b"front", card_model=chosen)
            upload(client, "back", b"back", front["document_id"], card_model=chosen)
            document = wait_attention(client, front["document_id"])
            assert document["extraction_summary"]["error_code"] == "EXTRACTION_CARD_MODEL_MISMATCH"
            assert document["extraction_summary"]["field_count"] == 0
            extraction = client.get(f"/api/documents/{front['document_id']}/extraction", headers=auth()).json()
            assert extraction["status"] == "attention" and extraction["fields"] == {}
            assert client.patch(f"/api/documents/{front['document_id']}/extraction/review", headers=auth(),
                json={"revision": extraction["revision"], "fields": {}}).status_code == 409
            assert client.get("/api/workspace", headers=auth()).json()["approved_identities"] == []


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
        # OCR now starts automatically for a valid replacement, so extraction
        # may already be ready again. The old human review must never survive.
        assert document["extraction_summary"]["status"] != "approved"
        assert document["extraction_summary"]["reviewed_count"] == 0
        assert client.get("/api/workspace", headers=auth()).json()["approved_identities"] == []


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


def test_approved_identity_release_mobile_request_and_windows_generation(tmp_path):
    app = create_app(desktop_token=TOKEN, engine=Rectifier(), ocr_engine=Ocr(), extractor=Extractor(),
        credential_store=Store(), usage_ledger=UsageLedger(tmp_path / "usage-documents.json"),
        mobile_url="https://192.168.1.2:8788")
    with TestClient(app) as client:
        challenge = client.post("/api/pairing", headers=auth()).json()
        mobile = client.post("/api/pair", json={"code": challenge["url"].split("#pair=")[1]}).json()["token"]
        front = upload(client, "front", b"front", token=mobile)
        back = upload(client, "back", b"back", front["document_id"], token=mobile)
        for capture in (front, back):
            client.post(f"/api/captures/{capture['id']}/review", headers=auth(), json={"decision": "accepted"})
        wait_extraction(client, front["document_id"])
        extraction_url = f"/api/documents/{front['document_id']}/extraction"
        extraction = client.get(extraction_url, headers=auth(mobile)).json()
        reviews = {key: {"decision": "confirmed", "value": None} for key in extraction["fields"]}
        reviewed = client.patch(extraction_url + "/review", headers=auth(mobile),
                                json={"revision": extraction["revision"], "fields": reviews}).json()
        client.post(extraction_url + "/approve", headers=auth(mobile),
                    json={"revision": reviewed["revision"]}).raise_for_status()
        mobile_workspace = client.get("/api/workspace", headers=auth(mobile)).json()
        approved = mobile_workspace["approved_identities"][0]
        templates = client.get("/api/document-templates", headers=auth(mobile)).json()
        assert {item["id"] for item in templates} == {"ma.marriage", "ma.inheritance"}
        request_payload = {"template_id": "ma.inheritance", "template_version": "1.4.0",
                           "assignments": {"applicant": [], "heir": [approved["id"]], "witness": []}}
        key = str(uuid4())
        created = client.post("/api/document-generation-requests", headers={**auth(mobile), "Idempotency-Key": key},
                              json=request_payload)
        assert created.status_code == 200, created.text
        repeated = client.post("/api/document-generation-requests", headers={**auth(mobile), "Idempotency-Key": key},
                               json=request_payload)
        assert repeated.json()["id"] == created.json()["id"]
        assert len(client.get("/api/workspace", headers=auth()).json()["document_generation_requests"]) == 1
        challenge2 = client.post("/api/pairing", headers=auth()).json()
        other = client.post("/api/pair", json={"code": challenge2["url"].split("#pair=")[1]}).json()["token"]
        other_workspace = client.get("/api/workspace", headers=auth(other)).json()
        assert other_workspace["approved_identities"] == []
        assert other_workspace["document_generation_requests"] == []
        released = client.post(f"/api/documents/{front['document_id']}/release-images", headers=auth(mobile))
        assert released.status_code == 200 and released.json()["images_released"] is True
        assert client.post(f"/api/documents/{front['document_id']}/release-images", headers=auth(mobile)).status_code == 404
        after_release = client.get("/api/workspace", headers=auth()).json()
        assert after_release["captures"] == [] and after_release["documents"] == []
        assert len(after_release["approved_identities"]) == 1
        generated = client.post(f"/api/document-generation-requests/{created.json()['id']}/generate", headers=auth())
        assert generated.status_code == 200
        assert generated.content.startswith(b"PK\x03\x04")
        assert generated.headers["cache-control"] == "no-store"
        assert b"SECRET" not in generated.content
        stale = client.patch(f"/api/document-generation-requests/{created.json()['id']}",
            headers={**auth(), "Idempotency-Key": str(uuid4())},
            json={"revision": 99, "assignments": request_payload["assignments"]})
        assert stale.status_code == 409 and stale.json()["detail"] == "DOCUMENT_REQUEST_STALE_REVISION"
        delete_key = str(uuid4())
        deleted = client.delete(f"/api/document-generation-requests/{created.json()['id']}",
                                headers={**auth(), "Idempotency-Key": delete_key})
        assert deleted.status_code == 200
        replay = client.delete(f"/api/document-generation-requests/{created.json()['id']}",
                               headers={**auth(), "Idempotency-Key": delete_key})
        assert replay.status_code == 200 and replay.json() == deleted.json()
        replacement_request = client.post("/api/document-generation-requests",
            headers={**auth(mobile), "Idempotency-Key": str(uuid4())}, json=request_payload).json()
        state = app.state.capture
        current = state.approved_identities[approved["id"]]
        state.approved_identities[approved["id"]] = replace(current, expires=time.time() - 1)
        pruned = client.get("/api/workspace", headers=auth()).json()
        assert pruned["approved_identities"] == []
        assert all(item["id"] != replacement_request["id"] for item in pruned["document_generation_requests"])
