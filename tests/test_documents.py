from __future__ import annotations

import hashlib
import io
import json
import shutil
import uuid
import zipfile
from pathlib import Path

import pytest
from lxml import etree

from cnie_documents import DocumentTemplateCatalog, DocumentTemplateError
from cnie_documents.catalog import _format_value
from cnie_documents.domain import TemplateBinding

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
EXACT_MARRIAGE_VERSE = (
    "وَمِنْ ءَايَـٰتِهِۦٓ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَٰجًۭا لِّتَسْكُنُوٓا۟ "
    "إِلَيْهَا وَجَعَلَ بَيْنَكُم مَّوَدَّةًۭ وَرَحْمَةً ۚ إِنَّ فِى ذَٰلِكَ "
    "لَـَٔايَـٰتٍۢ لِّقَوْمٍۢ يَتَفَكَّرُونَ"
)


def identity(number: int) -> dict:
    return {
        "national_id": f"AA{number:06d}",
        "given_names_ar": f"محمد {number}",
        "surname_ar": "الاختبار",
        "given_names_latin": f"MOHAMED {number}",
        "surname_latin": "SPECIMEN",
        "birth_date": "1990-01-02",
        "birth_place_ar": "الرباط",
        "birth_place_latin": "RABAT",
        "expiry_date": "2030-01-02",
        "sex": "M",
        "filiation_ar": ["الأب والأم"],
        "filiation_latin": ["PARENT ONE", "PARENT TWO"],
        "address_ar": ["السطر الأول", "السطر الثاني"],
        "address_latin": ["LINE ONE", "LINE TWO"],
    }


def document_xml(payload: bytes) -> etree._Element:
    with zipfile.ZipFile(io.BytesIO(payload)) as package:
        return etree.fromstring(package.read("word/document.xml"))


def control_text(root: etree._Element, tag: str) -> str:
    controls = root.xpath(".//w:sdt[w:sdtPr/w:tag/@w:val=$tag]", namespaces={"w": W}, tag=tag)
    assert len(controls) == 1
    return "".join(controls[0].xpath(".//w:t/text()", namespaces={"w": W}))


def test_catalog_roles_hashes_and_hidden_controls():
    catalog = DocumentTemplateCatalog()
    summaries = {item["id"]: item for item in catalog.summaries()}
    assert summaries["ma.marriage"]["roles"][0]["maximum"] == 1
    assert [role["key"] for role in summaries["ma.marriage"]["roles"]] == [
        "husband", "wife", "wife_father",
    ]
    assert summaries["ma.inheritance"]["roles"][1]["maximum"] == 12
    assert all(role["minimum"] == 0 for summary in summaries.values() for role in summary["roles"])
    assert summaries["ma.marriage"]["schema_version"] == "enotario.document-template/v2"
    assert summaries["ma.marriage"]["title_fr"] == "Acte de mariage"
    assert {field["key"] for field in summaries["ma.marriage"]["fields"]} >= {
        "registry_number", "registry_date", "notary_1", "case_number", "dowry",
    }
    relation = next(field for field in summaries["ma.inheritance"]["fields"]
                    if field["key"] == "heir_relation")
    assert relation["repeatable"] is True and relation["maximum_items"] == 12
    assert relation["role"] == "heir"
    assert summaries["ma.marriage"]["version"] == "1.7.0"
    assert summaries["ma.inheritance"]["version"] == "1.5.1"
    for template_id in summaries:
        template = catalog.get(template_id)
        assert hashlib.sha256(template.template_path.read_bytes()).hexdigest() == template.template_sha256
        artwork = "marriage" if template_id == "ma.marriage" else "inheritance"
        assets = Path(__file__).resolve().parents[1] / "src" / "cnie_documents" / "assets"
        with zipfile.ZipFile(template.template_path) as package:
            media = [package.read(name) for name in package.namelist()
                     if name.startswith("word/media/")]
            first_name = f"background-{artwork}-first"
            if artwork == "marriage":
                first_name += "-v2"
            assert (assets / f"{first_name}.png").read_bytes() in media
            assert (assets / f"background-{artwork}-continuation.png").read_bytes() in media
        root = document_xml(template.template_path.read_bytes())
        automatic = root.xpath(".//w:sdt[starts-with(w:sdtPr/w:tag/@w:val, 'enotario.') ]",
                               namespaces={"w": W})
        assert automatic
        assert all(control.xpath("./w:sdtPr/w15:appearance/@w15:val", namespaces={"w": W, "w15": W15}) == ["hidden"]
                   for control in automatic)
        visible_defaults = {
            "".join(control.xpath("./w:sdtPr/w:tag/@w:val", namespaces={"w": W})):
            "".join(control.xpath(".//w:t/text()", namespaces={"w": W})).strip()
            for control in automatic
        }
        assert all(not value or tag == "enotario.applicant.1.person_ar"
                   for tag, value in visible_defaults.items())


