// Builds the frozen "bid context" snapshot the engine's pure interpreter evaluates against (spec
// §12.6: "bid_context is a frozen snapshot"). Claims/reconciliation are organisation-scoped, not
// bid-scoped (Phase 3 deviation, docs/PROGRESS.md) — a bid's compliance run reads its bidder
// organisation's current vault state at run time, matching how readiness checks already work.
//
// Deviation: DOCUMENT_EXISTS/DATE_VALIDITY resolve from the bidder's document vault (owner org),
// not bid-attached documents specifically, for the same reason. DATE_VALIDITY always sees
// expiry_date: null today — certificate expiry isn't extracted yet (money/date parsing utilities
// exist from Phase 3 but aren't wired into a CERTIFICATE claim type), so DATE_VALIDITY rules
// resolve via on_missing_evidence until that extraction is built.
import { prisma } from "../../lib/prisma.js";

export interface BidContextClaim {
  claim_type: string;
  key: string | null;
  value: unknown;
  status: string;
  verification_status: string | null;
  valid_until: string | null;
  freshness_state: string | null;
  evidence_ids: string[];
}

export interface BidContextReconciliation {
  field: string;
  outcome: string;
  values: unknown;
  details: unknown;
}

export interface BidContextDocument {
  doc_type: string;
  count: number;
  expiry_date: string | null;
}

export interface BidContextPayload {
  claims: BidContextClaim[];
  reconciliations: BidContextReconciliation[];
  documents: BidContextDocument[];
  tender_flags: Record<string, boolean>;
}

export interface ComplianceContext {
  bidContext: BidContextPayload;
  referenceDate: string; // YYYY-MM-DD
}

export async function buildComplianceContext(bidId: string): Promise<ComplianceContext> {
  const bid = await prisma.bid.findUniqueOrThrow({ where: { id: bidId }, include: { tender: true } });

  const claims = await prisma.claim.findMany({ where: { subjectOrgId: bid.bidderOrgId }, include: { evidence: true } });
  const reconciliations = await prisma.reconciliationResult.findMany({ where: { orgId: bid.bidderOrgId }, orderBy: { createdAt: "desc" } });
  const documents = await prisma.document.findMany({
    where: { ownerOrgId: bid.bidderOrgId, processingStatus: "EXTRACTED", docType: { not: null } },
  });

  // Latest reconciliation row per field wins (reconcile() always inserts a fresh row — spec §13.2 comment in processing.ts).
  const latestByField = new Map<string, (typeof reconciliations)[number]>();
  for (const r of reconciliations) {
    if (!latestByField.has(r.field)) latestByField.set(r.field, r);
  }

  const docCounts = new Map<string, number>();
  for (const d of documents) {
    if (!d.docType) continue;
    docCounts.set(d.docType, (docCounts.get(d.docType) ?? 0) + 1);
  }

  const referenceDate =
    bid.tender.referenceDatePolicy === "BID_DEADLINE" && bid.tender.bidDeadline ? bid.tender.bidDeadline : new Date();

  return {
    referenceDate: referenceDate.toISOString().slice(0, 10),
    bidContext: {
      claims: claims.map((c) => ({
        claim_type: c.claimType,
        key: c.key,
        value: c.value,
        status: c.status,
        verification_status: c.verificationStatus,
        valid_until: c.validUntil ? c.validUntil.toISOString().slice(0, 10) : null,
        freshness_state: c.freshnessState,
        evidence_ids: c.evidence.map((e) => e.id),
      })),
      reconciliations: [...latestByField.values()].map((r) => ({ field: r.field, outcome: r.outcome, values: r.values, details: r.details })),
      documents: [...docCounts.entries()].map(([doc_type, count]) => ({ doc_type, count, expiry_date: null })),
      tender_flags: (bid.tender.flags ?? {}) as Record<string, boolean>,
    },
  };
}
