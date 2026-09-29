from decimal import Decimal

from engine.compliance.aggregate import RequirementResultLike, compute_gate, compute_risk_signals, compute_score, risk_level
from engine.compliance.types import BidContext, ClaimSnapshot, ReconciliationSnapshot


def r(result: str, mandatory: bool = True, weight: str = "10", requirement_id: str = "req1") -> RequirementResultLike:
    return RequirementResultLike(requirement_id=requirement_id, result=result, mandatory=mandatory, weight=Decimal(weight))


def test_gate_fail_on_any_mandatory_fail():
    gate = compute_gate([r("PASS"), r("FAIL"), r("PASS", mandatory=False)])
    assert gate["status"] == "FAIL"
    assert gate["failed_count"] == 1


def test_gate_pass_when_all_mandatory_pass_or_na():
    gate = compute_gate([r("PASS"), r("NOT_APPLICABLE"), r("PASS", mandatory=False, weight="0")])
    assert gate["status"] == "PASS"


def test_gate_pending_when_mandatory_unresolved():
    gate = compute_gate([r("PASS"), r("REVIEW_REQUIRED")])
    assert gate["status"] == "PENDING"
    assert gate["pending_count"] == 1


def test_gate_fail_beats_pending():
    gate = compute_gate([r("FAIL"), r("REVIEW_REQUIRED")])
    assert gate["status"] == "FAIL"


def test_score_basic():
    score = compute_score([r("PASS", weight="60", requirement_id="a"), r("FAIL", weight="40", requirement_id="b")])
    assert score["total"] == "60.00"
    assert score["provisional"] is False


def test_score_excludes_not_applicable():
    score = compute_score([r("PASS", weight="50", requirement_id="a"), r("NOT_APPLICABLE", weight="50", requirement_id="b")])
    assert score["total"] == "100.00"
    assert score["applicable_weight"] == "50"


def test_score_provisional_with_max_achievable():
    score = compute_score([r("PASS", weight="50", requirement_id="a"), r("REVIEW_REQUIRED", weight="50", requirement_id="b")])
    assert score["provisional"] is True
    assert score["total"] == "50.00"
    assert score["max_achievable"] == "100.00"


def test_score_zero_applicable_weight_does_not_divide_by_zero():
    score = compute_score([r("NOT_APPLICABLE", weight="0", requirement_id="a")])
    assert score["total"] == "0"


def test_risk_signals_and_level():
    ctx = BidContext(
        reconciliations=(ReconciliationSnapshot(field="PAN", outcome="CONFLICT", values={}),),
        claims=(ClaimSnapshot(claim_type="BIS_CERTIFICATE_EXP", key=None, value=None, status="EXPIRED", verification_status=None, valid_until=None, freshness_state=None),),
    )
    signals = compute_risk_signals([r("FAIL")], ctx, gate_status="FAIL")
    categories = {s["category"] for s in signals}
    assert "MANDATORY_GATE_FAILED" in categories
    assert "IDENTITY_CONFLICT" in categories
    assert "EXPIRED_EVIDENCE" in categories
    assert risk_level(signals) == "CRITICAL"  # PAN conflict + gate failure both CRITICAL


def test_risk_level_low_with_no_signals():
    assert risk_level([]) == "LOW"


def test_risk_level_picks_highest_severity():
    signals = [{"category": "MISSING_DOCUMENT", "severity": "MEDIUM"}, {"category": "FINANCIAL_EVIDENCE_CONFLICT", "severity": "HIGH"}]
    assert risk_level(signals) == "HIGH"
