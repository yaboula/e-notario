from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from lxml import etree

from .domain import DocumentTemplate, DocumentTemplateError, TemplateBinding, TemplateField, TemplateRole

SCHEMA_V1 = "enotario.document-template/v1"
SCHEMA_V2 = "enotario.document-template/v2"
SUPPORTED_SCHEMA_VERSIONS = {SCHEMA_V1, SCHEMA_V2}
GENERATOR_VERSION = "0.8.0-alpha.5"
MAX_DOCX_BYTES = 25 * 1024 * 1024
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
CP = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
VT = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
DC = "http://purl.org/dc/elements/1.1/"
CP_CORE = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"

FORBIDDEN_PARTS = (
    "vbaproject.bin", "activex/", "embeddings/", "comments", "people.xml",
)
STORY_PART = re.compile(r"^word/(?:document|header\d+|footer\d+)\.xml$")
TRACKED_TAGS = {f"{{{W}}}{name}" for name in ("ins", "del", "moveFrom", "moveTo")}
CNIE_FIELDS = {
    "national_id", "surname_ar", "surname_latin", "given_names_ar", "given_names_latin",
    "birth_date", "birth_place_ar", "birth_place_latin", "expiry_date", "filiation_ar",
    "filiation_latin", "address_ar", "address_latin", "sex",
}
PERSON_AR_FIELDS = {
    "national_id", "surname_ar", "given_names_ar", "birth_date", "birth_place_ar",
    "expiry_date", "filiation_ar", "address_ar", "sex",
}
LEGACY_PERSON_AR_FIELDS = PERSON_AR_FIELDS - {"expiry_date"}
LRM = "\u200e"
WORD_CLOSING_PUNCTUATION = frozenset("،؛:,.!?؟)]}»")
WORD_OPENING_PUNCTUATION = frozenset("([{«")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _parse_xml(payload: bytes) -> etree._Element:
    try:
        parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)
        root = etree.fromstring(payload, parser=parser)
    except etree.XMLSyntaxError as exc:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from exc
    if root.getroottree().docinfo.doctype:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    return root


def _legal_tokens(value: str) -> list[str]:
    # Tatweel is a visual elongation used heavily by the retained legal forms;
    # it must not make the normalized legal-text comparison report a false edit.
    normalized = value.replace("\u0640", "")
    return re.findall(r"[\w\u0600-\u06ff]+", normalized, flags=re.UNICODE)


def _expanded_bindings(raw: dict[str, Any]) -> list[dict[str, Any]]:
    bindings = list(raw.get("bindings", []))
    for pattern in raw.get("binding_patterns", []):
        first, last = pattern["indices"]
        for index in range(int(first), int(last) + 1):
            item = {key: value for key, value in pattern.items() if key != "indices"}
            item["tag"] = str(item.pop("tag_pattern")).format(index=index)
            item["index"] = index
            bindings.append(item)
    return bindings


def _expanded_field_tags(item: dict[str, Any]) -> tuple[str, ...]:
    if "tag" in item:
        return (str(item["tag"]),)
    try:
        first, last = item["indices"]
        pattern = str(item["tag_pattern"])
        return tuple(pattern.format(index=index) for index in range(int(first), int(last) + 1))
    except (KeyError, TypeError, ValueError):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from None


