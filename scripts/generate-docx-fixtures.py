from __future__ import annotations

import hashlib
import os
from dataclasses import replace
from pathlib import Path

from cnie_documents import DocumentTemplateCatalog
from cnie_documents.catalog import render_template


def identity(index: int) -> dict:
    return {
        "national_id": f"ZZ{index:06d}",
        "given_names_ar": f"شخص تجريبي {index}",
        "surname_ar": "دون بيانات حقيقية",
        "given_names_latin": f"SYNTHETIC {index}",
        "surname_latin": "SPECIMEN",
        "birth_date": "1990-01-02",
        "birth_place_ar": "مدينة تجريبية",
        "birth_place_latin": "SYNTHETIC CITY",
        "expiry_date": "2030-01-02",
        "sex": "M" if index % 2 else "F",
        "filiation_ar": ["والد تجريبي وأم تجريبية"],
        "filiation_latin": ["SYNTHETIC LINE ONE", "SYNTHETIC LINE TWO"],
        "address_ar": ["عنوان تجريبي أول", "عنوان تجريبي ثان"],
        "address_latin": ["SYNTHETIC ADDRESS ONE", "SYNTHETIC ADDRESS TWO"],
    }


def expanded_identity(index: int) -> dict:
    """Synthetic long values exercise Word overflow without real personal data."""
    record = identity(index)
    record["given_names_ar"] = f"شخص تجريبي ذو اسم مركب طويل {index}"
    record["filiation_ar"] = ["والد تجريبي ذو اسم مركب وأم تجريبية ذات اسم مركب"]
    record["birth_place_ar"] = "مدينة تجريبية ذات اسم إداري طويل"
    record["address_ar"] = [
        "حي تجريبي كبير، شارع تجريبي أول، إقامة تجريبية رقم اثني عشر",
        "الطابق الثالث، الشقة التجريبية الرابعة، مدينة تجريبية",
    ]
    return record


def main() -> None:
    destination = Path(os.environ.get(
        "ENOTARIO_FIXTURE_OUTPUT_ROOT",
        Path(__file__).parents[1] / "output" / "docx-qa",
    ))
    destination.mkdir(parents=True, exist_ok=True)
    catalog = DocumentTemplateCatalog()
    pilot_root = os.environ.get("ENOTARIO_TEMPLATE_OUTPUT_ROOT")
    fixtures = {
        "marriage-min.docx": ("ma.marriage", {
            "husband": [identity(1)], "wife": [identity(2)],
            "wife_father": [identity(3)],
        }, None),
        "marriage-max.docx": ("ma.marriage", {
            "husband": [expanded_identity(1)], "wife": [expanded_identity(2)],
            "wife_father": [expanded_identity(3)],
        }, None),
        "inheritance-min.docx": ("ma.inheritance", {
            "applicant": [], "heir": [identity(1)], "witness": [],
        }, None),
        "inheritance-max.docx": ("ma.inheritance", {
            "applicant": [identity(30)],
            "heir": [identity(index) for index in range(1, 13)],
            "witness": [identity(index) for index in range(13, 25)],
        }, None),
        "marriage-full.docx": ("ma.marriage", {
            "husband": [identity(1)], "wife": [identity(2)],
            "wife_father": [identity(3)],
        }, {
            "registry_number": "42", "page": "7", "book_number": "12/2026",
            "registry_date": "2026-09-17", "notary_1": "العدل التجريبي الأول",
            "notary_2": "العدل التجريبي الثاني", "notary_3": "القاضي التجريبي",
            "case_number": "D-18", "case_date": "2026-09-16",
            "dowry": "عشرة آلاف درهم",
        }),
        "inheritance-full.docx": ("ma.inheritance", {
            "applicant": [identity(1)], "heir": [identity(2)], "witness": [identity(3)],
        }, {
            "registry_number": "88", "page": "3", "book_number": "2/2026",
            "registry_date": "2026-09-17", "notary_1": "العدل التجريبي الأول",
            "notary_2": "العدل التجريبي الثاني", "notary_3": "القاضي التجريبي",
            "deceased": "شخص متوفى تجريبي", "death_date": "2026-08-28",
            "death_record": "14", "death_record_date": "2026-08-30",
            "heir_relation": ["بنت"], "estate_basis": "الفريضة الشرعية التجريبية",
        }),
    }
    for name, (template_id, assignments, fields) in fixtures.items():
        template = catalog.get(template_id)
        if pilot_root:
            pilot_path = Path(pilot_root) / template.template_path.parent.name / "template.docx"
            template = replace(
                template,
                template_path=pilot_path,
                template_sha256=hashlib.sha256(pilot_path.read_bytes()).hexdigest(),
            )
        payload = render_template(template, assignments, fields)
        output = destination / name
        output.write_bytes(payload)
        print(output)


if __name__ == "__main__":
    main()
