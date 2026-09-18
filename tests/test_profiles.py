from __future__ import annotations

import pytest

from cnie_profiles import ProfessionalProfile, ProfileError, ProtectedProfileStore


class FakeProtector:
    prefix = b"protected-profile:"

    def protect(self, value: bytes) -> bytes:
        return self.prefix + value[::-1]

    def unprotect(self, value: bytes) -> bytes:
        if not value.startswith(self.prefix):
            raise ValueError
        return value[len(self.prefix):][::-1]


class FailingProtector(FakeProtector):
    def __init__(self):
        self.fail_next_write = False

    def protect(self, value: bytes) -> bytes:
        if self.fail_next_write:
            self.fail_next_write = False
            raise OSError("synthetic storage failure")
        return super().protect(value)


def test_profile_catalog_is_encrypted_persistent_and_optimistic(tmp_path):
    path = tmp_path / "profiles.dpapi"
    store = ProtectedProfileStore(path, FakeProtector())
    profile = store.create(ProfessionalProfile.create(
        display_name_ar="العدل التجريبي", display_name_fr="Adoul de test",
        function_fr="Adoul",
    ))
    assert b"Adoul de test" not in path.read_bytes()
    assert "العدل التجريبي".encode() not in path.read_bytes()

    restored = ProtectedProfileStore(path, FakeProtector()).get(profile.id)
    assert restored is not None and restored.display_name_ar == "العدل التجريبي"
    restored.active = False
    updated = store.save(restored, expected_revision=0)
    assert updated.revision == 1 and not updated.active
    with pytest.raises(ProfileError, match="PROFILE_STALE_REVISION"):
        store.save(restored, expected_revision=0)
    assert store.delete(profile.id) is True


def test_profile_requires_an_arabic_display_value():
    with pytest.raises(ProfileError, match="PROFILE_INVALID"):
        ProfessionalProfile.create(display_name_ar=" ", display_name_fr="Name", function_fr="Adoul")


def test_profile_create_rolls_back_memory_when_persistence_fails(tmp_path):
    protector = FailingProtector()
    path = tmp_path / "profiles.dpapi"
    store = ProtectedProfileStore(path, protector)
    protector.fail_next_write = True

    with pytest.raises(ProfileError, match="PROFILE_STORAGE_WRITE_FAILED"):
        store.create(ProfessionalProfile.create(
            display_name_ar="عدل مؤقت", display_name_fr="Temporaire", function_fr="Adoul",
        ))

    assert store.list() == []
    assert not path.exists()
    assert list(tmp_path.glob("*.tmp")) == []


def test_profile_save_and_delete_roll_back_memory_and_disk(tmp_path):
    protector = FailingProtector()
    path = tmp_path / "profiles.dpapi"
    store = ProtectedProfileStore(path, protector)
    profile = store.create(ProfessionalProfile.create(
        display_name_ar="العدل الثابت", display_name_fr="Stable", function_fr="Adoul",
    ))
    original_disk = path.read_bytes()

    edited = store.get(profile.id)
    assert edited is not None
    edited.display_name_fr = "Modification perdue"
    protector.fail_next_write = True
    with pytest.raises(ProfileError, match="PROFILE_STORAGE_WRITE_FAILED"):
        store.save(edited, expected_revision=profile.revision)
    assert store.get(profile.id).display_name_fr == "Stable"  # type: ignore[union-attr]
    assert path.read_bytes() == original_disk

    protector.fail_next_write = True
    with pytest.raises(ProfileError, match="PROFILE_STORAGE_WRITE_FAILED"):
        store.delete(profile.id)
    assert store.get(profile.id) is not None
    assert path.read_bytes() == original_disk
    assert list(tmp_path.glob("*.tmp")) == []


def test_profile_atomic_replace_failure_removes_temporary_file_and_rolls_back(
        tmp_path, monkeypatch):
    path = tmp_path / "profiles.dpapi"
    store = ProtectedProfileStore(path, FakeProtector())

    def fail_replace(_source, _target):
        raise OSError("synthetic replace failure")

    monkeypatch.setattr("cnie_profiles.store.os.replace", fail_replace)
    with pytest.raises(ProfileError, match="PROFILE_STORAGE_WRITE_FAILED"):
        store.create(ProfessionalProfile.create(
            display_name_ar="عدل غير محفوظ", display_name_fr="Non enregistré",
            function_fr="Adoul",
        ))

    assert store.list() == []
    assert not path.exists()
    assert list(tmp_path.glob("*.tmp")) == []