@pytest.mark.parametrize("template_id,artwork", [
    ("ma.marriage", "marriage"), ("ma.inheritance", "inheritance"),
])
def test_p1_is_first_page_and_p2_only_continuation(template_id: str, artwork: str):
    template = DocumentTemplateCatalog().get(template_id)
    assets = Path(__file__).resolve().parents[1] / "src" / "cnie_documents" / "assets"
    with zipfile.ZipFile(template.template_path) as package:
        root = etree.fromstring(package.read("word/document.xml"))
        section = root.xpath("./w:body/w:sectPr", namespaces={"w": W})[0]
        assert section.xpath("./w:titlePg", namespaces={"w": W})
        references = {
            item.get(f"{{{W}}}type"): item.get(f"{{{R}}}id")
            for item in section.xpath("./w:headerReference", namespaces={"w": W})
        }
        relationships = etree.fromstring(package.read("word/_rels/document.xml.rels"))
        targets = {item.get("Id"): item.get("Target") for item in relationships}
        first_name = f"background-{artwork}-first"
        if artwork == "marriage":
            first_name += "-v2"
        continuation_name = f"background-{artwork}-continuation"
        for page_type, expected_name, other_name in (
            ("first", first_name, continuation_name),
            ("default", continuation_name, first_name),
        ):
            header_name = targets[references[page_type]]
            header_rels = etree.fromstring(package.read(f"word/_rels/{header_name}.rels"))
            image_parts = [package.read(f"word/{item.get('Target')}")
                           for item in header_rels if item.get("Target", "").startswith("media/")]
            expected = (assets / f"{expected_name}.png").read_bytes()
            other = (assets / f"{other_name}.png").read_bytes()
            assert expected in image_parts
            assert other not in image_parts


def test_marriage_verse_is_exact_native_word_text_not_rasterized():
    template = DocumentTemplateCatalog().get("ma.marriage")
    assert template.legal_text_path.read_text(encoding="utf-8").splitlines()[0] == EXACT_MARRIAGE_VERSE
    with zipfile.ZipFile(template.template_path) as package:
        first_header = etree.fromstring(package.read("word/header1.xml"))
        assert "".join(first_header.xpath(".//w:t/text()", namespaces={"w": W})) == EXACT_MARRIAGE_VERSE
        verse_runs = first_header.xpath(".//w:r[w:t]", namespaces={"w": W})
        assert len(verse_runs) == 1
        assert verse_runs[0].xpath("./w:rPr/w:rFonts/@w:cs", namespaces={"w": W}) == ["Amiri Quran"]
        root = etree.fromstring(package.read("word/document.xml"))
        assert EXACT_MARRIAGE_VERSE in "".join(root.xpath(".//w:t/text()", namespaces={"w": W}))


