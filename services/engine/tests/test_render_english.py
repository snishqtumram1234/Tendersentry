from engine.rules.render_english import render_plain_english


def test_renders_compare_with_amounts():
    dsl = {
        "expression": {
            "node": "COMPARE",
            "left": {"node": "AGG", "fn": "AVERAGE", "series": {"node": "SERIES", "claim_type": "ANNUAL_TURNOVER", "period": {"kind": "LAST_N_COMPLETED_FY", "n": 3}}},
            "op": ">=",
            "right": {"node": "CONST", "value": "100000000", "unit": "INR"},
        }
    }
    text = render_plain_english(dsl)
    assert "₹10 Cr" in text
    assert "average" in text
    assert "Annual Turnover" in text


def test_renders_document_exists():
    dsl = {"expression": {"node": "DOCUMENT_EXISTS", "doc_type": "BIS_CERTIFICATE", "min_count": 1}}
    text = render_plain_english(dsl)
    assert "Bis Certificate" in text
    assert "At least 1" in text


def test_renders_and_of_two_conditions():
    dsl = {
        "expression": {
            "node": "AND",
            "args": [
                {"node": "DOCUMENT_EXISTS", "doc_type": "GST_CERTIFICATE"},
                {"node": "FIELD_MATCH", "field": "PAN"},
            ],
        }
    }
    text = render_plain_english(dsl)
    assert " and " in text


def test_never_raises_on_unrecognised_shape():
    text = render_plain_english({"expression": {"node": "TOTALLY_UNKNOWN"}})
    assert isinstance(text, str) and len(text) > 0


def test_never_raises_on_missing_expression():
    text = render_plain_english({})
    assert isinstance(text, str) and len(text) > 0
