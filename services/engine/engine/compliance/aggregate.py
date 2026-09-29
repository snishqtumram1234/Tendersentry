"""Mandatory gates, score and (non-relationship) risk signals — pure aggregation over a list of
per-requirement results (spec §15.2-§15.4). Relationship signals (spec §15.6) need to compare a
bid against *other* bids on the same tender, which requires a database query the stateless engine
doesn't have (ADR-004); the API computes those separately and merges them into the risk assessment
before persisting."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .types import BidContext

_APPLICABLE_EXCLUDED = {"NOT_APPLICABLE"}
_GATE_PASSING = {"PASS", "NOT_APPLICABLE"}
_PROVISIONAL_RESULTS = {"REVIEW_REQUIRED", "PENDING_VERIFICATION", "BLOCKED"}


@dataclass
class RequirementResultLike:
    requirement_id: str
    result: str
    mandatory: bool
    weight: Decimal


def compute_gate(results: list[RequirementResultLike]) -> dict[str, Any]:
    mandatory = [r for r in results if r.mandatory]
    failed = [r for r in mandatory if r.result == "FAIL"]
    passed = [r for r in mandatory if r.result in _GATE_PASSING]
    pending = [r for r in mandatory if r.result != "FAIL" and r.result not in _GATE_PASSING]
    if failed:
        status = "FAIL"
    elif not pending:
        status = "PASS"
    else:
        status = "PENDING"
    return {
        "status": status,
        "passed_count": len(passed),
        "failed_count": len(failed),
        "pending_count": len(pending),
    }


def compute_score(results: list[RequirementResultLike]) -> dict[str, Any]:
    applicable = [r for r in results if r.result not in _APPLICABLE_EXCLUDED]
    applicable_weight = sum((r.weight for r in applicable), Decimal(0))
    earned_weight = sum((r.weight for r in applicable if r.result == "PASS"), Decimal(0))
    pending_weight = sum((r.weight for r in applicable if r.result in _PROVISIONAL_RESULTS), Decimal(0))
    provisional = pending_weight > 0

    def pct(numerator: Decimal) -> Decimal:
        if applicable_weight == 0:
            return Decimal(0)
        return (numerator / applicable_weight * Decimal(100)).quantize(Decimal("0.01"))

    breakdown = [
        {
            "requirement_id": r.requirement_id,
            "weight": str(r.weight),
            "earned": str(r.weight if r.result == "PASS" else Decimal(0)),
            "result": r.result,
        }
        for r in results
    ]
    return {
        "total": str(pct(earned_weight)),
        "applicable_weight": str(applicable_weight),
        "earned_weight": str(earned_weight),
        "max_achievable": str(pct(earned_weight + pending_weight)),
        "provisional": provisional,
        "breakdown": breakdown,
    }


# spec §15.4 signal table (relationship signals excluded — computed by the API, see module docstring)
_SEVERITY_MANDATORY_GATE_FAILED = "CRITICAL"
_SEVERITY_PAN_CONFLICT = "CRITICAL"
_SEVERITY_OTHER_IDENTITY_CONFLICT = "HIGH"
_SEVERITY_FINANCIAL_CONFLICT = "HIGH"
_SEVERITY_MANDATORY_CERT_EXPIRED = "HIGH"
_SEVERITY_MISSING_NON_MANDATORY = "MEDIUM"
_SEVERITY_EXPIRING_CERT = "LOW"

_FINANCIAL_CLAIM_TYPES = {"ANNUAL_TURNOVER", "NET_WORTH", "PROFIT_AFTER_TAX"}
_RISK_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}


def compute_risk_signals(results: list[RequirementResultLike], ctx: BidContext, gate_status: str) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []

    if gate_status == "FAIL":
        signals.append({"category": "MANDATORY_GATE_FAILED", "severity": _SEVERITY_MANDATORY_GATE_FAILED, "detail": "A mandatory requirement did not pass."})

    for recon in ctx.reconciliations:
        if recon.outcome != "CONFLICT":
            continue
        if recon.field == "PAN":
            signals.append({"category": "IDENTITY_CONFLICT", "severity": _SEVERITY_PAN_CONFLICT, "detail": "PAN differs across submitted documents.", "field": recon.field})
        elif recon.field in ("GSTIN", "LEGAL_NAME", "REGISTERED_ADDRESS"):
            signals.append({"category": "IDENTITY_CONFLICT", "severity": _SEVERITY_OTHER_IDENTITY_CONFLICT, "detail": f"{recon.field} differs across submitted documents.", "field": recon.field})
        elif recon.field in _FINANCIAL_CLAIM_TYPES:
            signals.append({"category": "FINANCIAL_EVIDENCE_CONFLICT", "severity": _SEVERITY_FINANCIAL_CONFLICT, "detail": f"{recon.field} differs by more than the reconciliation tolerance across sources.", "field": recon.field})

    for claim in ctx.claims:
        if claim.status == "EXPIRED":
            # Simplification: bid_context doesn't currently link a claim back to which specific
            # requirement(s) it supports, so mandatory-vs-non-mandatory can't be distinguished
            # here — every expired claim is treated as the (worse) mandatory case. Revisit once
            # claims carry requirement_ids through to the compliance snapshot.
            signals.append({"category": "EXPIRED_EVIDENCE", "severity": _SEVERITY_MANDATORY_CERT_EXPIRED, "detail": f"{claim.claim_type} evidence has expired.", "field": claim.claim_type})
        elif claim.freshness_state == "EXPIRING":
            signals.append({"category": "EXPIRED_EVIDENCE", "severity": _SEVERITY_EXPIRING_CERT, "detail": f"{claim.claim_type} evidence expires within 30 days.", "field": claim.claim_type})

    for r in results:
        if not r.mandatory and r.result in ("FAIL", "REVIEW_REQUIRED") and r.weight >= 0:
            signals.append({"category": "MISSING_DOCUMENT", "severity": _SEVERITY_MISSING_NON_MANDATORY, "detail": "Non-mandatory evidence missing or unresolved.", "requirement_id": r.requirement_id})

    return signals


def risk_level(signals: list[dict[str, Any]]) -> str:
    if not signals:
        return "LOW"
    return max((s["severity"] for s in signals), key=lambda sev: _RISK_RANK[sev])
