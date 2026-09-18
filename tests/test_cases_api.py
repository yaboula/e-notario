from __future__ import annotations

import io
import time
import zipfile
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from cnie_capture.api import ApprovedIdentity, create_app


TOKEN = "test-desktop-token-with-enough-entropy"


@pytest.fixture
def client():
    with TestClient(create_app(desktop_token=TOKEN,
                               mobile_url="https://192.168.1.20:8788")) as value:
        yield value


def auth(token=TOKEN, key=None):
    headers = {"Authorization": f"Bearer {token}"}
    if key:
        headers["Idempotency-Key"] = key
    return headers


def create_case(client, *, token=TOKEN, mode="complete", key=None):
    return client.post("/api/cases", headers=auth(token, key or str(uuid4())), json={
        "template_id": "ma.marriage",
        "template_version": "1.7.0",
        "mode": mode,
    })


def pair(client):
    challenge = client.post("/api/pairing", headers=auth()).json()
    code = challenge["url"].split("#pair=")[1]
    return client.post("/api/pair", json={"code": code}).json()["token"]


def add_identity(client, owner="desktop") -> str:
    identity_id = str(uuid4())
    now = time.time()
    client.app.state.capture.approved_identities[identity_id] = ApprovedIdentity(
        id=identity_id, owner=owner, document_id=str(uuid4()), extraction_revision=1,
        source="desktop", card_template="CNIE_MA_2020", values={
            "given_names_ar": "محمد", "surname_ar": "الاختبار", "filiation_ar": "الأب والأم",
            "birth_date": "1990-01-02", "birth_place_ar": "الرباط",
            "expiry_date": "2030-01-02",
            "national_id": f"AA{identity_id[-6:].replace('-', '0')}",
            "address_ar": ["عنوان اصطناعي"], "sex": "M",
        },
        created=now, expires=now + 3600,
    )
    return identity_id


def test_case_create_update_revisions_and_final_review(client):
    response = create_case(client)
    assert response.status_code == 201
    item = response.json()
    assert item["mode"] == "complete"
    assert item["revision"] == 0

    identities = [add_identity(client) for _ in range(3)]
    profile = client.post("/api/professional-profiles", headers=auth(), json={
        "display_name_ar": "العدل التجريبي", "display_name_fr": "Adoul de test",
        "function_fr": "Adoul",
    }).json()
    update = client.patch(f"/api/cases/{item['id']}", headers=auth(key=str(uuid4())), json={
        "revision": 0,
        "fields": {"registry_number": "42", "dowry": "1000", "notary_1": profile["id"]},
        "assignments": {
            "husband": [identities[0]], "wife": [identities[1]],
            "wife_father": [identities[2]],
        },
    })
    assert update.status_code == 200, update.text
    updated = update.json()
    assert updated["revision"] == 1
    assert updated["fields"]["registry_number"] == "42"

    stale = client.patch(f"/api/cases/{item['id']}", headers=auth(key=str(uuid4())), json={
        "revision": 0, "fields": {},
    })
    assert stale.status_code == 409
    assert stale.json()["detail"] == "CASE_STALE_REVISION"

    review = client.post(f"/api/cases/{item['id']}/final-review", headers=auth(),
                         json={"revision": 1})
    assert review.status_code == 200, review.text
    assert review.json()["status"] == "final_review"

    readiness = client.get(f"/api/cases/{item['id']}/readiness", headers=auth()).json()
    assert readiness["missing_roles"] == []
    assert "registry_date" in readiness["missing_fields"]
    generated = client.post(f"/api/cases/{item['id']}/generate", headers=auth(), json={
        "revision": 2, "confirm_incomplete": False,
    })
    assert generated.status_code == 200, generated.text
    assert generated.content[:4] == b"PK\x03\x04"
    assert generated.headers["x-enotario-case-revision"] == "2"
    with zipfile.ZipFile(io.BytesIO(generated.content)) as package:
        assert "العدل التجريبي".encode() in package.read("word/document.xml")
    completed = client.post(f"/api/cases/{item['id']}/complete", headers=auth(),
                            json={"revision": 2})
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    retained_profile = client.get("/api/professional-profiles", headers=auth()).json()[0]
    protected_profile = client.patch(
        f"/api/professional-profiles/{profile['id']}", headers=auth(), json={
            **{key: retained_profile[key] for key in
               ("display_name_ar", "display_name_fr", "function_fr", "revision")},
            "active": False,
        })
    assert protected_profile.status_code == 409
    assert protected_profile.json()["detail"] == "PROFILE_IN_USE"
    retried_completion = client.post(f"/api/cases/{item['id']}/complete", headers=auth(),
                                    json={"revision": 2})
    assert retried_completion.status_code == 200
    assert retried_completion.json() == completed.json()
    reopened = client.post(f"/api/cases/{item['id']}/reopen", headers=auth(),
                           json={"revision": 3})
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "editing"


