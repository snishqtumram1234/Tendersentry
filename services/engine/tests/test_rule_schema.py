"""Tests for the Rule DSL schema + semantic validation (spec §12.1-12.5, §23.1)."""

from engine.rules.schema import schema_errors
from engine.rules.semantic import semantic_errors

VALID_RULE = {
    "schema_version": "1.0",
    "rule_code": "R-07",
    "name": "Average annual turnover",
    "requirement_category": "FINANCIAL",
    "mandatory": True,
    "weight": 20,
    "envelope": "TECHNICAL",
    "on_missing_evidence": "REVIEW_REQUIRED",
    "evidence_types": ["CA_CERTIFICATE_TURNOVER"],
    "expression": {
        "node": "COMPARE",
        "left": {"node": "AGG", "fn": "AVERAGE", "series": {"node": "SERIES", "claim_type": "ANNUAL_TURNOVER", "period": {"kind": "LAST_N_COMPLETED_FY", "n": 3}}},
        "op": ">=",
        "right": {"node": "CONST", "value": "100000000", "unit": "INR"},
    },
    "plain_english": "Average turnover over the last 3 completed financial years must be at least ₹10 Cr.",
    "source": {"document_id": "doc-1", "clause_ref": "7.2", "page": 14, "quote": "..."},
    "ambiguities": [],
}


def test_valid_rule_has_no_schema_errors():
    assert schema_errors(VALID_RULE) == []


def test_valid_rule_has_no_semantic_errors():
    assert semantic_errors(VALID_RULE) == []


def test_missing_required_field_is_rejected():
    bad = {k: v for k, v in VALID_RULE.items() if k != "expression"}
    assert schema_errors(bad) != []


def test_unknown_node_type_is_rejected():
    bad = {**VALID_RULE, "expression": {"node": "MADE_UP_NODE"}}
    assert schema_errors(bad) != []


def test_unknown_claim_type_is_rejected():
    bad = {**VALID_RULE, "expression": {"node": "CLAIM_TRUE", "claim_type": "NOT_A_REAL_FIELD"}}
    assert schema_errors(bad) != []


def test_additional_properties_rejected():
    bad = {**VALID_RULE, "unexpected_field": "nope"}
    assert schema_errors(bad) != []


def test_compare_with_mismatched_units_is_a_semantic_error():
    bad = {
        **VALID_RULE,
        "expression": {
            "node": "COMPARE",
            "left": {"node": "CONST", "value": "5", "unit": "COUNT"},
            "op": ">=",
            "right": {"node": "CONST", "value": "1000", "unit": "INR"},
        },
    }
    assert schema_errors(bad) == []  # schema alone can't catch this
    errors = semantic_errors(bad)
    assert any("incompatible units" in e for e in errors)


def test_periodic_field_without_period_is_a_semantic_error():
    bad = {
        **VALID_RULE,
        "expression": {
            "node": "COMPARE",
            "left": {"node": "FIELD", "claim_type": "ANNUAL_TURNOVER"},
            "op": ">=",
            "right": {"node": "CONST", "value": "1", "unit": "INR"},
        },
    }
    errors = semantic_errors(bad)
    assert any("periodic value and must specify a period" in e for e in errors)


def test_non_periodic_field_does_not_need_a_period():
    ok = {
        **VALID_RULE,
        "expression": {"node": "CLAIM_TRUE", "claim_type": "MSME_STATUS"},
    }
    assert semantic_errors(ok) == []


def test_deeply_nested_rule_is_rejected():
    node = {"node": "CONST", "value": "1", "unit": "COUNT"}
    for _ in range(20):
        node = {"node": "NOT", "arg": {"node": "COMPARE", "left": node, "op": ">=", "right": {"node": "CONST", "value": "0", "unit": "COUNT"}}}
    bad = {**VALID_RULE, "expression": node}
    assert any("depth" in e for e in semantic_errors(bad))