def test_marriage_embeds_exact_openly_licensed_quran_font():
    template = DocumentTemplateCatalog().get("ma.marriage")
    font_path = Path(__file__).resolve().parents[1] / "src" / "cnie_documents" / "assets" / "fonts" / "AmiriQuran-1.003.ttf"
    with zipfile.ZipFile(template.template_path) as package:
        table = etree.fromstring(package.read("word/fontTable.xml"))
        entries = table.xpath("./w:font[@w:name='Amiri Quran']/w:embedRegular", namespaces={"w": W})
        assert len(entries) == 1
        key = uuid.UUID(entries[0].get(f"{{{W}}}fontKey").strip("{}"))
        relationship_id = entries[0].get(f"{{{R}}}id")
        relationships = etree.fromstring(package.read("word/_rels/fontTable.xml.rels"))
        font_rels = [entry for entry in relationships if entry.get("Id") == relationship_id]
        assert len(font_rels) == 1
        assert font_rels[0].get("Target") == "fonts/AmiriQuran.odttf"
        encoded = bytearray(package.read("word/fonts/AmiriQuran.odttf"))
        reversed_key = key.bytes[::-1]
        for index in range(32):
            encoded[index] ^= reversed_key[index % 16]
        assert bytes(encoded) == font_path.read_bytes()
        assert hashlib.sha256(encoded).hexdigest() == "e2a47644762d16bdfb6d33e0d8db8c6ff30beae84150ef5a705316bbd829455c"


def test_marriage_render_preserves_original_flow_manual_controls_and_scrubs_metadata():
    catalog = DocumentTemplateCatalog()
    template = catalog.get("ma.marriage")
    source_names: set[str]
    with zipfile.ZipFile(template.template_path) as package:
        source_names = set(package.namelist())
        source_styles = package.read("word/styles.xml")
    wife = identity(2)
    wife["sex"] = "F"
    payload, slug = catalog.render("ma.marriage", "1.7.0", {
        "husband": [identity(1)], "wife": [wife], "wife_father": [identity(3)],
    })
    assert slug == "matrimonio"
    root = document_xml(payload)
    assert control_text(root, "enotario.husband.1.person_ar").replace("\u200e", "") == (
        "محمد 1 الاختبار، ابن الأب والأم، المزداد بتاريخ 1990/01/02 بمدينة الرباط، "
        "الحامل للبطاقة الوطنية للتعريف رقم AA000001، الصالحة إلى غاية 2030/01/02، "
        "والساكن بـالسطر الأول، السطر الثاني"
    )
    assert control_text(root, "enotario.wife.1.person_ar").replace("\u200e", "").startswith(
        "محمد 2 الاختبار، بنت الأب والأم، المزدادة بتاريخ 1990/01/02"
    )
    assert "AA000003" in control_text(root, "enotario.wife_father.1.person_ar")
    assert control_text(root, "manual.dowry") == "................"
    # p1 owns the artwork; no duplicate Word header/title drawing is printed.
    assert len(root.xpath(".//w:tbl", namespaces={"w": W})) == 0
    assert root.xpath("count(.//w:drawing)", namespaces={"w": W}) == 0
    with zipfile.ZipFile(io.BytesIO(payload)) as package:
        names = set(package.namelist())
        media = [package.read(name) for name in names if name.startswith("word/media/")]
        assets = Path(__file__).resolve().parents[1] / "src" / "cnie_documents" / "assets"
        assert (assets / "background-marriage-first-v2.png").read_bytes() in media
        assert (assets / "background-marriage-continuation.png").read_bytes() in media
        assert source_names <= names
        assert package.read("word/styles.xml") == source_styles
        assert not any(marker in name.lower() for name in names
                       for marker in ("vbaproject.bin", "activex/", "embeddings/", "comments.xml"))
        for name in names:
            if name.endswith(".rels"):
                relationships = etree.fromstring(package.read(name))
                assert all(item.get("TargetMode") != "External" for item in relationships)
        core = package.read("docProps/core.xml")
        assert b"python-docx" not in core
        custom = package.read("docProps/custom.xml")
        assert b"ma.marriage@1.7.0" in custom and b"0.8.0-alpha.5" in custom


