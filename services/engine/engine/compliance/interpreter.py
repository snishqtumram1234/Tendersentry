"""Rule DSL interpreter (spec §12.6). `evaluate_rule` is a pure function — no I/O, no clock reads
beyond the `reference_date` argument it is given, no randomness — so the same
`(rule, bid_context, reference_date)` triple always produces byte-identical output (spec §12.6
determinism requirement, exercised by `tests/test_compliance_determinism.py`).

Result values are the seven-state `ComplianceResult` lattice from spec §8.5 / §12.3:
NOT_ASSESSED is never produced here (it's the DB default before a run exists); everything else —
PASS, FAIL, REVIEW_REQUIRED, PENDING_VERIFICATION, NOT_APPLICABLE, BLOCKED — is.

Deviations from the spec text, both because Phase 5 (verification routing) isn't built yet:
- "inputs below min_verification ... PENDING_VERIFICATION if a verification route exists else
  REVIEW_REQUIRED": there is no routing information to consult yet, so a route is assumed to
  always exist and this case always resolves to PENDING_VERIFICATION. Revisit once
  engine.verification.router (Phase 5) can report route existence per claim type.
- DATE_VALIDITY's `valid_on: "EVALUATION_DATE"` is aliased to the same `reference_date` argument
  as `"REFERENCE_DATE"` — a separate evaluation-date concept doesn't exist yet in the compliance
  run contract.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, DivisionByZero, InvalidOperation
from typing import Any

from ..extraction.financial_years import last_n_completed_fy
from .types import (
    CLAIM_STATUS_RANK,
    BidContext,
    ClaimSnapshot,
    SeriesPoint,
    SeriesResolution,
    ValueResolution,
)
from .values import bool_from_value, compare, dec_str, to_decimal

_MAX_DEPTH = 16  # generous re-check; schema validation already caps depth at 8 (spec §12.5)

_ENTITY_TO_CLAIM_TYPE = {"LEGAL_NAME": "LEGAL_NAME", "ADDRESS": "REGISTERED_ADDRESS"}
_MATCHING_OUTCOMES = {"CONSISTENT", "NORMALISED_MATCH"}


class RuleCtx:
    __slots__ = ("on_missing_evidence", "min_verification_rank")

    def __init__(self, rule: dict[str, Any]) -> None:
        self.on_missing_evidence: str = rule["on_missing_evidence"]
        min_verification = rule.get("min_verification")
        self.min_verification_rank: int | None = CLAIM_STATUS_RANK.get(min_verification) if min_verification else None

    def missing_result(self) -> str:
        return self.on_missing_evidence

    def below_floor(self, claim: ClaimSnapshot) -> bool:
        if self.min_verification_rank is None:
            return False
        rank = claim.rank()
        return rank is not None and rank < self.min_verification_rank


def _resolve_valid_on(valid_on: str, reference_date: date) -> date:
    if valid_on in ("REFERENCE_DATE", "EVALUATION_DATE"):
        return reference_date
    return date.fromisoformat(valid_on)


def _resolve_period_labels(period: dict[str, Any], reference_date: date) -> list[str] | None:
    kind = period["kind"]
    if kind == "LAST_N_COMPLETED_FY":
        return [fy.label for fy in last_n_completed_fy(period["n"], reference_date)]
    if kind == "FY_LIST":
        return list(period["fys"])
    return None  # ALL / LAST_N_YEARS_FROM_REFERENCE: no fixed expected label set


# ─────────────────────────────── Series ───────────────────────────────


def evaluate_series(node: dict[str, Any], rule_ctx: RuleCtx, ctx: BidContext, reference_date: date, depth: int = 0) -> SeriesResolution:
    if depth > _MAX_DEPTH:
        raise ValueError("Expression depth exceeded — should have been rejected at schema validation")
    kind = node["node"]

    if kind == "SERIES":
        claim_type = node["claim_type"]
        period = node["period"]
        labels = _resolve_period_labels(period, reference_date)
        points: list[SeriesPoint] = []
        if labels is not None:
            for label in labels:
                matches = [c for c in ctx.claims_of(claim_type) if c.key == label]
                if not matches:
                    points.append(SeriesPoint(label=label, value=None, evidence_ids=[], missing=True))
                    continue
                distinct_values = {to_decimal(m.value) for m in matches}
                if len(distinct_values) > 1 or any(m.is_conflict() for m in matches):
                    points.append(SeriesPoint(label=label, value=None, evidence_ids=[e for m in matches for e in m.evidence_ids], conflict=True))
                    continue
                claim = matches[0]
                value = to_decimal(claim.value)
                points.append(
                    SeriesPoint(
                        label=label,
                        value=value,
                        evidence_ids=list(claim.evidence_ids),
                        missing=value is None,
                        below_min_verification=rule_ctx.below_floor(claim),
                    )
                )
        else:
            matches = list(ctx.claims_of(claim_type))
            if period["kind"] == "LAST_N_YEARS_FROM_REFERENCE":
                cutoff = reference_date.replace(year=reference_date.year - period["n"])

                def _within(m: ClaimSnapshot) -> bool:
                    completion = m.value.get("completion_date") if isinstance(m.value, dict) else None
                    if not completion:
                        return True
                    try:
                        return date.fromisoformat(str(completion)) >= cutoff
                    except ValueError:
                        return True

                matches = [m for m in matches if _within(m)]
            for m in matches:
                value = to_decimal(m.value)
                points.append(
                    SeriesPoint(
                        label=m.key,
                        value=value,
                        evidence_ids=list(m.evidence_ids),
                        missing=value is None and not m.is_conflict(),
                        conflict=m.is_conflict(),
                        below_min_verification=rule_ctx.below_floor(m),
                    )
                )
        incomplete = labels is not None and any(p.missing for p in points)
        trace: dict[str, Any] = {"node": "SERIES", "claim_type": claim_type, "period": period, "points": [_point_trace(p) for p in points]}
        return SeriesResolution(points=points, trace=trace, incomplete=incomplete)

    if kind == "TOP_N":
        inner = evaluate_series(node["series"], rule_ctx, ctx, reference_date, depth + 1)
        ranked = [p for p in inner.points if not p.missing and not p.conflict]
        ranked.sort(key=lambda p: p.value if p.value is not None else Decimal(0), reverse=(node["order"] == "DESC"))
        selected = ranked[: node["n"]]
        trace = {"node": "TOP_N", "n": node["n"], "order": node["order"], "series": inner.trace, "selected": [_point_trace(p) for p in selected]}
        return SeriesResolution(points=selected, trace=trace, incomplete=False)

    if kind == "FILTER":
        inner = evaluate_series(node["series"], rule_ctx, ctx, reference_date, depth + 1)
        threshold = evaluate_value(node["value"], rule_ctx, ctx, reference_date, depth + 1)
        if threshold.value is None:
            kept: list[SeriesPoint] = []
        else:
            threshold_value = threshold.value
            kept = [p for p in inner.points if not p.missing and not p.conflict and p.value is not None and compare(node["op"], p.value, threshold_value)]
        trace = {"node": "FILTER", "op": node["op"], "value": threshold.trace, "series": inner.trace, "kept": [_point_trace(p) for p in kept]}
        return SeriesResolution(points=kept, trace=trace, incomplete=False)

    raise ValueError(f"Unknown series node: {kind}")


def _point_trace(p: SeriesPoint) -> dict[str, Any]:
    return {
        "label": p.label,
        "value": dec_str(p.value),
        "missing": p.missing,
        "conflict": p.conflict,
        "below_min_verification": p.below_min_verification,
        "evidence_ids": p.evidence_ids,
    }


# ─────────────────────────────── Values ───────────────────────────────


def evaluate_value(node: dict[str, Any], rule_ctx: RuleCtx, ctx: BidContext, reference_date: date, depth: int = 0) -> ValueResolution:
    if depth > _MAX_DEPTH:
        raise ValueError("Expression depth exceeded — should have been rejected at schema validation")
    kind = node["node"]

    if kind == "CONST":
        value = to_decimal(node["value"])
        return ValueResolution(value=value, unit=node.get("unit"), evidence_ids=[], trace={"node": "CONST", "value": node["value"], "result": dec_str(value)})

    if kind == "FIELD":
        claim_type = node["claim_type"]
        period = node.get("period")
        label: str | None = None
        if period is not None:
            labels = _resolve_period_labels(period, reference_date)
            if labels:
                label = labels[-1]  # most recent period in the requested window
        claim = ctx.claim(claim_type, key=label)
        if claim is None:
            return ValueResolution(value=None, unit=None, evidence_ids=[], missing=True, trace={"node": "FIELD", "claim_type": claim_type, "period": period, "result": None})
        if claim.is_conflict():
            return ValueResolution(value=None, unit=None, evidence_ids=list(claim.evidence_ids), conflict=True, trace={"node": "FIELD", "claim_type": claim_type, "period": period, "conflict": True})
        value = to_decimal(claim.value)
        return ValueResolution(
            value=value,
            unit=None,
            evidence_ids=list(claim.evidence_ids),
            missing=value is None,
            below_min_verification=rule_ctx.below_floor(claim),
            trace={"node": "FIELD", "claim_type": claim_type, "period": period, "result": dec_str(value)},
        )

    if kind == "AGG":
        series = evaluate_series(node["series"], rule_ctx, ctx, reference_date, depth + 1)
        fn = node["fn"]
        evidence_ids = sorted({e for p in series.points for e in p.evidence_ids})
        if any(p.conflict for p in series.points):
            return ValueResolution(value=None, unit=None, evidence_ids=evidence_ids, conflict=True, trace={"node": "AGG", "fn": fn, "series": series.trace})
        below_floor = any(p.below_min_verification for p in series.points if not p.missing)
        valid: list[Decimal] = [p.value for p in series.points if not p.missing and not p.conflict and p.value is not None]
        if fn == "COUNT":
            value = Decimal(len(valid))
        elif series.incomplete or not valid:
            value = None
        elif fn == "SUM":
            value = sum(valid, Decimal(0))
        elif fn == "AVERAGE":
            value = sum(valid, Decimal(0)) / Decimal(len(valid))
        elif fn == "MIN":
            value = min(valid)
        elif fn == "MAX":
            value = max(valid)
        else:
            raise ValueError(f"Unknown AGG fn: {fn}")
        missing = value is None
        return ValueResolution(value=value, unit=None, evidence_ids=evidence_ids, missing=missing, below_min_verification=below_floor, trace={"node": "AGG", "fn": fn, "series": series.trace, "result": dec_str(value)})

    if kind in ("RATIO", "PERCENTAGE"):
        num_node, den_node = (node["num"], node["den"]) if kind == "RATIO" else (node["part"], node["whole"])
        num = evaluate_value(num_node, rule_ctx, ctx, reference_date, depth + 1)
        den = evaluate_value(den_node, rule_ctx, ctx, reference_date, depth + 1)
        evidence_ids = sorted(set(num.evidence_ids) | set(den.evidence_ids))
        trace = {"node": kind, "left": num.trace, "right": den.trace}
        if num.missing or den.missing:
            return ValueResolution(value=None, unit=None, evidence_ids=evidence_ids, missing=True, trace=trace)
        if num.conflict or den.conflict:
            return ValueResolution(value=None, unit=None, evidence_ids=evidence_ids, conflict=True, trace=trace)
        try:
            ratio = num.value / den.value  # type: ignore[operator]
        except (DivisionByZero, InvalidOperation, ZeroDivisionError):
            return ValueResolution(value=None, unit=None, evidence_ids=evidence_ids, conflict=True, trace={**trace, "error": "division_by_zero"})
        value = ratio * Decimal(100) if kind == "PERCENTAGE" else ratio
        below_floor = num.below_min_verification or den.below_min_verification
        trace["result"] = dec_str(value)
        return ValueResolution(value=value, unit="PERCENT" if kind == "PERCENTAGE" else None, evidence_ids=evidence_ids, below_min_verification=below_floor, trace=trace)

    raise ValueError(f"Unknown value node: {kind}")


# ─────────────────────────────── Booleans ───────────────────────────────


def _drop_not_applicable(results: list[str]) -> list[str]:
    return [r for r in results if r != "NOT_APPLICABLE"]


def evaluate_boolean(node: dict[str, Any], rule_ctx: RuleCtx, ctx: BidContext, reference_date: date, depth: int = 0) -> tuple[str, dict[str, Any], list[str]]:
    if depth > _MAX_DEPTH:
        raise ValueError("Expression depth exceeded — should have been rejected at schema validation")
    kind = node["node"]

    if kind == "AND":
        children = [evaluate_boolean(a, rule_ctx, ctx, reference_date, depth + 1) for a in node["args"]]
        kept = _drop_not_applicable([c[0] for c in children])
        evidence_ids = sorted({e for c in children for e in c[2]})
        trace: dict[str, Any] = {"node": "AND", "args": [c[1] for c in children]}
        if not kept:
            result = "NOT_APPLICABLE"
        elif "FAIL" in kept:
            result = "FAIL"
        elif "BLOCKED" in kept:
            result = "BLOCKED"
        elif "REVIEW_REQUIRED" in kept:
            result = "REVIEW_REQUIRED"
        elif "PENDING_VERIFICATION" in kept:
            result = "PENDING_VERIFICATION"
        else:
            result = "PASS"
        trace["result"] = result
        return result, trace, evidence_ids

    if kind == "OR":
        children = [evaluate_boolean(a, rule_ctx, ctx, reference_date, depth + 1) for a in node["args"]]
        kept = _drop_not_applicable([c[0] for c in children])
        evidence_ids = sorted({e for c in children for e in c[2]})
        trace = {"node": "OR", "args": [c[1] for c in children]}
        if not kept:
            result = "NOT_APPLICABLE"
        elif "PASS" in kept:
            result = "PASS"
        elif "BLOCKED" in kept:
            result = "BLOCKED"
        elif "REVIEW_REQUIRED" in kept:
            result = "REVIEW_REQUIRED"
        elif "PENDING_VERIFICATION" in kept:
            result = "PENDING_VERIFICATION"
        else:
            result = "FAIL"
        trace["result"] = result
        return result, trace, evidence_ids

    if kind == "NOT":
        inner_result, inner_trace, evidence_ids = evaluate_boolean(node["arg"], rule_ctx, ctx, reference_date, depth + 1)
        result = {"PASS": "FAIL", "FAIL": "PASS"}.get(inner_result, inner_result)
        return result, {"node": "NOT", "arg": inner_trace, "result": result}, evidence_ids

    if kind == "IF":
        cond_result, cond_trace, cond_evidence = evaluate_boolean(node["cond"], rule_ctx, ctx, reference_date, depth + 1)
        if cond_result == "PASS":
            branch_result, branch_trace, branch_evidence = evaluate_boolean(node["then"], rule_ctx, ctx, reference_date, depth + 1)
            trace = {"node": "IF", "cond": cond_trace, "branch": "then", "then": branch_trace, "result": branch_result}
            return branch_result, trace, sorted(set(cond_evidence) | set(branch_evidence))
        if cond_result == "FAIL":
            if "else" in node:
                branch_result, branch_trace, branch_evidence = evaluate_boolean(node["else"], rule_ctx, ctx, reference_date, depth + 1)
                trace = {"node": "IF", "cond": cond_trace, "branch": "else", "else": branch_trace, "result": branch_result}
                return branch_result, trace, sorted(set(cond_evidence) | set(branch_evidence))
            trace = {"node": "IF", "cond": cond_trace, "branch": "else", "result": "NOT_APPLICABLE"}
            return "NOT_APPLICABLE", trace, cond_evidence
        trace = {"node": "IF", "cond": cond_trace, "branch": "cond", "result": cond_result}
        return cond_result, trace, cond_evidence

    if kind == "COMPARE":
        left = evaluate_value(node["left"], rule_ctx, ctx, reference_date, depth + 1)
        right = evaluate_value(node["right"], rule_ctx, ctx, reference_date, depth + 1)
        evidence_ids = sorted(set(left.evidence_ids) | set(right.evidence_ids))
        trace = {"node": "COMPARE", "op": node["op"], "left": left.trace, "right": right.trace}
        if left.missing or right.missing:
            result = rule_ctx.missing_result()
        elif left.conflict or right.conflict:
            result = "REVIEW_REQUIRED"
        elif left.below_min_verification or right.below_min_verification:
            result = "PENDING_VERIFICATION"
        else:
            result = "PASS" if compare(node["op"], left.value, right.value) else "FAIL"  # type: ignore[arg-type]
        trace["result"] = result
        return result, trace, evidence_ids

    if kind == "DOCUMENT_EXISTS":
        doc_type = node["doc_type"]
        min_count = node.get("min_count", 1)
        count = ctx.document_count(doc_type)
        result = "PASS" if count >= min_count else rule_ctx.missing_result()
        trace = {"node": "DOCUMENT_EXISTS", "doc_type": doc_type, "min_count": min_count, "count": count, "result": result}
        return result, trace, []

    if kind == "DATE_VALIDITY":
        doc = ctx.document(node["doc_type"])
        min_days = node.get("min_days_remaining", 0)
        if doc is None or doc.expiry_date is None:
            result = rule_ctx.missing_result()
            trace = {"node": "DATE_VALIDITY", "doc_type": node["doc_type"], "result": result}
            return result, trace, []
        valid_on = _resolve_valid_on(node["valid_on"], reference_date)
        days_remaining = (doc.expiry_date - valid_on).days
        result = "PASS" if days_remaining >= min_days else "FAIL"
        trace = {"node": "DATE_VALIDITY", "doc_type": node["doc_type"], "valid_on": str(valid_on), "expiry": str(doc.expiry_date), "days_remaining": days_remaining, "result": result}
        return result, trace, []

    if kind in ("FIELD_MATCH", "ENTITY_MATCH"):
        field_name = node["field"] if kind == "FIELD_MATCH" else _ENTITY_TO_CLAIM_TYPE[node["entity"]]
        recon = ctx.reconciliation_for(field_name)
        if recon is None or recon.outcome == "INSUFFICIENT_EVIDENCE":
            result = rule_ctx.missing_result()
        elif recon.outcome in _MATCHING_OUTCOMES:
            result = "PASS"
        elif recon.outcome == "CONFLICT":
            # Spec §12.3's general principle for COMPARE ("if any input evidence is CONFLICT →
            # REVIEW_REQUIRED") is applied here too: a genuine cross-document conflict needs an
            # officer's judgment, not a silent automatic FAIL.
            result = "REVIEW_REQUIRED"
        else:
            result = "FAIL"
        trace = {"node": kind, "field": field_name, "outcome": recon.outcome if recon else None, "result": result}
        return result, trace, []

    if kind == "SOURCE_VERIFIED":
        claim = ctx.claim(node["claim_type"])
        min_rank = CLAIM_STATUS_RANK[node["min_status"]]
        if claim is None:
            result = rule_ctx.missing_result()
        elif claim.is_conflict():
            result = "REVIEW_REQUIRED"
        else:
            rank = claim.rank()
            if rank is None:
                result = "REVIEW_REQUIRED"
            elif rank >= min_rank:
                result = "PASS"
            else:
                result = "PENDING_VERIFICATION"
        trace = {"node": "SOURCE_VERIFIED", "claim_type": node["claim_type"], "min_status": node["min_status"], "status": claim.effective_status() if claim else None, "result": result}
        return result, trace, list(claim.evidence_ids) if claim else []

    if kind == "THRESHOLD_COUNT":
        series = evaluate_series(node["series"], rule_ctx, ctx, reference_date, depth + 1)
        threshold = evaluate_value(node["value"], rule_ctx, ctx, reference_date, depth + 1)
        evidence_ids = sorted({e for p in series.points for e in p.evidence_ids} | set(threshold.evidence_ids))
        if not series.points:
            result = rule_ctx.missing_result()
        elif any(p.conflict for p in series.points) or threshold.value is None:
            result = "REVIEW_REQUIRED"
        else:
            threshold_value = threshold.value
            matching = sum(1 for p in series.points if not p.missing and p.value is not None and compare(node["op"], p.value, threshold_value))
            result = "PASS" if matching >= node["min_count"] else "FAIL"
        trace = {"node": "THRESHOLD_COUNT", "op": node["op"], "min_count": node["min_count"], "series": series.trace, "value": threshold.trace, "result": result}
        return result, trace, evidence_ids

    if kind == "CLAIM_TRUE":
        claim = ctx.claim(node["claim_type"])
        if claim is None:
            result = rule_ctx.missing_result()
        elif claim.is_conflict():
            result = "REVIEW_REQUIRED"
        elif not bool_from_value(claim.value):
            result = "FAIL"
        elif rule_ctx.below_floor(claim):
            result = "PENDING_VERIFICATION"
        else:
            result = "PASS"
        trace = {"node": "CLAIM_TRUE", "claim_type": node["claim_type"], "result": result}
        return result, trace, list(claim.evidence_ids) if claim else []

    if kind == "TENDER_FLAG":
        flag_value = bool(ctx.tender_flags.get(node["flag"], False))
        result = "PASS" if flag_value else "FAIL"
        trace = {"node": "TENDER_FLAG", "flag": node["flag"], "value": flag_value, "result": result}
        return result, trace, []

    raise ValueError(f"Unknown boolean node: {kind}")


# ─────────────────────────────── Rule-level entry point ───────────────────────────────


def evaluate_rule(rule: dict[str, Any], ctx: BidContext, reference_date: date) -> dict[str, Any]:
    """Evaluates one APPROVED/ACTIVE rule version against a bid context. Returns a plain,
    JSON-serialisable dict (the RequirementResult shape the API persists), never raising for
    missing/conflicting evidence — only for a malformed rule, which should never reach here since
    only schema+semantically valid rules are approved (spec §12.5)."""
    rule_ctx = RuleCtx(rule)

    for exemption in rule.get("exemptions", []):
        when_result, when_trace, when_evidence = evaluate_boolean(exemption["when"], rule_ctx, ctx, reference_date)
        if when_result != "PASS":
            continue
        required_types = exemption.get("requires_evidence", [])
        ex_min_rank = CLAIM_STATUS_RANK.get(exemption.get("min_verification")) if exemption.get("min_verification") else None
        evidence_ok = True
        extra_evidence: list[str] = []
        for claim_type in required_types:
            claim = ctx.claim(claim_type)
            if claim is None or claim.is_conflict():
                evidence_ok = False
                break
            if ex_min_rank is not None:
                rank = claim.rank()
                if rank is None or rank < ex_min_rank:
                    evidence_ok = False
                    break
            extra_evidence.extend(claim.evidence_ids)
        if not evidence_ok:
            continue
        result = exemption["effect"]
        trace = {"node": "EXEMPTION", "code": exemption["code"], "when": when_trace, "result": result}
        return _build_result(rule, result, trace, sorted(set(when_evidence) | set(extra_evidence)))

    result, trace, evidence_ids = evaluate_boolean(rule["expression"], rule_ctx, ctx, reference_date)
    return _build_result(rule, result, trace, evidence_ids)


def _build_result(rule: dict[str, Any], result: str, trace: dict[str, Any], evidence_ids: list[str]) -> dict[str, Any]:
    weight = Decimal(str(rule.get("weight", 0) or 0))
    earned = weight if result == "PASS" else Decimal(0)
    return {
        "rule_code": rule["rule_code"],
        "result": result,
        "mandatory": bool(rule["mandatory"]),
        "weight": str(weight),
        "earned_weight": str(earned),
        "trace": trace,
        "evidence_ids": evidence_ids,
        "plain_english": rule.get("plain_english"),
    }
