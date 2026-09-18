from __future__ import annotations

import sqlite3

import pytest

from cnie_cases import (CaseDraft, CaseError, EncryptedSqliteCaseStore,
                        FieldLeaseError, FieldLeaseManager, InMemoryCaseStore)


class FakeProtector:
    prefix = b"test-protected:"

    def protect(self, value: bytes) -> bytes:
        return self.prefix + value[::-1]

    def unprotect(self, value: bytes) -> bytes:
        if not value.startswith(self.prefix):
            raise ValueError("invalid protected key")
        return value[len(self.prefix):][::-1]


def draft(owner="desktop"):
    return CaseDraft.create(owner=owner, template_id="ma.marriage",
                            template_version="1.6.0", mode="complete")


@pytest.mark.parametrize("factory", [InMemoryCaseStore])
def test_case_store_revision_retention_and_clear(factory):
    store = factory()
    item = store.create(draft())
    item.fields = {"manual.registry_number": "42"}
    saved = store.save(item, expected_revision=0)
    assert saved.revision == 1
    assert store.get(item.id).fields == {"manual.registry_number": "42"}

    with pytest.raises(CaseError, match="CASE_STALE_REVISION"):
        store.save(item, expected_revision=0)

    saved.expires = 1
    store.items[saved.id] = saved
    assert store.prune(now=2) == 1
    assert store.get(saved.id) is None
    store.create(draft())
    assert store.clear() == 1


def test_sqlite_store_encrypts_payload_and_survives_restart(tmp_path):
    path = tmp_path / "temporary-cases.sqlite3"
    first = EncryptedSqliteCaseStore(path, FakeProtector())
    item = draft("mobile-secret-token")
    item.fields = {
        "manual.deceased": "اسم اصطناعي للاختبار",
        "manual.registry_number": "REG-PRIVATE-123",
    }
    first.create(item)

    raw_database = path.read_bytes()
    assert b"REG-PRIVATE-123" not in raw_database
    assert "اسم اصطناعي للاختبار".encode() not in raw_database
    assert b"mobile-secret-token" not in raw_database

    second = EncryptedSqliteCaseStore(path, FakeProtector())
    restored = second.get(item.id)
    assert restored is not None
    assert restored.fields == item.fields
    restored.assignments = {"husband": ["identity-1"]}
    updated = second.save(restored, expected_revision=0)
    assert updated.revision == 1

    connection = sqlite3.connect(path)
    wrapped_key = connection.execute(
        "SELECT wrapped_key FROM case_drafts WHERE id = ?", (item.id,)
    ).fetchone()[0]
    connection.close()
    assert bytes(wrapped_key).startswith(FakeProtector.prefix)
    assert second.delete(item.id) is True
    assert second.get(item.id) is None


def test_sqlite_store_rejects_tampering(tmp_path):
    path = tmp_path / "temporary-cases.sqlite3"
    store = EncryptedSqliteCaseStore(path, FakeProtector())
    item = store.create(draft())
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE case_drafts SET ciphertext = ? WHERE id = ?", (b"tampered", item.id))
    with pytest.raises(CaseError, match="CASE_STORAGE_DECRYPT_FAILED"):
        store.get(item.id)


def test_case_fields_are_bounded_and_validated():
    item = draft()
    item.fields = {"not a key": "value"}
    store = InMemoryCaseStore()
    with pytest.raises(CaseError, match="CASE_FIELD_INVALID"):
        store.create(item)


def test_field_leases_exclude_other_actors_and_expire():
    leases = FieldLeaseManager(lease_seconds=45)
    first = leases.acquire(case_id="case-1", field_key="registry_number",
                           identity="mobile-1", actor_label="Sara · téléphone", now=100)
    renewed = leases.acquire(case_id="case-1", field_key="registry_number",
                             identity="mobile-1", actor_label="Sara · téléphone",
                             token=first.token, now=110)
    assert renewed.token == first.token
    assert renewed.expires == 155
    with pytest.raises(FieldLeaseError, match="CASE_FIELD_LOCKED"):
        leases.acquire(case_id="case-1", field_key="registry_number",
                       identity="desktop", actor_label="Poste Windows", now=120)
    assert leases.prune(now=156) == 1
    desktop = leases.acquire(case_id="case-1", field_key="registry_number",
                             identity="desktop", actor_label="Poste Windows", now=156)
    assert desktop.identity == "desktop"
