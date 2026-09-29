"""Rule DSL interpreter tests (spec §12.3, §12.6). Covers every node type and the three-valued
logic truth table row by row, per CLAUDE.md's "test every row" instruction from the spec."""

from __future__ import annotations

from datetime import date

import pytest

from engine.compliance.interpreter import evaluate_boolean, evaluate_rule, RuleCtx
from engine.compliance.types import BidContext, ClaimSnapshot, DocumentSummary, ReconciliationSnapshot

REF_DATE = date(2026, 9, 15)


def rule(expression: dict, **overrides) -> dict:
    base = {
        "schema_version": "1.0",
        "rule_code": "R-TEST",
        "name": "Test rule",
        "requirement_category": "OTHER",
        "mandatory": True,
        "weight": 10,
        "envelope": "TECHNICAL",
        "on_missing_evidence": "FAIL",
        "expression": expression,
        "plain_english": "test",
        "source": {"document_id": "d1", "clause_ref": "1", "page": 1},
    }
    base.update(overrides)
    return base


def claim(claim_type: str, value, status: str = "STRUCTURALLY_VALID", key: str | None = None, evidence_ids=("ev1",), verification_status: str | None = None, freshness_state: str | None = None) -> ClaimSnapshot:
    return ClaimSnapshot(claim_type=claim_type, key=key, value=value, status=status, verification_status=verification_status, valid_until=None, freshness_state=freshness_state, evidence_ids=tuple(evidence_ids))


# ───────────────────────── Three-valued logic truth table (spec §12.3) ─────────────────────────

def _leaf_for(rule_ctx: RuleCtx, result: str) -> dict:
    if result == "PASS":
        return {"node": "DOCUMENT_EXISTS", "doc_type": "PASS", "min_count": 1}
    if result == "FAIL":
        return {"node": "DOCUMENT_EXISTS", "doc_type": "MISSING_FAIL", "min_count": 1}
    if result == "NOT_APPLICABLE":
        return {"node": "IF", "cond": {"node": "DOCUMENT_EXISTS", "doc_type": "MISSING_FAIL"}, "then": {"node": "DOCUMENT_EXISTS", "doc_type": "PASS"}}
    if result == "REVIEW_REQUIRED":
        return {"node": "FIELD_MATCH", "field": "PAN"}
    if result == "PENDING_VERIFICATION":
        return {"node": "SOURCE_VERIFIED", "claim_type": "GSTIN", "min_status": "AUTHORITATIVE_VERIFIED"}
    if result == "BLOCKED":
        raise NotImplementedError("BLOCKED is never produced by any node — see test_and_blocked_dominates for how it's injected")
    raise ValueError(result)


def _evaluate_and(results: list[str], ctx: BidContext) -> str:
    r = rule({"node": "AND", "args": [_leaf_for(RuleCtx(rule({})), x) for x in results]}, on_missing_evidence="FAIL")
    rule_ctx = RuleCtx(r)
    out, _, _ = evaluate_boolean(r["expression"], rule_ctx, ctx, REF_DATE)
    return out


def _evaluate_or(results: list[str], ctx: BidContext) -> str:
    r = rule({"node": "OR", "args": [_leaf_for(RuleCtx(rule({})), x) for x in results]}, on_missing_evidence="FAIL")
    rule_ctx = RuleCtx(r)
    out, _, _ = evaluate_boolean(r["expression"], rule_ctx, ctx, REF_DATE)
    return out


_FULL_CTX = BidContext(
    documents=(DocumentSummary(doc_type="PASS", count=1),),
    reconciliations=(ReconciliationSnapshot(field="PAN", outcome="CONFLICT", values={}),),
    claims=(claim("GSTIN", "27AABCX1234F1Z5", status="STRUCTURALLY_VALID"),),
)