def test_one_off_professional_name_and_empty_roles_generate_without_blocking(client):
    item = create_case(client).json()
    direct_name = "العدل المستعمل لهذه الوثيقة فقط"
    patched = client.patch(f"/api/cases/{item['id']}", headers=auth(key=str(uuid4())), json={
        "revision": 0, "fields": {"notary_1": direct_name}, "assignments": {},
    })
    assert patched.status_code == 200, patched.text
    readiness = client.get(f"/api/cases/{item['id']}/readiness", headers=auth()).json()
    assert readiness["missing_roles"] == []
    reviewed = client.post(f"/api/cases/{item['id']}/final-review", headers=auth(),
                           json={"revision": patched.json()["revision"]})
    generated = client.post(f"/api/cases/{item['id']}/generate", headers=auth(), json={
        "revision": reviewed.json()["revision"], "confirm_incomplete": False,
    })
    assert generated.status_code == 200, generated.text
    with zipfile.ZipFile(io.BytesIO(generated.content)) as package:
        assert direct_name.encode() in package.read("word/document.xml")
    assert client.get("/api/professional-profiles", headers=auth()).json() == []


def test_case_idempotency_partial_mode_and_mobile_isolation(client):
    key = str(uuid4())
    first = create_case(client, key=key)
    second = create_case(client, key=key)
    assert first.json()["id"] == second.json()["id"]
    conflict = client.post("/api/cases", headers=auth(key=key), json={
        "template_id": "ma.inheritance", "template_version": "1.4.0", "mode": "partial",
    })
    assert conflict.status_code == 409

    mobile1, mobile2 = pair(client), pair(client)
    mobile_case = create_case(client, token=mobile1).json()
    assert client.get(f"/api/cases/{mobile_case['id']}", headers=auth(mobile2)).status_code == 404
    assert all(item["id"] != mobile_case["id"]
               for item in client.get("/api/cases", headers=auth(mobile2)).json())
    assert any(item["id"] == mobile_case["id"]
               for item in client.get("/api/cases", headers=auth()).json())

    partial = create_case(client, mode="partial").json()
    result = client.patch(f"/api/cases/{partial['id']}", headers=auth(key=str(uuid4())), json={
        "revision": 0, "fields": {"registry_number": "42"},
    })
    assert result.status_code == 409
    assert result.json()["detail"] == "CASE_FIELDS_REQUIRE_COMPLETE_MODE"


def test_clear_temporary_data_is_desktop_only_and_preserves_configuration(client):
    profile = client.post("/api/professional-profiles", headers=auth(), json={
        "display_name_ar": "عدل محفوظ", "display_name_fr": "Profil conservé",
        "function_fr": "Adoul",
    }).json()
    create_case(client)
    mobile = pair(client)
    create_case(client, token=mobile)
    denied = client.request("DELETE", "/api/temporary-data", headers=auth(mobile),
                            json={"confirmation": "CLEAR_TEMPORARY_DATA"})
    assert denied.status_code == 403

    cleared = client.request("DELETE", "/api/temporary-data", headers=auth(),
                             json={"confirmation": "CLEAR_TEMPORARY_DATA"})
    assert cleared.status_code == 200
    assert cleared.json()["deleted"]["cases"] == 2
    assert client.get("/api/cases", headers=auth()).json() == []
    assert client.get("/api/document-templates", headers=auth()).status_code == 200
    profiles = client.get("/api/professional-profiles", headers=auth()).json()
    assert [item["id"] for item in profiles] == [profile["id"]]
    assert client.get("/api/workspace", headers=auth(mobile)).status_code == 401


def test_clearing_through_api_removes_only_the_managed_receipt_catalog(tmp_path):
    receipt_path = tmp_path / "saved-case-receipts.dpapi"
    receipt_path.write_bytes(b"synthetic-protected-receipt-catalog")
    word_path = tmp_path / "synthetic.docx"
    word_path.write_bytes(b"synthetic-independent-word-file")
    with TestClient(create_app(desktop_token=TOKEN, saved_receipts_path=receipt_path,
                               mobile_url="https://192.168.1.20:8788")) as value:
        mobile = pair(value)
        denied = value.request("DELETE", "/api/temporary-data", headers=auth(mobile),
                               json={"confirmation": "CLEAR_TEMPORARY_DATA"})
        assert denied.status_code == 403
        assert receipt_path.exists()
        response = value.request("DELETE", "/api/temporary-data", headers=auth(),
                                 json={"confirmation": "CLEAR_TEMPORARY_DATA"})
        assert response.status_code == 200
        assert response.json()["deleted"]["saved_receipt_catalog"] == 1
        assert not receipt_path.exists()
        assert word_path.read_bytes() == b"synthetic-independent-word-file"