def test_marriage_allows_one_identity_in_different_roles_using_role_grammar():
    catalog = DocumentTemplateCatalog()
    selected = identity(9)
    selected["given_names_ar"] = "خولة"
    selected["sex"] = "F"

    payload, _ = catalog.render("ma.marriage", "1.7.0", {
        "husband": [selected], "wife": [selected], "wife_father": [selected],
    })

    root = document_xml(payload)
    assert "المزداد بتاريخ" in control_text(root, "enotario.husband.1.person_ar")
    assert "المزدادة بتاريخ" in control_text(root, "enotario.wife.1.person_ar")
    assert "المزداد بتاريخ" in control_text(root, "enotario.wife_father.1.person_ar")


def test_person_filiation_expiry_and_inline_spacing_are_normalized():
    catalog = DocumentTemplateCatalog()
    selected = identity(7)
    selected["sex"] = "F"
    selected["filiation_ar"] = ["بنت امبارك بن كبور و رقية بنت عبد الرحمان"]
    fields = {"notary_1": "عبد الرحمن المريني", "notary_2": "محمد أمين العلوي",
              "notary_3": "يوسف بنسعيد"}
    payload, _ = catalog.render("ma.inheritance", "1.5.0", {
        "applicant": [selected], "heir": [selected], "witness": [],
    }, fields)
    root = document_xml(payload)
    person = control_text(root, "enotario.applicant.1.person_ar").replace("\u200e", "")
    assert "بنت بنت" not in person
    assert "بنت امبارك بن كبور" in person
    assert "الصالحة إلى غاية 2030/01/02" in person
    body = "".join(root.xpath(".//w:body//w:t/text()", namespaces={"w": W}))
    assert "المريني تلقى العدلان" in body
    assert "بنسعيد المنتصبان" in body


def test_witness_expiry_is_in_new_version_and_history_is_unchanged():
    catalog = DocumentTemplateCatalog()
    people = [identity(index) for index in range(1, 13)]
    for version in ["1.5.0", "1.5.1"]:
        payload, _ = catalog.render("ma.inheritance", version, {
            "applicant": [], "heir": [], "witness": people,
        })
        root = document_xml(payload)
        for index in range(1, 13):
            person = control_text(root, f"enotario.witness.{index}.person_ar").replace("\u200e", "")
            assert ("الصالحة إلى غاية 2030/01/02" in person) == (version == "1.5.1")
            if version == "1.5.1":
                assert person.index("AA") < person.index("الصالحة إلى غاية") < person.index("الساكن")


def test_current_templates_allow_all_roles_to_remain_unassigned():
    catalog = DocumentTemplateCatalog()
    marriage, _ = catalog.render("ma.marriage", "1.7.0", {
        "husband": [], "wife": [], "wife_father": [],
    })
    inheritance, _ = catalog.render("ma.inheritance", "1.5.0", {
        "applicant": [], "heir": [], "witness": [],
    })
    assert control_text(document_xml(marriage), "enotario.husband.1.person_ar") == ""
    assert control_text(document_xml(inheritance), "enotario.heir.1.person_ar") == ""


def test_v2_full_fill_replaces_declared_manual_controls_and_formats_dates():
    catalog = DocumentTemplateCatalog()
    wife = identity(2)
    wife["sex"] = "F"
    fields = {
        "registry_number": "REG-42", "page": "12", "book_number": "7/2026",
        "registry_date": "2026-09-16", "notary_1": "العدل الأول",
        "notary_2": "العدل الثاني", "notary_3": "القاضي",
        "case_number": "D-18", "case_date": "2026-09-17", "dowry": "عشرة آلاف درهم",
    }
    payload, _ = catalog.render("ma.marriage", "1.7.0", {
        "husband": [identity(1)], "wife": [wife], "wife_father": [identity(3)],
    }, fields)
    root = document_xml(payload)
    assert control_text(root, "manual.registry_number") == "REG-42"
    assert control_text(root, "manual.registry_date").replace("\u200e", "") == "2026/09/16"
    assert control_text(root, "manual.case_date").replace("\u200e", "") == "2026/09/17"
    assert control_text(root, "manual.dowry") == "عشرة آلاف درهم"

    with pytest.raises(DocumentTemplateError, match="DOCUMENT_TEMPLATE_FIELD_INVALID"):
        catalog.render("ma.marriage", "1.7.0", {
            "husband": [identity(1)], "wife": [wife], "wife_father": [identity(3)],
        }, {**fields, "registry_date": "16/09/2026"})


