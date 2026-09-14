from uuid import uuid4

from cnie_extract import CnieFieldExtractor, ExtractionStatus
from cnie_ocr.domain import OcrBlock, OcrPage, OcrParagraph, OcrResult, OcrStatus, OcrWord


def word(value, x, y, language="fr"):
    return OcrWord(value, .96, [[x, y], [x + 100, y], [x + 100, y + 30], [x, y + 30]], [language])


def result(values, full_text):
    paragraph = OcrParagraph(full_text, .96, [[0, 0], [1600, 0], [1600, 1008], [0, 1008]],
                             ["ar", "fr"], values)
    return OcrResult(OcrStatus.SUCCESS, uuid4(), full_text=full_text,
                     pages=[OcrPage(1600, 1008, .96, [OcrBlock(full_text, .96, [[0, 0]], paragraphs=[paragraph])])])


def test_current_template_extracts_only_supported_evidence():
    front_words = [word("ROYAUME", 40, 40), word("MAROC", 180, 40), word("المملكة", 1200, 40, "ar"),
        word("TEST", 600, 285), word("SPECIMEN", 600, 375), word("01.01.1990", 870, 450),
        word("RABAT", 600, 535), word("AA123456", 180, 880), word("01.01.2030", 1100, 880)]
    back_words = [word("adresse", 100, 350), word("العنوان", 1200, 350, "ar")]
    output = CnieFieldExtractor().extract(result(front_words, "ROYAUME DU MAROC المملكة البطاقة"),
        result(back_words, "adresse العنوان"))
    assert output.status == ExtractionStatus.REVIEW_REQUIRED
    assert output.template == "CNIE_MA_2020"
    assert output.fields["birth_date"].normalized_value == "1990-01-01"
    assert output.fields["national_id"].normalized_value == "AA123456"
    assert output.fields["surname_latin"].evidence
    assert "EXTRACTION_REQUIRED_FIELD_MISSING" in output.warnings


def test_unknown_layout_is_rejected_without_fields():
    empty = result([], "ordinary document")
    output = CnieFieldExtractor().extract(empty, empty)
    assert output.status == ExtractionStatus.UNSUPPORTED_LAYOUT
    assert output.fields == {}
    assert output.error_code == "EXTRACTION_UNSUPPORTED_LAYOUT"


def test_cnie_template_geometry_does_not_cross_neighbouring_fields():
    """Regression fixture matching the spacing of a real 1600x1008 CNIE."""
    front_words = [
        word("ROYAUME", 40, 40), word("MAROC", 180, 40), word("المملكة", 1200, 40, "ar"),
        word("AMINA", 650, 250), word("ELMANSOURI", 650, 360),
        word("أمينة", 1450, 190, "ar"), word("المنصوري", 1420, 305, "ar"),
        word("03.09.1990", 950, 420), word("a", 540, 540), word("RABAT", 650, 540),
        word("الرباط", 1450, 480, "ar"), word("المدير", 850, 700, "ar"),
        word("X123456", 220, 910), word("07.04.2036", 1150, 910),
        word("123456", 1500, 715), word("CAN", 1500, 815),
    ]
    back_words = [
        word("N", 5, 50), word("°", 20, 50), word("X123456", 100, 50),
        word("424/2008", 700, 50), word("Fille", 5, 260), word("de", 60, 260),
        word("MOHAMED", 150, 260), word("ben", 300, 260), word("ALI", 400, 260),
        word("Et", 5, 330), word("de", 45, 330), word("KHADIJA", 150, 330),
        word("bent", 300, 330), word("SAID", 400, 330),
        word("بنت", 1050, 120, "ar"), word("محمد", 950, 120, "ar"),
        word("بن", 850, 120, "ar"), word("علي", 750, 120, "ar"),
        word("و", 1080, 190, "ar"), word("خديجة", 950, 190, "ar"),
        word("بنت", 850, 190, "ar"), word("سعيد", 740, 190, "ar"),
        word("Adresse", 5, 540), word("125", 110, 540), word("HAY", 190, 540),
        word("RABAT", 280, 540), word("العنوان", 1500, 470, "ar"),
        word("125", 1400, 470), word("حي", 1320, 470, "ar"), word("الرباط", 1180, 470, "ar"),
        word("الجنس", 1500, 180, "ar"), word("Sexe", 1350, 180), word("F", 1400, 270),
    ]
    front = result(front_words, "ROYAUME DU MAROC المملكة البطاقة")
    back = result(back_words, "adresse العنوان")
    output = CnieFieldExtractor().extract(front, back)
    assert output.fields["given_names_latin"].normalized_value == "AMINA"
    assert output.fields["surname_latin"].normalized_value == "ELMANSOURI"
    assert output.fields["birth_place_latin"].normalized_value == "RABAT"
    assert output.fields["national_id"].normalized_value == "X123456"
    assert len(output.fields) == 14
    assert not {"issuing_authority_ar", "can", "civil_status_act_number", "marital_mention_type", "mrz_lines"} & output.fields.keys()


def test_multiline_values_keep_parent_order():
    front_words = [word("ROYAUME", 40, 40), word("MAROC", 180, 40), word("المملكة", 1200, 40, "ar")]
    back_words = [word("Fille", 5, 260), word("de", 60, 260), word("PARENTONE", 150, 260),
                  word("Et", 5, 330), word("de", 45, 330), word("PARENTTWO", 150, 330),
                  word("adresse", 5, 540), word("LINEONE", 120, 540), word("LINETWO", 120, 575)]
    output = CnieFieldExtractor().extract(result(front_words, "ROYAUME MAROC المملكة البطاقة"),
        result(back_words, "adresse العنوان"))
    assert output.fields["filiation_latin"].normalized_value == "PARENTONE\nPARENTTWO"
    assert output.fields["address_latin"].normalized_value == "LINEONE\nLINETWO"


def test_sex_requires_a_marker_on_the_printed_label_line():
    front = result([word("ROYAUME", 40, 40), word("MAROC", 180, 40),
                    word("المملكة", 1200, 40, "ar")], "ROYAUME MAROC المملكة البطاقة")
    labels = [word("adresse", 5, 540), word("العنوان", 1200, 350, "ar"),
              word("Sexe", 1340, 170), word("الجنس", 1480, 170, "ar")]
    detected = CnieFieldExtractor().extract(front, result(labels + [word("F", 1410, 170)],
                                                          "adresse العنوان Sexe F الجنس"))
    assert detected.fields["sex"].normalized_value == "F"

    artwork_false_positive = CnieFieldExtractor().extract(
        front, result(labels + [word("M", 1410, 252)], "adresse العنوان Sexe الجنس M"))
    assert artwork_false_positive.fields["sex"].normalized_value is None
    assert "EXTRACTION_REQUIRED_FIELD_MISSING" in artwork_false_positive.fields["sex"].warnings