def test_profiles_are_desktop_managed_and_mobile_only_sees_active(client):
    mobile = pair(client)
    denied = client.post("/api/professional-profiles", headers=auth(mobile), json={
        "display_name_ar": "غير مسموح", "display_name_fr": "Refusé", "function_fr": "Adoul",
    })
    assert denied.status_code == 403
    created = client.post("/api/professional-profiles", headers=auth(), json={
        "display_name_ar": "عدل نشط", "display_name_fr": "Profil actif", "function_fr": "Adoul",
    }).json()
    assert client.get("/api/professional-profiles", headers=auth(mobile)).json()[0]["id"] == created["id"]
    disabled = client.patch(f"/api/professional-profiles/{created['id']}", headers=auth(), json={
        **{key: created[key] for key in ("display_name_ar", "display_name_fr", "function_fr", "revision")},
        "active": False,
    })
    assert disabled.status_code == 200
    assert client.get("/api/professional-profiles", headers=auth(mobile)).json() == []


def test_profile_creation_has_a_durable_resource_identity_for_safe_retries(client):
    profile_id = str(uuid4())
    payload = {
        "id": profile_id, "display_name_ar": "عدل ثابت",
        "display_name_fr": "Profil stable", "function_fr": "Adoul",
    }
    first = client.post("/api/professional-profiles", headers=auth(), json=payload)
    retry = client.post("/api/professional-profiles", headers=auth(), json=payload)
    assert first.status_code == retry.status_code == 201
    assert first.json()["id"] == retry.json()["id"] == profile_id
    assert len(client.get("/api/professional-profiles", headers=auth()).json()) == 1

    conflict = client.post("/api/professional-profiles", headers=auth(), json={
        **payload, "display_name_ar": "اسم مختلف",
    })
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "PROFILE_ALREADY_EXISTS"


def test_profile_update_retry_returns_the_committed_revision(client):
    created = client.post("/api/professional-profiles", headers=auth(), json={
        "display_name_ar": "عدل أول", "display_name_fr": "Nom initial",
        "function_fr": "Adoul",
    }).json()
    payload = {
        **{key: created[key] for key in ("display_name_ar", "function_fr", "revision")},
        "display_name_fr": "Nom corrigé", "active": True,
    }
    first = client.patch(f"/api/professional-profiles/{created['id']}",
                         headers=auth(), json=payload)
    retry = client.patch(f"/api/professional-profiles/{created['id']}",
                         headers=auth(), json=payload)
    assert first.status_code == retry.status_code == 200
    assert first.json()["revision"] == retry.json()["revision"] == 1

    conflict = client.patch(f"/api/professional-profiles/{created['id']}",
                            headers=auth(), json={**payload, "display_name_fr": "Autre nom"})
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "PROFILE_STALE_REVISION"


def test_profile_in_active_case_can_be_renamed_but_not_deactivated_or_deleted(client):
    profile = client.post("/api/professional-profiles", headers=auth(), json={
        "display_name_ar": "العدل الأصلي", "display_name_fr": "Profil original",
        "function_fr": "Adoul",
    }).json()
    case = create_case(client).json()
    linked = client.patch(f"/api/cases/{case['id']}", headers=auth(key=str(uuid4())), json={
        "revision": case["revision"], "fields": {"notary_1": profile["id"]},
    })
    assert linked.status_code == 200, linked.text

    listed = client.get("/api/professional-profiles", headers=auth()).json()
    linked_profile = next(item for item in listed if item["id"] == profile["id"])
    assert linked_profile["in_use"] is True
    assert linked_profile["usage_count"] == 1
    mobile_view = client.get("/api/professional-profiles", headers=auth(pair(client))).json()[0]
    assert mobile_view["in_use"] is False
    assert mobile_view["usage_count"] == 0

    renamed = client.patch(f"/api/professional-profiles/{profile['id']}", headers=auth(), json={
        **{key: linked_profile[key] for key in
           ("display_name_fr", "function_fr", "active", "revision")},
        "display_name_ar": "العدل المصحح",
    })
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["in_use"] is True

    deactivate = client.patch(f"/api/professional-profiles/{profile['id']}", headers=auth(), json={
        **{key: renamed.json()[key] for key in
           ("display_name_ar", "display_name_fr", "function_fr", "revision")},
        "active": False,
    })
    assert deactivate.status_code == 409
    assert deactivate.json()["detail"] == "PROFILE_IN_USE"
    deleted = client.delete(f"/api/professional-profiles/{profile['id']}", headers=auth())
    assert deleted.status_code == 409
    assert deleted.json()["detail"] == "PROFILE_IN_USE"

    cleared = client.patch(f"/api/cases/{case['id']}", headers=auth(key=str(uuid4())), json={
        "revision": linked.json()["revision"], "fields": {"notary_1": ""},
    })
    assert cleared.status_code == 200, cleared.text
    current = client.get("/api/professional-profiles", headers=auth()).json()[0]
    deactivate = client.patch(f"/api/professional-profiles/{profile['id']}", headers=auth(), json={
        **{key: current[key] for key in
           ("display_name_ar", "display_name_fr", "function_fr", "revision")},
        "active": False,
    })
    assert deactivate.status_code == 200, deactivate.text
    refused = client.delete(f"/api/professional-profiles/{profile['id']}", headers=auth())
    assert refused.status_code == 200, refused.text