def test_v2_inheritance_fills_only_supplied_relations_and_leaves_other_slots_editable():
    catalog = DocumentTemplateCatalog()
    payload, _ = catalog.render("ma.inheritance", "1.5.0", {
        "applicant": [], "heir": [identity(1), identity(2)], "witness": [],
    }, {
        "registry_number": "88", "page": "3", "book_number": "2",
        "registry_date": "2026-09-16", "notary_1": "عدل 1", "notary_2": "عدل 2",
        "notary_3": "قاضي", "deceased": "شخص متوفى", "death_date": "2026-01-03",
        "death_record": "14", "death_record_date": "2026-01-04",
        "heir_relation": ["ابن", "بنت"], "estate_basis": "الفريضة الشرعية",
    })
    root = document_xml(payload)
    assert control_text(root, "manual.heir_relation.1") == "، صلة الإرث: ابن"
    assert control_text(root, "manual.heir_relation.2") == "، صلة الإرث: بنت"
    assert control_text(root, "manual.heir_relation.3") == ""
    assert control_text(root, "manual.death_date").strip().replace("\u200e", "") == "2026/01/03"


def test_linked_manual_fields_cannot_outnumber_their_assigned_role():
    catalog = DocumentTemplateCatalog()
    with pytest.raises(DocumentTemplateError, match="DOCUMENT_TEMPLATE_FIELD_INVALID"):
        catalog.render("ma.inheritance", "1.5.0", {
            "applicant": [], "heir": [identity(1)], "witness": [],
        }, {"heir_relation": ["ابن", "بنت"]})


def test_latin_name_and_closed_value_map_transformations():
    latin = TemplateBinding(tag="enotario.person.1.name", role="person", index=1,
                            sources=("given_names_latin", "surname_latin"), maximum_characters=160)
    assert _format_value(latin, identity(4)) == "MOHAMED 4 SPECIMEN"
    mapped = TemplateBinding(tag="enotario.person.1.sex", role="person", index=1,
                             sources=("sex",), format="map", value_map=(("M", "ذكر"), ("F", "أنثى")))
    assert _format_value(mapped, identity(5)) == "ذكر"
    date = TemplateBinding(tag="enotario.person.1.birth", role="person", index=1,
                           sources=("birth_date",), format="date_dmy", maximum_characters=10)
    assert _format_value(date, identity(5)).replace("\u200e", "") == "1990/01/02"
    multiline = TemplateBinding(tag="enotario.person.1.address", role="person", index=1,
                                sources=("address_ar",), maximum_characters=160)
    assert _format_value(multiline, identity(5)) == "السطر الأول\nالسطر الثاني"
    prefixed = TemplateBinding(tag="enotario.person.1.name", role="person", index=1,
                               sources=("given_names_ar", "surname_ar"), prefix="، ")
    assert _format_value(prefixed, identity(5)).startswith("، محمد 5")
    person = TemplateBinding(
        tag="enotario.person.1.person_ar", role="person", index=1,
        sources=("given_names_ar", "surname_ar", "filiation_ar", "birth_date",
                 "birth_place_ar", "national_id", "expiry_date", "address_ar", "sex"),
        format="person_ar", maximum_characters=1024,
    )
    assert _format_value(person, identity(5)).replace("\u200e", "") == (
        "السيد محمد 5 الاختبار، ابن الأب والأم، المزداد بتاريخ 1990/01/02 بمدينة الرباط، "
        "الحامل للبطاقة الوطنية للتعريف رقم AA000005، الصالحة إلى غاية 2030/01/02، "
        "والساكن بـالسطر الأول، السطر الثاني"
    )
    incomplete = identity(6)
    incomplete["address_ar"] = []
    with pytest.raises(DocumentTemplateError, match="DOCUMENT_TEMPLATE_BINDING_MISSING"):
        _format_value(person, incomplete)
    male_only = TemplateBinding(
        tag="enotario.husband.1.person_ar", role="husband", index=1,
        sources=person.sources, format="person_ar_male_bare", maximum_characters=1024,
    )
    female = identity(8)
    female["sex"] = "F"
    assert "المزداد بتاريخ" in _format_value(male_only, female)