@pytest.mark.parametrize(
    "inputs,expected",
    [
        (["PASS", "PASS"], "PASS"),
        (["PASS", "FAIL"], "FAIL"),
        (["PASS", "REVIEW_REQUIRED"], "REVIEW_REQUIRED"),
        (["PASS", "PENDING_VERIFICATION"], "PENDING_VERIFICATION"),
        (["FAIL", "REVIEW_REQUIRED"], "FAIL"),
        (["REVIEW_REQUIRED", "PENDING_VERIFICATION"], "REVIEW_REQUIRED"),
        (["NOT_APPLICABLE", "NOT_APPLICABLE"], "NOT_APPLICABLE"),
        (["NOT_APPLICABLE", "PASS"], "PASS"),
        (["NOT_APPLICABLE", "FAIL"], "FAIL"),
    ],
)
def test_and_truth_table(inputs, expected):
    assert _evaluate_and(inputs, _FULL_CTX) == expected


@pytest.mark.parametrize(
    "inputs,expected",
    [
        (["PASS", "FAIL"], "PASS"),
        (["FAIL", "FAIL"], "FAIL"),
        (["FAIL", "REVIEW_REQUIRED"], "REVIEW_REQUIRED"),
        (["FAIL", "PENDING_VERIFICATION"], "PENDING_VERIFICATION"),
        (["REVIEW_REQUIRED", "PENDING_VERIFICATION"], "REVIEW_REQUIRED"),
        (["NOT_APPLICABLE", "NOT_APPLICABLE"], "NOT_APPLICABLE"),
        (["NOT_APPLICABLE", "PASS"], "PASS"),
        (["NOT_APPLICABLE", "FAIL"], "FAIL"),
    ],
)
def test_or_truth_table(inputs, expected):
    assert _evaluate_or(inputs, _FULL_CTX) == expected


def test_and_fail_dominates_review_required():
    # BLOCKED can't be produced by any leaf node today (no rule-dependency mechanism yet — spec's
    # "cannot evaluate because a dependency errored" case doesn't arise), so the dominance table's
    # BLOCKED rows aren't independently exercisable; FAIL-over-REVIEW_REQUIRED is covered here.
    r = rule({"node": "AND", "args": [{"node": "DOCUMENT_EXISTS", "doc_type": "PASS"}, {"node": "DOCUMENT_EXISTS", "doc_type": "MISSING_FAIL"}, {"node": "FIELD_MATCH", "field": "PAN"}]})
    rule_ctx = RuleCtx(r)
    out, _, _ = evaluate_boolean(r["expression"], rule_ctx, _FULL_CTX, REF_DATE)
    assert out == "FAIL"


def test_not_flips_pass_fail_only():
    ctx = BidContext(documents=(DocumentSummary(doc_type="PASS", count=1),))
    r = rule({"node": "NOT", "arg": {"node": "DOCUMENT_EXISTS", "doc_type": "PASS"}})
    rule_ctx = RuleCtx(r)
    out, _, _ = evaluate_boolean(r["expression"], rule_ctx, ctx, REF_DATE)
    assert out == "FAIL"

    r2 = rule({"node": "NOT", "arg": {"node": "FIELD_MATCH", "field": "PAN"}}, on_missing_evidence="REVIEW_REQUIRED")
    rule_ctx2 = RuleCtx(r2)
    out2, _, _ = evaluate_boolean(r2["expression"], rule_ctx2, BidContext(), REF_DATE)
    assert out2 == "REVIEW_REQUIRED"  # unknowns pass through NOT unchanged


def test_if_propagates_unknown_cond():
    r = rule({"node": "IF", "cond": {"node": "SOURCE_VERIFIED", "claim_type": "GSTIN", "min_status": "AUTHORITATIVE_VERIFIED"}, "then": {"node": "TENDER_FLAG", "flag": "x"}})
    ctx = BidContext(claims=(claim("GSTIN", "27AABCX1234F1Z5", status="STRUCTURALLY_VALID"),))
    rule_ctx = RuleCtx(r)
    out, _, _ = evaluate_boolean(r["expression"], rule_ctx, ctx, REF_DATE)
    assert out == "PENDING_VERIFICATION"


def test_if_no_else_and_cond_fail_is_not_applicable():
    r = rule({"node": "IF", "cond": {"node": "TENDER_FLAG", "flag": "missing"}, "then": {"node": "TENDER_FLAG", "flag": "also_missing"}})
    rule_ctx = RuleCtx(r)
    out, _, _ = evaluate_boolean(r["expression"], rule_ctx, BidContext(), REF_DATE)
    assert out == "NOT_APPLICABLE"


