from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


class DocumentTemplateError(ValueError):
    """A safe, public failure raised by the document-template engine."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class TemplateRole:
    key: str
    label_es: str
    label_fr: str
    label_ar: str
    minimum: int
    maximum: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label_es": self.label_es,
            "label_fr": self.label_fr,
            "label_ar": self.label_ar,
            "minimum": self.minimum,
            "maximum": self.maximum,
            "repeatable": self.maximum > 1,
        }


@dataclass(frozen=True, slots=True)
class TemplateBinding:
    tag: str
    role: str
    index: int
    sources: tuple[str, ...]
    separator: str = " "
    prefix: str = ""
    suffix: str = ""
    format: str = "text"
    maximum_characters: int = 256
    value_map: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class TemplateField:
    key: str
    label_fr: str
    label_ar: str
    field_type: str
    required: bool
    direction: str
    tags: tuple[str, ...]
    maximum_characters: int = 256
    role: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label_fr": self.label_fr,
            "label_ar": self.label_ar,
            "type": self.field_type,
            "required": self.required,
            "direction": self.direction,
            "repeatable": len(self.tags) > 1,
            "maximum_items": len(self.tags),
            "maximum_characters": self.maximum_characters,
            "role": self.role,
        }


@dataclass(frozen=True, slots=True)
class DocumentTemplate:
    schema_version: str
    id: str
    version: str
    slug: str
    title_es: str
    title_fr: str
    title_ar: str
    description_es: str
    description_fr: str
    language: str
    template_path: Path
    template_sha256: str
    legal_text_path: Path
    legal_text_sha256: str
    roles: tuple[TemplateRole, ...]
    bindings: tuple[TemplateBinding, ...]
    fields: tuple[TemplateField, ...] = ()

    def to_summary(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "id": self.id,
            "version": self.version,
            "slug": self.slug,
            "title_es": self.title_es,
            "title_fr": self.title_fr,
            "title_ar": self.title_ar,
            "description_es": self.description_es,
            "description_fr": self.description_fr,
            "language": self.language,
            "roles": [role.to_dict() for role in self.roles],
            "fields": [field.to_dict() for field in self.fields],
        }
