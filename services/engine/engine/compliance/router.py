"""Rule DSL interpreter, three-valued logic, mandatory gates, score, risk (spec §12, §15).

The interpreter itself (engine.compliance.interpreter) is a pure function with no I/O (spec
§12.6) — this router just adapts JSON in, calls it, and returns JSON out. It persists nothing;
the API owns persistence of compliance_runs, per ADR-004."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from engine.common.auth import require_engine_token

from .aggregate import RequirementResultLike, compute_gate, compute_risk_signals, compute_score
from .interpreter import evaluate_rule
from .types import BidContext, ClaimSnapshot, DocumentSummary, ReconciliationSnapshot

router = APIRouter(prefix="/compliance", tags=["compliance"], dependencies=[Depends(require_engine_token)])


class RuleInput(BaseModel):
    requirement_id: str
    rule_version_id: str
    dsl: dict[str, Any]


class ClaimInput(BaseModel):
    claim_type: str
    key: str | None = None
    value: Any = None
    status: str
    verification_status: str | None = None
    valid_until: date | None = None
    freshness_state: str | None = None
    evidence_ids: list[str] = []


class ReconciliationInput(BaseModel):
    field: str
    outcome: str
    values: Any = None
    details: Any = None


class DocumentInput(BaseModel):
    doc_type: str
    count: int
    expiry_date: date | None = None


class BidContextInput(BaseModel):
    claims: list[ClaimInput] = []
    reconciliations: list[ReconciliationInput] = []
    documents: list[DocumentInput] = []
    tender_flags: dict[str, bool] = {}


class EvaluateRequest(BaseModel):
    reference_date: date
    rules: list[RuleInput]
    bid_context: BidContextInput


def _to_bid_context(payload: BidContextInput) -> BidContext:
    return BidContext(
        claims=tuple(
            ClaimSnapshot(
                claim_type=c.claim_type,
                key=c.key,
                value=c.value,
                status=c.status,
                verification_status=c.verification_status,
                valid_until=c.valid_until,
                freshness_state=c.freshness_state,
                evidence_ids=tuple(c.evidence_ids),
            )
            for c in payload.claims
        ),
        reconciliations=tuple(ReconciliationSnapshot(field=r.field, outcome=r.outcome, values=r.values, details=r.details) for r in payload.reconciliations),
        documents=tuple(DocumentSummary(doc_type=d.doc_type, count=d.count, expiry_date=d.expiry_date) for d in payload.documents),
        tender_flags=dict(payload.tender_flags),
    )


@router.post("/evaluate")
async def evaluate(payload: EvaluateRequest) -> dict:
    ctx = _to_bid_context(payload.bid_context)
    results: list[dict[str, Any]] = []
    for rule_input in payload.rules:
        outcome = evaluate_rule(rule_input.dsl, ctx, payload.reference_date)
        results.append({"requirementId": rule_input.requirement_id, "ruleVersionId": rule_input.rule_version_id, **outcome})

    result_likes = [
        RequirementResultLike(requirement_id=r["requirementId"], result=r["result"], mandatory=r["mandatory"], weight=Decimal(r["weight"]))
        for r in results
    ]
    gate = compute_gate(result_likes)
    score = compute_score(result_likes)
    risk_signals = compute_risk_signals(result_likes, ctx, gate["status"])

    return {
        "results": [
            {
                "requirementId": r["requirementId"],
                "ruleVersionId": r["ruleVersionId"],
                "result": r["result"],
                "mandatory": r["mandatory"],
                "weight": r["weight"],
                "earnedWeight": r["earned_weight"],
                "trace": r["trace"],
                "evidenceIds": r["evidence_ids"],
                "explanation": r["plain_english"],
            }
            for r in results
        ],
        "gate": {"status": gate["status"], "passedCount": gate["passed_count"], "failedCount": gate["failed_count"], "pendingCount": gate["pending_count"]},
        "score": {
            "total": score["total"],
            "applicableWeight": score["applicable_weight"],
            "earnedWeight": score["earned_weight"],
            "maxAchievable": score["max_achievable"],
            "provisional": score["provisional"],
            "breakdown": score["breakdown"],
        },
        "riskSignals": risk_signals,
    }