def test_inheritance_supports_twelve_heirs_and_witnesses_and_rejects_overflow():
    catalog = DocumentTemplateCatalog()
    people = [identity(index) for index in range(1, 13)]
    payload, _ = catalog.render("ma.inheritance", "1.4.0", {
        "applicant": [identity(30)], "heir": people, "witness": people,
    })
    root = document_xml(payload)
    assert control_text(root, "enotario.heir.12.person_ar").startswith("؛ السيد محمد 12 الاختبار، ابن الأب والأم")
    assert control_text(root, "enotario.witness.12.person_ar").endswith("والساكن بـالسطر الأول، السطر الثاني.")
    assert control_text(root, "manual.deceased") == "................"
    body_paragraphs = root.xpath(".//w:body/w:p", namespaces={"w": W})
    texts = ["".join(paragraph.xpath(".//w:t/text()", namespaces={"w": W}))
             for paragraph in body_paragraphs]
    body_index = next(index for index, text in enumerate(texts) if "شهد بذلك السادة" in text)
    assert "الورثة" not in texts[body_index + 1]
    assert texts[body_index + 1].startswith("-1-")
    assert texts[body_index + 12].startswith("-12-")
    with pytest.raises(DocumentTemplateError, match="DOCUMENT_TEMPLATE_ROLE_INVALID"):
        catalog.render("ma.inheritance", "1.4.0", {
            "applicant": [], "heir": people + [identity(13)], "witness": [],
        })


def test_catalog_rejects_a_tampered_template(tmp_path: Path):
    source = Path(__file__).parents[1] / "src" / "cnie_documents" / "templates"
    target = tmp_path / "templates"
    shutil.copytree(source, target)
    template = target / "marriage" / "template.docx"
    template.write_bytes(template.read_bytes() + b"tampered")
    with pytest.raises(DocumentTemplateError, match="DOCUMENT_TEMPLATE_INTEGRITY_FAILED"):
        DocumentTemplateCatalog(target)


def test_catalog_detects_legal_text_drift_even_if_its_hash_is_updated(tmp_path: Path):
    source = Path(__file__).parents[1] / "src" / "cnie_documents" / "templates"
    target = tmp_path / "templates"
    shutil.copytree(source, target)
    legal = target / "marriage" / "legal.txt"
    legal.write_text(legal.read_text(encoding="utf-8") + "\nعبارة غير موجودة", encoding="utf-8")
    manifest_path = target / "marriage" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["legal_text_sha256"] = hashlib.sha256(legal.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(DocumentTemplateError, match="DOCUMENT_TEMPLATE_LEGAL_TEXT_MISMATCH"):
        DocumentTemplateCatalog(target)


def test_template_build_is_deterministic(tmp_path: Path):
    manifests = []
    for folder in ("marriage", "inheritance"):
        manifest = json.loads((Path(__file__).parents[1] / "src" / "cnie_documents" / "templates" / folder / "manifest.json").read_text(encoding="utf-8"))
        manifests.append(manifest["template_sha256"])
    assert len(set(manifests)) == 2