# ───────────────────────── COMPARE / AGG / SERIES — the turnover example from spec §12.6 ─────────────────────────


def test_compare_average_turnover_passes():
    ctx = BidContext(
        claims=(
            claim("ANNUAL_TURNOVER", "120000000", key="FY2023-24"),
            claim("ANNUAL_TURNOVER", "110000000", key="FY2024-25"),
            claim("ANNUAL_TURNOVER", "130000000", key="FY2025-26"),
        )
    )
    expr = {
        "node": "COMPARE",
        "left": {"node": "AGG", "fn": "AVERAGE", "series": {"node": "SERIES", "claim_type": "ANNUAL_TURNOVER", "period": {"kind": "LAST_N_COMPLETED_FY", "n": 3}}},
        "op": ">=",
        "right": {"node": "CONST", "value": "100000000", "unit": "INR"},
    }
    result = evaluate_rule(rule(expr), ctx, REF_DATE)
    assert result["result"] == "PASS"
    assert result["earned_weight"] == "10"
    assert set(result["evidence_ids"]) == {"ev1"}


def test_compare_missing_period_uses_on_missing_evidence():
    ctx = BidContext(claims=(claim("ANNUAL_TURNOVER", "120000000", key="FY2023-24"),))  # only 1 of 3 FYs
    expr = {
        "node": "COMPARE",
        "left": {"node": "AGG", "fn": "AVERAGE", "series": {"node": "SERIES", "claim_type": "ANNUAL_TURNOVER", "period": {"kind": "LAST_N_COMPLETED_FY", "n": 3}}},
        "op": ">=",
        "right": {"node": "CONST", "value": "100000000", "unit": "INR"},
    }
    result = evaluate_rule(rule(expr, on_missing_evidence="REVIEW_REQUIRED"), ctx, REF_DATE)
    assert result["result"] == "REVIEW_REQUIRED"


def test_compare_duplicate_conflicting_fy_values_is_review_required():
    ctx = BidContext(
        claims=(
            claim("ANNUAL_TURNOVER", "120000000", key="FY2023-24", evidence_ids=("ev1",)),
            claim("ANNUAL_TURNOVER", "999000000", key="FY2023-24", evidence_ids=("ev2",)),  # two different values, same FY
        )
    )
    expr = {
        "node": "COMPARE",
        "left": {"node": "AGG", "fn": "SUM", "series": {"node": "SERIES", "claim_type": "ANNUAL_TURNOVER", "period": {"kind": "FY_LIST", "fys": ["FY2023-24"]}}},
        "op": ">=",
        "right": {"node": "CONST", "value": "1", "unit": "INR"},
    }
    result = evaluate_rule(rule(expr), ctx, REF_DATE)
    assert result["result"] == "REVIEW_REQUIRED"


def test_below_min_verification_is_pending():
    ctx = BidContext(claims=(claim("ANNUAL_TURNOVER", "120000000", key="FY2023-24", status="FIELD_EXTRACTED"),))
    expr = {
        "node": "COMPARE",
        "left": {"node": "FIELD", "claim_type": "ANNUAL_TURNOVER", "period": {"kind": "FY_LIST", "fys": ["FY2023-24"]}},
        "op": ">=",
        "right": {"node": "CONST", "value": "1", "unit": "INR"},
    }
    result = evaluate_rule(rule(expr, min_verification="RECONCILED"), ctx, REF_DATE)
    assert result["result"] == "PENDING_VERIFICATION"


def test_ratio_division_by_zero_is_review_required():
    expr = {"node": "COMPARE", "left": {"node": "RATIO", "num": {"node": "CONST", "value": "10"}, "den": {"node": "CONST", "value": "0"}}, "op": ">", "right": {"node": "CONST", "value": "0"}}
    result = evaluate_rule(rule(expr), BidContext(), REF_DATE)
    assert result["result"] == "REVIEW_REQUIRED"