def _parse_manifest(folder: Path) -> DocumentTemplate:
    try:
        raw = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from exc
    if raw.get("schema_version") not in SUPPORTED_SCHEMA_VERSIONS:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    required = ("id", "version", "slug", "title_es", "title_fr", "title_ar",
                "description_es", "description_fr", "roles",
                "template_sha256", "legal_text_sha256")
    if any(key not in raw for key in required):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,127}", str(raw["id"])) \
            or not re.fullmatch(r"\d+\.\d+\.\d+", str(raw["version"])) \
            or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", str(raw["slug"])):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    if raw.get("template_file", "template.docx") != "template.docx" \
            or raw.get("legal_text_file", "legal.txt") != "legal.txt":
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    try:
        roles = tuple(TemplateRole(
            key=item["key"], label_es=item["label_es"],
            label_fr=item["label_fr"], label_ar=item["label_ar"],
            minimum=int(item["minimum"]), maximum=int(item["maximum"]),
        ) for item in raw["roles"])
    except (KeyError, TypeError, ValueError) as exc:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from exc
    if not roles or len({role.key for role in roles}) != len(roles):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    if any(not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", role.key)
           or not role.label_es or not role.label_fr or not role.label_ar or role.minimum < 0
           or role.maximum < role.minimum or role.maximum > 12 for role in roles):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    role_keys = {role.key for role in roles}
    try:
        bindings = tuple(TemplateBinding(
            tag=item["tag"], role=item["role"], index=int(item["index"]),
            sources=tuple(item["sources"]), separator=item.get("separator", " "),
            prefix=item.get("prefix", ""), suffix=item.get("suffix", ""),
            format=item.get("format", "text"), maximum_characters=int(item.get("maximum_characters", 256)),
            value_map=tuple(sorted(item.get("value_map", {}).items())),
        ) for item in _expanded_bindings(raw))
    except (KeyError, TypeError, ValueError) as exc:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from exc
    if not bindings or len({binding.tag for binding in bindings}) != len(bindings):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    role_limits = {role.key: role.maximum for role in roles}
    if any(binding.role not in role_keys or binding.index < 1
           or binding.index > role_limits.get(binding.role, 0)
           or not binding.tag.startswith(f"enotario.{binding.role}.")
           or not binding.sources or set(binding.sources) - CNIE_FIELDS
           or binding.format not in {
               "text", "date_dmy", "map", "person_ar",
               "person_ar_male_bare", "person_ar_female_bare",
           }
           or binding.maximum_characters < 1 or binding.maximum_characters > 4096
           or len(binding.prefix) > 32 or len(binding.suffix) > 32
           or (binding.format.startswith("person_ar") and set(binding.sources) not in (
               PERSON_AR_FIELDS, LEGACY_PERSON_AR_FIELDS,
           ))
           or (binding.format == "map") != bool(binding.value_map) for binding in bindings):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    fields: tuple[TemplateField, ...] = ()
    if raw["schema_version"] == SCHEMA_V2:
        try:
            fields = tuple(TemplateField(
                key=item["key"], label_fr=item["label_fr"], label_ar=item["label_ar"],
                field_type=item["type"], required=bool(item.get("required", False)),
                direction=item.get("direction", "ltr"), tags=_expanded_field_tags(item),
                maximum_characters=int(item.get("maximum_characters", 256)),
                role=item.get("role", (
                    "heir" if (raw["id"], raw["version"], item["key"]) ==
                    ("ma.inheritance", "1.4.0", "heir_relation") else None)),
            ) for item in raw["fields"])
        except (KeyError, TypeError, ValueError) as exc:
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from exc
        all_tags = [tag for item in fields for tag in item.tags]
        if not fields or len({item.key for item in fields}) != len(fields) \
                or len(all_tags) != len(set(all_tags)):
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
        if any(not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", item.key)
               or not item.label_fr or not item.label_ar
               or item.field_type not in {"text", "arabic_text", "date", "number", "amount", "professional_profile"}
               or item.direction not in {"ltr", "rtl", "auto"}
               or item.maximum_characters < 1 or item.maximum_characters > 4096
               or not item.tags or len(item.tags) > 12
               or any(not tag.startswith("manual.") for tag in item.tags)
               for item in fields):
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
        role_definitions = {role.key: role for role in roles}
        if any(item.role is not None and (
                not isinstance(item.role, str) or item.role not in role_definitions
                or len(item.tags) != role_definitions[item.role].maximum
                or len(item.tags) < 2) for item in fields):
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
        if any(definition.role and raw_field.get("indices") !=
               [1, role_definitions[definition.role].maximum]
               for definition, raw_field in zip(fields, raw["fields"])):
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    template_path = folder / raw.get("template_file", "template.docx")
    legal_text_path = folder / raw.get("legal_text_file", "legal.txt")
    return DocumentTemplate(
        schema_version=raw["schema_version"], id=raw["id"], version=raw["version"], slug=raw["slug"],
        title_es=raw["title_es"], title_fr=raw.get("title_fr", raw["title_es"]),
        title_ar=raw["title_ar"], description_es=raw["description_es"],
        description_fr=raw.get("description_fr", raw["description_es"]),
        language=raw.get("language", "ar-MA"), template_path=template_path,
        template_sha256=raw["template_sha256"], legal_text_path=legal_text_path,
        legal_text_sha256=raw["legal_text_sha256"], roles=roles, bindings=bindings, fields=fields,
    )


