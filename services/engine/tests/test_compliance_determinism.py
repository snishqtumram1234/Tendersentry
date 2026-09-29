"""Determinism test (spec §12.6): 'same inputs → byte-identical output ... A property test runs
each golden case twice and compares hashes.'"""

from __future__ import annotations

import hashlib
import json
from datetime import date

from engine.compliance.aggregate import RequirementResultLike, compute_gate, compute_risk_signals, compute_score
from engine.compliance.interpreter import evaluate_rule
from engine.compliance.types import BidContext, ClaimSnapshot, DocumentSummary, ReconciliationSnapshot

REF_DATE = date(2026, 9, 15)

_RULE = {
    "schema_version": "1.0",
    "rule_code": "R-07",
    "name": "Average annual turnover",
    "requirement_category": "FINANCIAL",
    "mandatory": True,
    "weight": 20,
    "envelope": "TECHNICAL",
    "on_missing_evidence": "REVIEW_REQUIRED",
    "expression": {
        "node": "COMPARE",
        "left": {"node": "AGG", "fn": "AVERAGE", "series": {"node": "SERIES", "claim_type": "ANNUAL_TURNOVER", "period": {"kind": "LAST_N_COMPLETED_FY", "n": 3}}},
        "op": ">=",
        "right": {"node": "CONST", "value": "100000000", "unit": "INR"},
    },
    "exemptions": [],
    "plain_english": "Average turnover over the last 3 completed financial years must be at least Rs 10 Cr.",
    "source": {"document_id": "d1", "clause_ref": "7.2", "page": 14},
}

_CTX = BidContext(
    claims=(
        ClaimSnapshot(claim_type="ANNUAL_TURNOVER", key="FY2023-24", value="120000000", status="STRUCTURALLY_VALID", verification_status=None, valid_until=None, freshness_state=None, evidence_ids=("ev_101",)),
        ClaimSnapshot(claim_type="ANNUAL_TURNOVER", key="FY2024-25", value="110000000", status="STRUCTURALLY_VALID", verification_status=None, valid_until=None, freshness_state=None, evidence_ids=("ev_102",)),
        ClaimSnapshot(claim_type="ANNUAL_TURNOVER", key="FY2025-26", value="130000000", status="STRUCTURALLY_VALID", verification_status=None, valid_until=None, freshness_state=None, evidence_ids=("ev_103",)),
        ClaimSnapshot(claim_type="PAN", key=None, value="AABCX1234F", status="RECONCILED", verification_status=None, valid_until=None, freshness_state=None, evidence_ids=("ev_1", "ev_2")),
    ),
    reconciliations=(ReconciliationSnapshot(field="PAN", outcome="CONSISTENT", values={"a": "AABCX1234F"}),),
    documents=(DocumentSummary(doc_type="BIS_CERTIFICATE", count=1, expiry_date=date(2027, 1, 1)),),
    tender_flags={"allows_mse_exemption": False},
)


def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, default=str)


def _hash(obj) -> str:
    return hashlib.sha256(_canonical(obj).encode("utf-8")).hexdigest()


def test_interpreter_output_is_byte_identical_across_repeated_runs():
    run1 = evaluate_rule(_RULE, _CTX, REF_DATE)
    run2 = evaluate_rule(_RULE, _CTX, REF_DATE)
    assert _hash(run1) == _hash(run2)
    assert run1 == run2


def test_full_run_hash_is_stable_across_repeated_runs():
    """Same idea, but exercising the full run shape (results + gate + score + risk) the API
    persists, matching the spec's 'record engine_version ... in the run' framing."""

    def run_once():
        outcome = evaluate_rule(_RULE, _CTX, REF_DATE)
        result_like = RequirementResultLike(requirement_id="req-1", result=outcome["result"], mandatory=outcome["mandatory"], weight=outcome["weight"])
        from decimal import Decimal

        result_like.weight = Decimal(outcome["weight"])
        gate = compute_gate([result_like])
        score = compute_score([result_like])
        risk = compute_risk_signals([result_like], _CTX, gate["status"])
        return {"outcome": outcome, "gate": gate, "score": score, "risk": risk}

    a, b = run_once(), run_once()
    assert _hash(a) == _hash(b)


def test_evaluate_rule_never_mutates_bid_context():
    before = _hash({"claims": [c.__dict__ for c in _CTX.claims], "reconciliations": [r.__dict__ for r in _CTX.reconciliations]})
    evaluate_rule(_RULE, _CTX, REF_DATE)
    after = _hash({"claims": [c.__dict__ for c in _CTX.claims], "reconciliations": [r.__dict__ for r in _CTX.reconciliations]})
    assert before == after