def test_case_field_leases_prevent_overwrite_and_allow_parallel_fields(client):
    mobile = pair(client)
    item = create_case(client, token=mobile).json()
    case_url = f"/api/cases/{item['id']}"

    mobile_lease = client.post(f"{case_url}/field-leases", headers=auth(mobile), json={
        "field_key": "registry_number", "actor_label": "Sara · téléphone",
    })
    assert mobile_lease.status_code == 200, mobile_lease.text
    mobile_lease = mobile_lease.json()
    assert mobile_lease["lease_token"]

    conflict = client.post(f"{case_url}/field-leases", headers=auth(), json={
        "field_key": "registry_number", "actor_label": "Poste Windows",
    })
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "CASE_FIELD_LOCKED"
    public = client.get(f"{case_url}/field-leases", headers=auth()).json()
    assert public == [{**{key: mobile_lease[key] for key in
                          ("case_id", "field_key", "actor_label", "expires_at")},
                       "owned_by_me": False}]
    bypass = client.patch(case_url, headers=auth(key=str(uuid4())), json={
        "revision": 0, "fields": {"registry_number": "999"},
    })
    assert bypass.status_code == 409
    assert bypass.json()["detail"] == "CASE_FIELD_LOCKED"
    freeze = client.post(f"{case_url}/final-review", headers=auth(), json={"revision": 0})
    assert freeze.status_code == 409
    assert freeze.json()["detail"] == "CASE_EDITORS_ACTIVE"

    first_patch = client.patch(f"{case_url}/fields/registry_number",
                               headers=auth(mobile, str(uuid4())), json={
        "value": "42", "lease_token": mobile_lease["lease_token"],
    })
    assert first_patch.status_code == 200, first_patch.text
    assert first_patch.json()["fields"]["registry_number"] == "42"

    desktop_lease = client.post(f"{case_url}/field-leases", headers=auth(), json={
        "field_key": "case_number", "actor_label": "Poste Windows",
    }).json()
    second_patch = client.patch(f"{case_url}/fields/case_number",
                                headers=auth(key=str(uuid4())), json={
        "value": "2026/17", "lease_token": desktop_lease["lease_token"],
    })
    assert second_patch.status_code == 200, second_patch.text
    assert second_patch.json()["revision"] == 2
    assert second_patch.json()["fields"] == {
        "registry_number": "42", "case_number": "2026/17",
    }

    released = client.request("DELETE", f"{case_url}/field-leases", headers=auth(mobile),
                              json={"field_key": "registry_number",
                                    "lease_token": mobile_lease["lease_token"]})
    assert released.status_code == 200
    assert client.post(f"{case_url}/field-leases", headers=auth(), json={
        "field_key": "registry_number", "actor_label": "Poste Windows",
    }).status_code == 200


def test_case_field_patch_requires_the_current_lease(client):
    item = create_case(client).json()
    response = client.patch(f"/api/cases/{item['id']}/fields/registry_number",
                            headers=auth(key=str(uuid4())), json={
        "value": "42", "lease_token": "not-the-current-lease-token",
    })
    assert response.status_code == 409
    assert response.json()["detail"] == "CASE_FIELD_LEASE_EXPIRED"