def _relationship_is_external(payload: bytes) -> bool:
    root = _parse_xml(payload)
    return any(item.get("TargetMode") == "External" for item in root)


def _validate_template(template: DocumentTemplate) -> bytes:
    try:
        payload = template.template_path.read_bytes()
        legal = template.legal_text_path.read_bytes()
    except OSError as exc:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from exc
    if len(payload) > MAX_DOCX_BYTES or _sha256(payload) != template.template_sha256:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INTEGRITY_FAILED")
    if _sha256(legal) != template.legal_text_sha256:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INTEGRITY_FAILED")
    expected = {binding.tag for binding in template.bindings}
    expected_manual = {tag for field in template.fields for tag in field.tags}
    found: list[str] = []
    found_manual: list[str] = []
    document_text = ""
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as package:
            names = package.namelist()
            if len(names) != len(set(names)):
                raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
            lowered = [name.lower() for name in names]
            if any(".." in Path(name).parts or name.startswith(("/", "\\")) for name in names):
                raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
            if any(any(marker in name for marker in FORBIDDEN_PARTS) for name in lowered):
                raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
            if sum(info.file_size for info in package.infolist()) > MAX_DOCX_BYTES * 4:
                raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
            content_types = package.read("[Content_Types].xml").lower()
            if b"macroenabled" in content_types:
                raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
            for name in names:
                if name.endswith(".rels") and _relationship_is_external(package.read(name)):
                    raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
                if not STORY_PART.match(name):
                    continue
                root = _parse_xml(package.read(name))
                if name == "word/document.xml":
                    document_text = " ".join(root.xpath(".//w:t/text()", namespaces={"w": W}))
                if any(node.tag in TRACKED_TAGS for node in root.iter()):
                    raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
                for control in root.xpath(".//w:sdt", namespaces={"w": W}):
                    tags = control.xpath("./w:sdtPr/w:tag/@w:val", namespaces={"w": W})
                    if len(tags) != 1:
                        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
                    tag = tags[0]
                    if not (tag.startswith("manual.") or tag in expected):
                        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
                    if tag in expected:
                        found.append(tag)
                    elif template.schema_version == SCHEMA_V2:
                        if tag not in expected_manual:
                            raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
                        found_manual.append(tag)
    except (zipfile.BadZipFile, KeyError, etree.XMLSyntaxError) as exc:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from exc
    if len(found) != len(expected) or set(found) != expected:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    if template.schema_version == SCHEMA_V2 \
            and (len(found_manual) != len(expected_manual) or set(found_manual) != expected_manual):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    try:
        legal_tokens = _legal_tokens(legal.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID") from exc
    template_tokens = iter(_legal_tokens(document_text))
    if not legal_tokens or not all(any(candidate == token for candidate in template_tokens)
                                   for token in legal_tokens):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_LEGAL_TEXT_MISMATCH")
    return payload


def _identity_text(identity: dict[str, Any], source: str, *, separator: str = " ") -> str:
    value = identity.get(source)
    if isinstance(value, list):
        parts = [" ".join(str(item).split()) for item in value if str(item).strip()]
        text = separator.join(parts)
    else:
        text = " ".join(str(value).split()) if value is not None else ""
    if not text:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_BINDING_MISSING")
    return text


def _arabic_date(value: str) -> str:
    try:
        rendered = datetime.strptime(value, "%Y-%m-%d").strftime("%Y/%m/%d")
        return f"{LRM}{rendered}{LRM}"
    except ValueError as exc:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_BINDING_MISSING") from exc


def _person_ar(identity: dict[str, Any], *, expected_sex: str | None = None,
               include_title: bool = True, include_expiry: bool = True) -> str:
    # In role-specific clauses (husband, wife, wife_father), grammar belongs to
    # the legal role rather than to the identity selected for it.  Cross-role
    # reuse is intentionally allowed with a visible warning, so rejecting a
    # temporary assignment because its CNIE sex differs from the role would
    # contradict that contract and make single-identity test generations fail.
    if expected_sex is None:
        sex = _identity_text(identity, "sex").upper()
        if sex not in {"M", "F"}:
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_BINDING_MISSING")
    else:
        sex = expected_sex
    given_names = _identity_text(identity, "given_names_ar")
    surname = _identity_text(identity, "surname_ar")
    filiation = _identity_text(identity, "filiation_ar", separator=" ")
    birth_place = _identity_text(identity, "birth_place_ar")
    national_id = _identity_text(identity, "national_id")
    address = _identity_text(identity, "address_ar", separator="، ")
    birth_date = _arabic_date(_identity_text(identity, "birth_date"))
    expiry_clause = ""
    if include_expiry:
        expiry_date = _arabic_date(_identity_text(identity, "expiry_date"))
        expiry_clause = f"الصالحة إلى غاية {expiry_date}، "

    if sex == "M":
        title, child, born, holder, resident = (
            "السيد ", "ابن", "المزداد", "الحامل", "والساكن",
        )
    else:
        title, child, born, holder, resident = (
            "السيدة ", "بنت", "المزدادة", "الحاملة", "والساكنة",
        )
    # Older CNIE OCR returns the relationship word as part of the complete
    # filiation. Keep exactly one role-appropriate prefix in the legal phrase.
    filiation = re.sub(rf"^{re.escape(child)}\s+", "", filiation, count=1)
    return (
        f"{title if include_title else ''}{given_names} {surname}، "
        f"{child} {filiation}، {born} بتاريخ {birth_date} بمدينة {birth_place}، "
        f"{holder} للبطاقة الوطنية للتعريف رقم {national_id}، "
        f"{expiry_clause}"
        f"{resident} بـ{address}"
    )


def _format_value(binding: TemplateBinding, identity: dict[str, Any]) -> str:
    if binding.format in {"person_ar", "person_ar_male_bare", "person_ar_female_bare"}:
        expected_sex = {
            "person_ar_male_bare": "M",
            "person_ar_female_bare": "F",
        }.get(binding.format)
        value = _person_ar(
            identity,
            expected_sex=expected_sex,
            include_title=binding.format == "person_ar",
            include_expiry="expiry_date" in binding.sources,
        )
        value = f"{binding.prefix}{value}{binding.suffix}"
        if len(value) > binding.maximum_characters:
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_VALUE_TOO_LONG")
        return value

    values: list[str] = []
    for source in binding.sources:
        value = identity.get(source)
        if isinstance(value, list):
            value = "\n".join(str(item).strip() for item in value if str(item).strip())
        text = "" if value is None else str(value).strip()
        if text:
            values.append(text)
    if not values:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_BINDING_MISSING")
    value = binding.separator.join(values)
    if binding.format == "date_dmy":
        value = _arabic_date(value)
    elif binding.format == "map":
        mapped = dict(binding.value_map).get(value)
        if mapped is None:
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_BINDING_MISSING")
        value = mapped
    elif binding.format != "text":
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    value = f"{binding.prefix}{value}{binding.suffix}"
    if len(value.replace(LRM, "")) > binding.maximum_characters:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_VALUE_TOO_LONG")
    return value


def _inline_text(node: etree._Element | None) -> str:
    return "" if node is None else "".join(node.xpath(".//w:t/text()", namespaces={"w": W}))


def _separate_inline_value(control: etree._Element, value: str) -> str:
    """Keep populated controls separated from adjacent Word runs."""
    if not value:
        return value
    previous = _inline_text(control.getprevious())
    following = _inline_text(control.getnext())
    if previous and not previous[-1].isspace() and not value[0].isspace() \
            and value[0] not in WORD_CLOSING_PUNCTUATION \
            and previous[-1] not in WORD_OPENING_PUNCTUATION:
        value = " " + value
    if following and not value[-1].isspace() and not following[0].isspace() \
            and following[0] not in WORD_CLOSING_PUNCTUATION \
            and value[-1] not in WORD_OPENING_PUNCTUATION:
        value += " "
    return value


def _replace_control(control: etree._Element, value: str) -> None:
    contents = control.xpath("./w:sdtContent", namespaces={"w": W})
    if len(contents) != 1:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    content = contents[0]
    runs = content.xpath(".//w:r", namespaces={"w": W})
    if not runs:
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
    first = runs[0]
    rpr = first.find(f"{{{W}}}rPr")
    for child in list(content):
        content.remove(child)
    run = etree.SubElement(content, f"{{{W}}}r")
    if rpr is not None:
        run.append(deepcopy(rpr))
    lines = _separate_inline_value(control, value).splitlines() or [""]
    for index, line in enumerate(lines):
        if index:
            etree.SubElement(run, f"{{{W}}}br")
        text = etree.SubElement(run, f"{{{W}}}t")
        text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        text.text = line


def _custom_properties(template: DocumentTemplate) -> bytes:
    root = etree.Element(f"{{{CP}}}Properties", nsmap={None: CP, "vt": VT})
    for pid, (name, value) in enumerate((
        ("eNotarioTemplate", f"{template.id}@{template.version}"),
        ("eNotarioGenerator", GENERATOR_VERSION),
    ), start=2):
        prop = etree.SubElement(root, f"{{{CP}}}property", pid=str(pid), name=name,
                                fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}")
        etree.SubElement(prop, f"{{{VT}}}lpwstr").text = value
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _patch_package_metadata(parts: dict[str, bytes], template: DocumentTemplate) -> None:
    core_name = "docProps/core.xml"
    if core_name in parts:
        root = _parse_xml(parts[core_name])
        for name in ("creator", "lastModifiedBy"):
            nodes = root.xpath(f"./dc:{name}" if name == "creator" else "./cp:lastModifiedBy",
                               namespaces={"dc": DC, "cp": CP_CORE})
            for node in nodes:
                node.text = ""
        parts[core_name] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    parts["docProps/custom.xml"] = _custom_properties(template)
    types = _parse_xml(parts["[Content_Types].xml"])
    if not types.xpath("./ct:Override[@PartName='/docProps/custom.xml']", namespaces={"ct": CT}):
        etree.SubElement(types, f"{{{CT}}}Override", PartName="/docProps/custom.xml",
                         ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml")
    parts["[Content_Types].xml"] = etree.tostring(types, xml_declaration=True, encoding="UTF-8", standalone=True)
    relationships = _parse_xml(parts["_rels/.rels"])
    custom_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties"
    if not relationships.xpath("./r:Relationship[@Type=$kind]", namespaces={"r": PKG_REL}, kind=custom_type):
        used = {item.get("Id") for item in relationships}
        number = 1
        while f"rId{number}" in used:
            number += 1
        etree.SubElement(relationships, f"{{{PKG_REL}}}Relationship", Id=f"rId{number}",
                         Type=custom_type, Target="docProps/custom.xml")
    parts["_rels/.rels"] = etree.tostring(relationships, xml_declaration=True, encoding="UTF-8", standalone=True)


def _manual_replacements(template: DocumentTemplate,
                         fields: dict[str, str | list[str] | None]) -> dict[str, str]:
    declared = {field.key: field for field in template.fields}
    if set(fields) - set(declared):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_FIELD_INVALID")
    replacements: dict[str, str] = {}
    for field in template.fields:
        raw = fields.get(field.key)
        values = raw if isinstance(raw, list) else [raw]
        if len(values) > len(field.tags):
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_FIELD_INVALID")
        for index, tag in enumerate(field.tags):
            value = values[index] if index < len(values) else None
            text = "" if value is None else str(value).strip()
            if field.field_type == "date" and text:
                try:
                    rendered = datetime.strptime(text, "%Y-%m-%d").strftime("%Y/%m/%d")
                    text = f"{LRM}{rendered}{LRM}"
                except ValueError as exc:
                    raise DocumentTemplateError("DOCUMENT_TEMPLATE_FIELD_INVALID") from exc
            elif field.field_type == "number" and text and not re.fullmatch(r"[0-9]+(?:[/.-][0-9]+)*", text):
                raise DocumentTemplateError("DOCUMENT_TEMPLATE_FIELD_INVALID")
            if len(text.replace(LRM, "")) > field.maximum_characters:
                raise DocumentTemplateError("DOCUMENT_TEMPLATE_VALUE_TOO_LONG")
            if field.key == "heir_relation" and text:
                text = f"، صلة الإرث: {text}"
            replacements[tag] = text
    return replacements


def render_template(template: DocumentTemplate, assignments: dict[str, list[dict[str, Any]]],
                    fields: dict[str, str | list[str] | None] | None = None) -> bytes:
    roles = {role.key: role for role in template.roles}
    if set(assignments) - set(roles):
        raise DocumentTemplateError("DOCUMENT_TEMPLATE_ROLE_INVALID")
    for role in template.roles:
        count = len(assignments.get(role.key, []))
        if count < role.minimum or count > role.maximum:
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_ROLE_INVALID")
    # Every declared control is materialized. Unassigned repeatable/optional slots
    # remain as empty, editable controls instead of leaking template placeholder text.
    replacements: dict[str, str] = {binding.tag: "" for binding in template.bindings}
    for binding in template.bindings:
        identities = assignments.get(binding.role, [])
        if binding.index <= len(identities):
            replacements[binding.tag] = _format_value(binding, identities[binding.index - 1])
    if fields is not None:
        if template.schema_version != SCHEMA_V2:
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_FIELD_INVALID")
        if any(field.role and isinstance(fields.get(field.key), list) and
               len(fields[field.key]) > len(assignments.get(field.role, []))
               for field in template.fields):
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_FIELD_INVALID")
        replacements.update(_manual_replacements(template, fields))
    payload = _validate_template(template)
    with zipfile.ZipFile(io.BytesIO(payload)) as source:
        parts = {name: source.read(name) for name in source.namelist()}
    for name, value in list(parts.items()):
        if not STORY_PART.match(name):
            continue
        root = _parse_xml(value)
        changed = False
        for control in root.xpath(".//w:sdt", namespaces={"w": W}):
            tags = control.xpath("./w:sdtPr/w:tag/@w:val", namespaces={"w": W})
            if tags and tags[0] in replacements:
                _replace_control(control, replacements[tags[0]])
                changed = True
        if changed:
            parts[name] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    _patch_package_metadata(parts, template)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for name, value in parts.items():
            target.writestr(name, value)
    result = output.getvalue()
    if len(result) > MAX_DOCX_BYTES:
        raise DocumentTemplateError("DOCUMENT_GENERATION_FAILED")
    return result


class DocumentTemplateCatalog:
    def __init__(self, root: Path | None = None):
        root = root or Path(__file__).with_name("templates")
        templates = [_parse_manifest(folder) for folder in sorted(root.iterdir()) if folder.is_dir()]
        if not templates or len({(template.id, template.version) for template in templates}) != len(templates):
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_INVALID")
        for template in templates:
            _validate_template(template)
        self._versions = {(template.id, template.version): template for template in templates}
        self._templates: dict[str, DocumentTemplate] = {}
        for template in templates:
            previous = self._templates.get(template.id)
            if previous is None or tuple(map(int, template.version.split("."))) > \
                    tuple(map(int, previous.version.split("."))):
                self._templates[template.id] = template

    def summaries(self) -> list[dict[str, Any]]:
        return [template.to_summary() for template in self._templates.values()]

    def get(self, template_id: str, version: str | None = None) -> DocumentTemplate:
        template = self._templates.get(template_id)
        if template is None:
            raise DocumentTemplateError("DOCUMENT_TEMPLATE_NOT_FOUND")
        if version is not None:
            template = self._versions.get((template_id, version))
            if template is None:
                raise DocumentTemplateError("DOCUMENT_TEMPLATE_VERSION_MISMATCH")
        return template

    def render(self, template_id: str, version: str,
               assignments: dict[str, list[dict[str, Any]]],
               fields: dict[str, str | list[str] | None] | None = None) -> tuple[bytes, str]:
        template = self.get(template_id, version)
        return render_template(template, assignments, fields), template.slug
