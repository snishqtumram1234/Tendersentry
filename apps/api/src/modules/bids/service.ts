// Bid workspace + submission (spec §15.9, walking-slice scope — Phase 3). Documents are attached
// to a bid at its current (draft, version 0) working state; submission snapshots them into an
// immutable BidVersion.manifest with hashes (spec: "bid_versions ... manifest jsonb
// [{document_id, sha256, requirement_codes, envelope}]") — that manifest, not the mutable
// BidDocument rows, is the authoritative historical record spec §7.5 describes.
//
// Deviation (docs/PROGRESS.md): no automatic tender state transitions (spec §8.1's
// PUBLISHED→OPEN_FOR_BIDS scheduler) — a bid can be prepared once the tender is PUBLISHED, without
// waiting for a bid_open_at scheduler that isn't built. No officer package import yet either.
import { randomUUID, createHash } from "node:crypto";
import type { Prisma, Envelope } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { Errors } from "../../lib/errors.js";
import { triggerSubmissionRun } from "../compliance/service.js";

async function nextBidCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.bid.count({ where: { code: { startsWith: `BID-${year}-` } } });
  return `BID-${year}-${String(count + 1).padStart(5, "0")}`;
}

const BIDDABLE_STATES = new Set(["PUBLISHED", "OPEN_FOR_BIDS"]);

export async function createBid(tenderId: string, bidderOrgId: string, actorId: string) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender || !BIDDABLE_STATES.has(tender.state)) throw Errors.notFound("Tender");
  if (tender.bidDeadline && tender.bidDeadline < new Date()) throw Errors.invalidStateTransition("The bid deadline for this tender has passed.");

  const existing = await prisma.bid.findUnique({ where: { tenderId_bidderOrgId: { tenderId, bidderOrgId } } });
  if (existing) return existing;

  // Identity-verification gate: a bidder must have at least Level 1 (identity evidence — spec
  // §13.3) before starting a bid. This is a basic UX gate, not a compliance decision — it never
  // touches mandatory-gate/score logic (Phase 4), which is still the officer's call alone.
  const profile = await prisma.bidderProfile.findUnique({ where: { organisationId: bidderOrgId } });
  if (!profile || profile.verificationLevel < 1) {
    throw Errors.validation("Submit documents and reach identity verification before you can start a bid.", { code: "IDENTITY_NOT_VERIFIED" });
  }

  const code = await nextBidCode();
  return prisma.$transaction(async (tx) => {
    const bid = await tx.bid.create({ data: { code, tenderId, bidderOrgId, state: "DRAFT", createdBy: actorId } });
    await writeAudit(tx, { action: "BID_CREATED", entityType: "BID", entityId: bid.id, actorId, organisationId: bidderOrgId, tenderId, bidId: bid.id });
    return bid;
  });
}

/** Visible to the bid's own bidder organisation and to the tender's government organisation —
 * the same "both sides, nobody else" tenancy rule the compliance module uses. */
export async function getBidForOrg(bidId: string, organisationId: string) {
  const bid = await prisma.bid.findUnique({ where: { id: bidId }, include: { tender: { select: { organisationId: true, title: true, code: true } } } });
  if (!bid || (bid.bidderOrgId !== organisationId && bid.tender.organisationId !== organisationId)) throw Errors.notFound("Bid");
  return bid;
}

/** Claims for a bid's bidder organisation (claims are organisation-scoped, not bid-scoped — Phase
 * 3 finding, same as compliance/context.ts) — lets an officer see what there is to verify without
 * a separate claims-listing endpoint. Same "both sides" tenancy as getBidForOrg. */
export async function listClaimsForBid(bidId: string, organisationId: string) {
  const bid = await getBidForOrg(bidId, organisationId);
  return prisma.claim.findMany({ where: { subjectOrgId: bid.bidderOrgId }, orderBy: { claimType: "asc" } });
}

export async function listBidsForOrg(organisationId: string) {
  return prisma.bid.findMany({ where: { bidderOrgId: organisationId }, include: { tender: { select: { title: true, code: true } } }, orderBy: { createdAt: "desc" } });
}

/** Government-side bid list for a tender (spec §21.2 evaluation dashboard, minimal cut — draft
 * bids are excluded since a bidder's in-progress draft is never visible to the buyer). Financial
 * fields aren't included here at all yet — two-envelope stripping (spec §15.9) is Phase 8. */
export async function listBidsForTender(tenderId: string, organisationId: string) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender || tender.organisationId !== organisationId) throw Errors.notFound("Tender");
  const bids = await prisma.bid.findMany({
    where: { tenderId, state: { not: "DRAFT" } },
    include: { bidderOrg: { select: { legalName: true } } },
    orderBy: { submittedAt: "desc" },
  });
  return bids.map((b) => ({ id: b.id, code: b.code, bidderOrgId: b.bidderOrgId, bidderLegalName: b.bidderOrg.legalName, state: b.state, submittedAt: b.submittedAt }));
}

export interface AttachBidDocumentInput {
  documentId: string;
  envelope: Envelope;
  requirementCodes: string[];
}

