from __future__ import annotations

import io
import time
import zipfile
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from lxml import etree

from cnie_capture.api import ApprovedIdentity, create_app

TOKEN = "test-role-fields-desktop-token-long-enough"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def auth(key=None):
    result = {"Authorization": f"Bearer {TOKEN}"}
    if key:
        result["Idempotency-Key"] = key
    return result


@pytest.fixture
def client():
    with TestClient(create_app(desktop_token=TOKEN)) as value:
        yield value


def identity(client, number):
    key = str(uuid4())
    client.app.state.capture.approved_identities[key] = ApprovedIdentity(
        id=key, owner="desktop", document_id=str(uuid4()), extraction_revision=1,
        source="desktop", card_template="CNIE_MA_2020", created=time.time(),
        expires=time.time() + 3600, values={
            "national_id": f"TEST{number}", "given_names_ar": f"شخص {number}",
            "surname_ar": "تجريبي", "filiation_ar": "الأب والأم", "sex": "M",
            "birth_date": "1990-01-02", "birth_place_ar": "الرباط",
            "expiry_date": "2030-01-02",
            "address_ar": ["عنوان اصطناعي"],
        })
    return key


def case(client, version="1.5.0", count=2):
    response = client.post("/api/cases", headers=auth(str(uuid4())), json={
        "template_id": "ma.inheritance", "template_version": version, "mode": "complete"})
    assert response.status_code == 201, response.text
    item = response.json()
    people = [identity(client, number + 1) for number in range(count)]
    response = client.patch(f"/api/cases/{item['id']}", headers=auth(str(uuid4())), json={
        "revision": 0, "assignments": {"heir": people},
        "fields": {"heir_relation": [f"صلة {number + 1}" for number in range(count)]}})
    assert response.status_code == 200, response.text
    return response.json(), people


def lease(client, item, field):
    response = client.post(f"/api/cases/{item['id']}/field-leases", headers=auth(),
                           json={"field_key": field, "actor_label": "test"})
    assert response.status_code == 200, response.text
    return response.json()["lease_token"]


@pytest.mark.parametrize("version", ["1.4.0", "1.4.1", "1.5.0", "1.5.1"])
def test_reordering_removing_and_adding_people_preserves_identity_link(client, version):
    item, people = case(client, version)
    token = lease(client, item, "role.heir")
    url = f"/api/cases/{item['id']}/assignments/heir"
    response = client.patch(url, headers=auth(str(uuid4())),
                            json={"value": people[::-1], "lease_token": token})
    assert response.status_code == 200, response.text
    assert response.json()["fields"]["heir_relation"] == ["صلة 2", "صلة 1"]
    added = identity(client, 3)
    response = client.patch(url, headers=auth(str(uuid4())),
                            json={"value": [people[1], added], "lease_token": token})
    assert response.json()["fields"]["heir_relation"] == ["صلة 2", ""]
    response = client.patch(url, headers=auth(str(uuid4())),
                            json={"value": [], "lease_token": token})
    assert response.json()["fields"]["heir_relation"] == []


def test_concurrent_old_field_context_is_rejected_without_reassigning_a_value(client):
    item, people = case(client)
    field_token = lease(client, item, "heir_relation")
    role_token = lease(client, item, "role.heir")
    response = client.patch(f"/api/cases/{item['id']}/assignments/heir",
                            headers=auth(str(uuid4())),
                            json={"value": people[::-1], "lease_token": role_token})
    assert response.status_code == 200
    url = f"/api/cases/{item['id']}/fields/heir_relation"
    for context in [None, people]:
        response = client.patch(url, headers=auth(str(uuid4())), json={
            "value": ["تعديل 1", "تعديل 2"], "lease_token": field_token,
            "assignment_context": context})
        assert response.status_code == 409
        assert response.json()["detail"] == "CASE_ASSIGNMENT_CONTEXT_CHANGED"
    current = client.get(f"/api/cases/{item['id']}", headers=auth()).json()
    assert current["fields"]["heir_relation"] == ["صلة 2", "صلة 1"]
    key = str(uuid4())
    body = {"value": ["تعديل 2", "تعديل 1"], "lease_token": field_token,
            "assignment_context": people[::-1]}
    response = client.patch(url, headers=auth(key), json=body)
    assert response.status_code == 200, response.text
    assert client.patch(url, headers=auth(key), json=body).json() == response.json()
    altered = client.patch(url, headers=auth(key), json={**body, "assignment_context": people})
    assert altered.status_code == 409
    assert altered.json()["detail"] == "IDEMPOTENCY_CONFLICT"


