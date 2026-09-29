"""Input/output contract for the compliance interpreter (spec §12.6). `BidContext` is a frozen
snapshot: the API builds it from claims/evidence/reconciliation results at run time and the
interpreter never queries anything else (ADR-004 — engine has no DB access)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

# Ranking used by SOURCE_VERIFIED / min_verification comparisons — mirrors the ClaimStatus
# progression in spec §8.3 (the "normal" ladder; CONFLICT/REVIEW_REQUIRED/etc. are handled
# separately, never ranked here).
CLAIM_STATUS_RANK: dict[str, int] = {
    "DOCUMENT_UPLOADED": 0,
    "FIELD_EXTRACTED": 1,
    "STRUCTURALLY_VALID": 2,
    "DOCUMENT_SUPPORTED": 3,
    "RECONCILED": 4,
    "AUTHORITATIVE_VERIFIED": 5,
}
_UNRANKED_STATUSES = {"CONFLICT", "REVIEW_REQUIRED", "UNVERIFIABLE", "EXPIRED", "REVOKED"}


@dataclass(frozen=True)
class ClaimSnapshot:
    """One claim as seen by the interpreter. `key` distinguishes periodic entries (e.g. an FY
    label for ANNUAL_TURNOVER) from the single claim of a non-periodic type."""

    claim_type: str
    key: str | None
    value: Any
    status: str  # ClaimStatus
    verification_status: str | None
    valid_until: date | None
    freshness_state: str | None
    evidence_ids: tuple[str, ...] = ()

    def effective_status(self) -> str:
        return self.verification_status or self.status

    def is_conflict(self) -> bool:
        return self.effective_status() == "CONFLICT"

    def rank(self) -> int | None:
        status = self.effective_status()
        return CLAIM_STATUS_RANK.get(status)


@dataclass(frozen=True)
class ReconciliationSnapshot:
    field: str
    outcome: str  # ReconciliationOutcome
    values: Any
    details: Any = None


@dataclass(frozen=True)
class DocumentSummary:
    doc_type: str
    count: int
    expiry_date: date | None = None


@dataclass(frozen=True)
class BidContext:
    claims: tuple[ClaimSnapshot, ...] = ()
    reconciliations: tuple[ReconciliationSnapshot, ...] = ()
    documents: tuple[DocumentSummary, ...] = ()
    tender_flags: dict[str, bool] = field(default_factory=dict)

    def claims_of(self, claim_type: str) -> list[ClaimSnapshot]:
        return [c for c in self.claims if c.claim_type == claim_type]

    def claim(self, claim_type: str, key: str | None = None) -> ClaimSnapshot | None:
        matches = [c for c in self.claims_of(claim_type) if c.key == key]
        return matches[0] if matches else None

    def reconciliation_for(self, field_name: str) -> ReconciliationSnapshot | None:
        matches = [r for r in self.reconciliations if r.field == field_name]
        return matches[0] if matches else None

    def document_count(self, doc_type: str) -> int:
        return sum(d.count for d in self.documents if d.doc_type == doc_type)

    def document(self, doc_type: str) -> DocumentSummary | None:
        matches = [d for d in self.documents if d.doc_type == doc_type]
        return matches[0] if matches else None


@dataclass
class ValueResolution:
    """Result of evaluating a Value node — never raises on missing/conflicting data; the caller
    (COMPARE et al.) decides how to translate that into a three-valued Result."""

    value: Decimal | None
    unit: str | None
    evidence_ids: list[str]
    trace: dict[str, Any]
    missing: bool = False
    conflict: bool = False
    below_min_verification: bool = False


@dataclass
class SeriesPoint:
    label: str | None
    value: Decimal | None
    evidence_ids: list[str]
    missing: bool = False
    conflict: bool = False
    below_min_verification: bool = False


@dataclass
class SeriesResolution:
    points: list[SeriesPoint]
    trace: dict[str, Any]
    incomplete: bool = False  # expected N periods but fewer resolved (non-missing) points


RESULT_ORDER_AND = ["FAIL", "BLOCKED", "REVIEW_REQUIRED", "PENDING_VERIFICATION", "PASS"]
RESULT_ORDER_OR = ["PASS", "BLOCKED", "REVIEW_REQUIRED", "PENDING_VERIFICATION", "FAIL"]