export async function attachBidDocument(bidId: string, organisationId: string, actorId: string, input: AttachBidDocumentInput) {
  const bid = await getBidForOrg(bidId, organisationId);
  if (bid.state !== "DRAFT") throw Errors.invalidStateTransition("Documents can only be attached while the bid is in DRAFT.");
  const doc = await prisma.document.findUnique({ where: { id: input.documentId } });
  if (!doc || doc.ownerOrgId !== organisationId) throw Errors.notFound("Document");

  const requirements = await prisma.requirement.findMany({ where: { tenderId: bid.tenderId, code: { in: input.requirementCodes } } });

  return prisma.$transaction(async (tx) => {
    const row = await tx.bidDocument.upsert({
      where: { bidId_bidVersion_documentId: { bidId, bidVersion: 0, documentId: doc.id } },
      create: { bidId, bidVersion: 0, documentId: doc.id, envelope: input.envelope, mappedRequirementIds: requirements.map((r) => r.id) },
      update: { mappedRequirementIds: requirements.map((r) => r.id), envelope: input.envelope },
    });
    await writeAudit(tx, { action: "BID_DOCUMENT_ATTACHED", entityType: "BID", entityId: bidId, actorId, organisationId, tenderId: bid.tenderId, bidId, after: { documentId: doc.id, requirementCodes: input.requirementCodes } });
    return row;
  });
}

export async function listBidDocuments(bidId: string, organisationId: string) {
  const bid = await getBidForOrg(bidId, organisationId);
  return prisma.bidDocument.findMany({
    where: { bidId, bidVersion: bid.currentBidVersion },
    include: { document: { select: { id: true, originalFilename: true, processingStatus: true, docType: true, sha256: true } } },
  });
}

export interface PrecheckItem {
  requirementCode: string;
  mandatory: boolean;
  hasDocument: boolean;
  status: "PASS" | "ACTION_REQUIRED";
}

/** Pre-submission check (spec §21.3): documents present per requirement, never auto-submits. */
export async function precheckBid(bidId: string, organisationId: string): Promise<{ ready: boolean; items: PrecheckItem[] }> {
  const bid = await getBidForOrg(bidId, organisationId);
  const requirements = await prisma.requirement.findMany({ where: { tenderId: bid.tenderId, status: "ACTIVE" } });
  const bidDocs = await prisma.bidDocument.findMany({ where: { bidId, bidVersion: 0 } });
  const mappedRequirementIds = new Set(bidDocs.flatMap((d) => d.mappedRequirementIds));

  const items: PrecheckItem[] = requirements.map((r) => ({
    requirementCode: r.code,
    mandatory: r.mandatory,
    hasDocument: mappedRequirementIds.has(r.id),
    status: mappedRequirementIds.has(r.id) || !r.mandatory ? "PASS" : "ACTION_REQUIRED",
  }));

  return { ready: items.every((i) => i.status === "PASS"), items };
}

export interface SubmitBidInput {
  declarationAccepted: boolean;
}

export async function submitBid(bidId: string, organisationId: string, actorId: string, input: SubmitBidInput) {
  const bid = await getBidForOrg(bidId, organisationId);
  if (bid.state !== "DRAFT") throw Errors.invalidStateTransition(`Bid is already ${bid.state}; it cannot be submitted again.`);
  if (!input.declarationAccepted) throw Errors.validation("The submission declaration must be accepted.");

  const tender = await prisma.tender.findUniqueOrThrow({ where: { id: bid.tenderId } });
  if (tender.bidDeadline && tender.bidDeadline < new Date()) throw Errors.invalidStateTransition("The bid deadline has passed.");

  const bidDocs = await prisma.bidDocument.findMany({ where: { bidId, bidVersion: 0 }, include: { document: true } });
  if (bidDocs.length === 0) throw Errors.validation("At least one document must be attached before submission.");

  const requirementsById = new Map((await prisma.requirement.findMany({ where: { tenderId: bid.tenderId } })).map((r) => [r.id, r.code]));
  const manifest = bidDocs.map((bd) => ({
    documentId: bd.documentId,
    sha256: bd.document.sha256,
    requirementCodes: bd.mappedRequirementIds.map((id) => requirementsById.get(id)).filter(Boolean),
    envelope: bd.envelope,
  }));
  // Canonical (sorted-key) JSON so the manifest hash is deterministic regardless of object key order.
  const manifestHash = createHash("sha256").update(JSON.stringify(manifest, Object.keys(manifest[0] ?? {}).sort())).digest("hex");
  const submissionId = randomUUID();

  const result = await prisma.$transaction(async (tx) => {
    await tx.bidVersion.create({
      data: { bidId, version: 1, reason: "SUBMISSION", manifest: manifest as unknown as Prisma.InputJsonValue, manifestHash },
    });
    const updated = await tx.bid.update({
      where: { id: bidId },
      data: {
        state: "SUBMITTED",
        submittedAt: new Date(),
        submissionId,
        submittedBy: actorId,
        declarationAcceptedAt: new Date(),
        currentBidVersion: 1,
      },
    });
    await writeAudit(tx, {
      action: "BID_SUBMITTED",
      entityType: "BID",
      entityId: bidId,
      actorId,
      organisationId,
      tenderId: bid.tenderId,
      bidId,
      after: { submissionId, manifestHash, documentCount: manifest.length },
    });
    return { ...updated, manifest, manifestHash };
  });

  // Spec §15.1: bid submission is a compliance-run trigger. Best-effort — see
  // triggerSubmissionRun's own doc comment for why a compliance-engine hiccup here never fails
  // an already-valid submission (mirrors the fire-and-forget document processing pattern).
  await triggerSubmissionRun(bidId);

  return result;
}