def test_whole_draft_patch_remaps_omitted_fields_but_respects_explicit_replacement(client):
    item, people = case(client)
    url = f"/api/cases/{item['id']}"
    response = client.patch(url, headers=auth(str(uuid4())), json={
        "revision": item["revision"], "assignments": {"heir": people[::-1]}})
    assert response.json()["fields"]["heir_relation"] == ["صلة 2", "صلة 1"]
    response = client.patch(url, headers=auth(str(uuid4())), json={
        "revision": response.json()["revision"], "assignments": {"heir": [people[0]]},
        "fields": {"heir_relation": ["صلة جديدة"]}})
    assert response.json()["fields"]["heir_relation"] == ["صلة جديدة"]


def test_linked_fields_cannot_outnumber_people(client):
    item, people = case(client)
    response = client.patch(f"/api/cases/{item['id']}/fields/heir_relation",
                            headers=auth(str(uuid4())), json={
        "value": ["صلة 1", "صلة 2", "صلة 3"], "assignment_context": people,
        "lease_token": lease(client, item, "heir_relation")})
    assert response.status_code == 409
    assert response.json()["detail"] == "CASE_ASSIGNMENT_CONTEXT_CHANGED"


def test_twelve_people_survive_reordering_and_generate_correct_ooxml(client):
    item, people = case(client, count=12)
    response = client.patch(f"/api/cases/{item['id']}", headers=auth(str(uuid4())), json={
        "revision": item["revision"], "assignments": {"heir": people[::-1]}})
    assert response.status_code == 200
    assert response.json()["fields"]["heir_relation"] == [f"صلة {number}" for number in range(12, 0, -1)]
    reviewed = client.post(f"/api/cases/{item['id']}/final-review", headers=auth(),
                           json={"revision": response.json()["revision"]})
    assert reviewed.status_code == 200
    output = client.post(f"/api/cases/{item['id']}/generate", headers=auth(), json={
        "revision": reviewed.json()["revision"], "confirm_incomplete": True})
    assert output.status_code == 200, output.text
    with zipfile.ZipFile(io.BytesIO(output.content)) as package:
        root = etree.fromstring(package.read("word/document.xml"))
    def control(tag):
        return "".join(root.xpath(".//w:sdt[w:sdtPr/w:tag/@w:val=$tag]//w:t/text()",
                                  namespaces={"w": W}, tag=tag))
    for index, number in enumerate(range(12, 0, -1), 1):
        assert control(f"manual.heir_relation.{index}") == f"، صلة الإرث: صلة {number}"
        assert f"TEST{number}" in control(f"enotario.heir.{index}.person_ar")


def test_exact_template_versions_remain_addressable(client):
    latest = client.get("/api/document-templates", headers=auth()).json()
    assert next(item for item in latest if item["id"] == "ma.inheritance")["version"] == "1.5.1"
    for version in ["1.4.0", "1.4.1", "1.5.0", "1.5.1"]:
        response = client.get(f"/api/document-templates/ma.inheritance?version={version}", headers=auth())
        assert response.status_code == 200
        assert response.json()["version"] == version
        assert next(field for field in response.json()["fields"] if field["key"] == "heir_relation")["role"] == "heir"
    assert client.get("/api/document-templates/ma.inheritance?version=9.9.9", headers=auth()).status_code == 409