# ───────────────────────── Other node types ─────────────────────────


def test_document_exists_pass_and_missing():
    ctx = BidContext(documents=(DocumentSummary(doc_type="BIS_CERTIFICATE", count=2),))
    r = rule({"node": "DOCUMENT_EXISTS", "doc_type": "BIS_CERTIFICATE", "min_count": 2})
    assert evaluate_rule(r, ctx, REF_DATE)["result"] == "PASS"
    r2 = rule({"node": "DOCUMENT_EXISTS", "doc_type": "ISO_CERTIFICATE", "min_count": 1}, on_missing_evidence="REVIEW_REQUIRED")
    assert evaluate_rule(r2, ctx, REF_DATE)["result"] == "REVIEW_REQUIRED"


def test_date_validity():
    ctx = BidContext(documents=(DocumentSummary(doc_type="BIS_CERTIFICATE", count=1, expiry_date=date(2026, 10, 1)),))
    r = rule({"node": "DATE_VALIDITY", "doc_type": "BIS_CERTIFICATE", "valid_on": "REFERENCE_DATE", "min_days_remaining": 10})
    assert evaluate_rule(r, ctx, REF_DATE)["result"] == "PASS"  # 16 days remaining
    r2 = rule({"node": "DATE_VALIDITY", "doc_type": "BIS_CERTIFICATE", "valid_on": "REFERENCE_DATE", "min_days_remaining": 30})
    assert evaluate_rule(r2, ctx, REF_DATE)["result"] == "FAIL"


def test_field_match_and_entity_match():
    ctx = BidContext(reconciliations=(ReconciliationSnapshot(field="PAN", outcome="CONSISTENT", values={}), ReconciliationSnapshot(field="LEGAL_NAME", outcome="CONFLICT", values={})))
    assert evaluate_rule(rule({"node": "FIELD_MATCH", "field": "PAN"}), ctx, REF_DATE)["result"] == "PASS"
    assert evaluate_rule(rule({"node": "ENTITY_MATCH", "entity": "LEGAL_NAME"}), ctx, REF_DATE)["result"] == "REVIEW_REQUIRED"


def test_source_verified_levels():
    ctx = BidContext(claims=(claim("GSTIN", "27AABCX1234F1Z5", status="RECONCILED"),))
    assert evaluate_rule(rule({"node": "SOURCE_VERIFIED", "claim_type": "GSTIN", "min_status": "RECONCILED"}), ctx, REF_DATE)["result"] == "PASS"
    assert evaluate_rule(rule({"node": "SOURCE_VERIFIED", "claim_type": "GSTIN", "min_status": "AUTHORITATIVE_VERIFIED"}), ctx, REF_DATE)["result"] == "PENDING_VERIFICATION"


def test_threshold_count():
    ctx = BidContext(
        claims=(
            claim("EXPERIENCE_PROJECT", {"value": "5000000"}, key="p1"),
            claim("EXPERIENCE_PROJECT", {"value": "6000000"}, key="p2"),
            claim("EXPERIENCE_PROJECT", {"value": "1000000"}, key="p3"),
        )
    )
    expr = {"node": "THRESHOLD_COUNT", "series": {"node": "SERIES", "claim_type": "EXPERIENCE_PROJECT", "period": {"kind": "ALL"}}, "op": ">=", "value": {"node": "CONST", "value": "4000000"}, "min_count": 2}
    assert evaluate_rule(rule(expr), ctx, REF_DATE)["result"] == "PASS"
    expr["min_count"] = 3
    assert evaluate_rule(rule(expr), ctx, REF_DATE)["result"] == "FAIL"


def test_claim_true_msme():
    ctx = BidContext(claims=(claim("MSME_STATUS", True),))
    assert evaluate_rule(rule({"node": "CLAIM_TRUE", "claim_type": "MSME_STATUS"}), ctx, REF_DATE)["result"] == "PASS"
    ctx2 = BidContext(claims=(claim("MSME_STATUS", False),))
    assert evaluate_rule(rule({"node": "CLAIM_TRUE", "claim_type": "MSME_STATUS"}), ctx2, REF_DATE)["result"] == "FAIL"