def test_role_patch_is_atomic_and_cannot_bypass_another_editor(client):
    mobile = pair(client)
    item = create_case(client, token=mobile).json()
    identity_id = add_identity(client, owner=mobile)
    url = f"/api/cases/{item['id']}"
    lease = client.post(f"{url}/field-leases", headers=auth(mobile), json={
        "field_key": "role.husband", "actor_label": "Téléphone",
    }).json()
    rejected = client.patch(url, headers=auth(key=str(uuid4())), json={
        "revision": 0, "assignments": {"husband": [identity_id]},
    })
    assert rejected.status_code == 409
    assert rejected.json()["detail"] == "CASE_FIELD_LOCKED"
    patched = client.patch(f"{url}/assignments/husband", headers=auth(mobile, str(uuid4())),
                           json={"value": [identity_id], "lease_token": lease["lease_token"]})
    assert patched.status_code == 200, patched.text
    assert patched.json()["assignments"] == {"husband": [identity_id]}


@pytest.mark.parametrize("template_id,version,counts", [
    ("ma.marriage", "1.7.0", {"husband": 1, "wife": 1, "wife_father": 1}),
    ("ma.inheritance", "1.5.1", {"applicant": 1, "heir": 12, "witness": 12}),
])
def test_mobile_owned_approved_identities_to_windows_docx(client, template_id, version, counts):
    # Deliberately seed approved synthetic values: this verifies the post-approval
    # API workflow, not OCR, camera capture, native saving or Word pagination.
    mobile, other_mobile = pair(client), pair(client)
    assignments = {role: [add_identity(client, owner=mobile) for _ in range(count)]
                   for role, count in counts.items()}
    created = client.post("/api/cases", headers=auth(mobile, str(uuid4())), json={
        "template_id": template_id, "template_version": version, "mode": "complete",
    })
    assert created.status_code == 201, created.text
    item = created.json()
    url = f"/api/cases/{item['id']}"
    patch_key = str(uuid4())
    body = {"revision": 0, "assignments": assignments,
            "fields": {"registry_number": "5051"}}
    patched = client.patch(url, headers=auth(mobile, patch_key), json=body)
    assert patched.status_code == 200, patched.text
    retried = client.patch(url, headers=auth(mobile, patch_key), json=body)
    assert retried.status_code == 200
    assert retried.json() == patched.json()
    assert client.get(url, headers=auth(other_mobile)).status_code == 404
    readiness = client.get(f"{url}/readiness", headers=auth(mobile)).json()
    assert readiness["missing_roles"] == []
    assert readiness["can_generate_with_confirmation"] is True

    reviewed = client.post(f"{url}/final-review", headers=auth(mobile),
                           json={"revision": patched.json()["revision"]})
    assert reviewed.status_code == 200, reviewed.text
    revision = reviewed.json()["revision"]
    assert reviewed.json()["status"] == "final_review"
    locked = client.patch(url, headers=auth(mobile, str(uuid4())), json={
        "revision": revision, "fields": {"registry_number": "9999"},
    })
    assert locked.status_code == 409
    assert locked.json()["detail"] == "CASE_NOT_EDITABLE"
    for action in ("generate", "complete", "reopen"):
        payload = {"revision": revision}
        if action == "generate":
            payload["confirm_incomplete"] = True
        denied = client.post(f"{url}/{action}", headers=auth(mobile), json=payload)
        assert denied.status_code == 403

    generated = client.post(f"{url}/generate", headers=auth(), json={
        "revision": revision, "confirm_incomplete": True,
    })
    assert generated.status_code == 200, generated.text
    assert generated.headers["cache-control"] == "no-store"
    assert generated.headers["x-enotario-case-revision"] == str(revision)
    assert len(generated.content) <= 25 * 1024 * 1024
    with zipfile.ZipFile(io.BytesIO(generated.content)) as package:
        assert package.testzip() is None
        xml = package.read("word/document.xml").decode("utf-8")
        assert "5051" in xml
        for identity_ids in assignments.values():
            for identity_id in identity_ids:
                approved = client.app.state.capture.approved_identities[identity_id]
                assert approved.values["national_id"] in xml
                assert identity_id not in xml
        assert mobile not in xml and other_mobile not in xml
    # Downloading is not saving: final review must remain recoverable until the
    # desktop explicitly confirms the successful native save.
    assert client.get(url, headers=auth(mobile)).json()["status"] == "final_review"
    completed = client.post(f"{url}/complete", headers=auth(), json={"revision": revision})
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert client.get(url, headers=auth(mobile)).json()["status"] == "completed"
    assert client.post(f"{url}/reopen", headers=auth(mobile), json={
        "revision": completed.json()["revision"],
    }).status_code == 403
    reopened = client.post(f"{url}/reopen", headers=auth(), json={
        "revision": completed.json()["revision"],
    })
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "editing"