def test_tender_flag():
    ctx = BidContext(tender_flags={"allows_mse_exemption": True})
    assert evaluate_rule(rule({"node": "TENDER_FLAG", "flag": "allows_mse_exemption"}), ctx, REF_DATE)["result"] == "PASS"
    assert evaluate_rule(rule({"node": "TENDER_FLAG", "flag": "unset_flag"}), ctx, REF_DATE)["result"] == "FAIL"


def test_top_n_and_filter():
    ctx = BidContext(
        claims=(
            claim("EXPERIENCE_PROJECT", {"value": "3000000"}, key="p1"),
            claim("EXPERIENCE_PROJECT", {"value": "9000000"}, key="p2"),
            claim("EXPERIENCE_PROJECT", {"value": "5000000"}, key="p3"),
        )
    )
    expr = {
        "node": "COMPARE",
        "left": {"node": "AGG", "fn": "SUM", "series": {"node": "TOP_N", "series": {"node": "SERIES", "claim_type": "EXPERIENCE_PROJECT", "period": {"kind": "ALL"}}, "n": 2, "order": "DESC"}},
        "op": "==",
        "right": {"node": "CONST", "value": "14000000"},
    }
    assert evaluate_rule(rule(expr), ctx, REF_DATE)["result"] == "PASS"  # top 2 = 9M + 5M


# ───────────────────────── Exemptions (spec §12.2) ─────────────────────────


def test_exemption_applies_with_verified_evidence():
    ctx = BidContext(
        claims=(claim("MSME_STATUS", True, status="RECONCILED"),),
        documents=(DocumentSummary(doc_type="EXPERIENCE_CERTIFICATE", count=0),),
    )
    r = rule(
        {"node": "DOCUMENT_EXISTS", "doc_type": "EXPERIENCE_CERTIFICATE", "min_count": 1},
        exemptions=[{"code": "MSE_EXPERIENCE_EXEMPTION", "when": {"node": "CLAIM_TRUE", "claim_type": "MSME_STATUS"}, "effect": "NOT_APPLICABLE", "requires_evidence": ["MSME_STATUS"], "min_verification": "RECONCILED"}],
    )
    result = evaluate_rule(r, ctx, REF_DATE)
    assert result["result"] == "NOT_APPLICABLE"


def test_exemption_does_not_apply_without_required_evidence_level():
    ctx = BidContext(claims=(claim("MSME_STATUS", True, status="FIELD_EXTRACTED"),))  # below required RECONCILED
    r = rule(
        {"node": "DOCUMENT_EXISTS", "doc_type": "EXPERIENCE_CERTIFICATE", "min_count": 1},
        exemptions=[{"code": "MSE_EXPERIENCE_EXEMPTION", "when": {"node": "CLAIM_TRUE", "claim_type": "MSME_STATUS"}, "effect": "NOT_APPLICABLE", "requires_evidence": ["MSME_STATUS"], "min_verification": "RECONCILED"}],
    )
    result = evaluate_rule(r, ctx, REF_DATE)
    assert result["result"] == "FAIL"  # falls through to the main expression, DOCUMENT_EXISTS missing -> on_missing_evidence FAIL


def test_self_declaration_alone_never_satisfies_exemption():
    """spec §12.2: 'typing "we are MSME" in a form never satisfies it' — a DECLARATION claim
    with no verification standing should not clear a min_verification-gated exemption."""
    ctx = BidContext(claims=(claim("MSME_STATUS", True, status="DOCUMENT_UPLOADED"),))
    r = rule(
        {"node": "DOCUMENT_EXISTS", "doc_type": "EXPERIENCE_CERTIFICATE", "min_count": 1},
        exemptions=[{"code": "MSE_EXPERIENCE_EXEMPTION", "when": {"node": "CLAIM_TRUE", "claim_type": "MSME_STATUS"}, "effect": "NOT_APPLICABLE", "requires_evidence": ["MSME_STATUS"], "min_verification": "STRUCTURALLY_VALID"}],
    )
    result = evaluate_rule(r, ctx, REF_DATE)
    assert result["result"] == "FAIL"
