// Bidder profile + evidence vault (spec §13.3, §13.4). The vault reuses the document upload
// pipeline (spec §9.1, already real from Phase 1/3) — a vault item is just that same upload
// tagged with an evidence type and freshness state, so it can be reused across multiple bids
// without re-uploading (spec §13.4).
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { Errors } from "../../lib/errors.js";
import * as documentService from "../documents/service.js";
import type { DocType } from "@prisma/client";
import { computeVerificationLevel } from "./verificationLevel.js";

export async function getBidderProfile(organisationId: string) {
  const [org, profile, directors, addresses, authorisedPersons] = await Promise.all([
    prisma.organisation.findUnique({ where: { id: organisationId } }),
    prisma.bidderProfile.findUnique({ where: { organisationId } }),
    prisma.director.findMany({ where: { organisationId } }),
    prisma.address.findMany({ where: { organisationId } }),
    prisma.authorisedPerson.findMany({ where: { organisationId } }),
  ]);
  if (!org) throw Errors.notFound("Organisation");
  return { organisation: org, profile, directors, addresses, authorisedPersons };
}

/** Recomputes a bidder organisation's verification level/badge from its current claims (spec
 * §13.3) and persists it. Called after anything that can change a claim's standing — extraction,
 * reconciliation (documents/processing.ts), and officer-assisted verification results
 * (verification/service.ts) — so the profile never goes stale between those events. */
export async function recomputeVerificationLevel(tx: Prisma.TransactionClient, organisationId: string): Promise<void> {
  const org = await tx.organisation.findUnique({ where: { id: organisationId }, select: { type: true } });
  if (org?.type !== "BIDDER") return; // claims/documents are also uploaded by government orgs (tender docs) — no bidder profile for those

  const claims = await tx.claim.findMany({ where: { subjectOrgId: organisationId }, orderBy: { createdAt: "desc" } });
  const { level, badgeStatus } = computeVerificationLevel(claims);
  await tx.bidderProfile.upsert({
    where: { organisationId },
    create: { organisationId, verificationLevel: level, badgeStatus },
    update: { verificationLevel: level, badgeStatus },
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_DAYS = 30;

/** Lazily recomputes vault item freshness from validUntil vs now (spec §8.3: "Daily job
 * recomputes"). No job scheduler exists yet (same gap as the rest of the app — no BullMQ/cron
 * infra, docs/PROGRESS.md), so this runs on read instead of on a schedule; the result is the same
 * as long as something reads the vault before the status is relied on, which readiness/bid
 * screens always do. Only touches rows whose computed status actually changed. */
export async function recomputeVaultFreshness(organisationId: string): Promise<void> {
  const items = await prisma.vaultItem.findMany({ where: { organisationId } });
  const now = Date.now();
  for (const item of items) {
    if (item.status === "REVOKED" || !item.validUntil) continue; // REVOKED is a manual officer action, never auto-derived
    const daysRemaining = (item.validUntil.getTime() - now) / MS_PER_DAY;
    const computed = daysRemaining < 0 ? "EXPIRED" : daysRemaining <= EXPIRING_WINDOW_DAYS ? "EXPIRING" : "FRESH";
    if (computed !== item.status && (item.status === "FRESH" || item.status === "EXPIRING" || item.status === "EXPIRED")) {
      await prisma.vaultItem.update({ where: { id: item.id }, data: { status: computed } });
    }
  }
}

export interface AddVaultItemInput {
  organisationId: string;
  uploadedBy: string;
  originalFilename: string;
  buffer: Buffer;
  evidenceType: DocType;
  validFrom?: string;
  validUntil?: string;
}

export async function addVaultItem(input: AddVaultItemInput) {
  const upload = await documentService.uploadDocument({
    ownerOrgId: input.organisationId,
    uploadedBy: input.uploadedBy,
    originalFilename: input.originalFilename,
    buffer: input.buffer,
    declaredType: input.evidenceType,
    envelope: "TECHNICAL",
  });

  const doc = await prisma.document.findUniqueOrThrow({ where: { id: upload.documentId } });

  // Reuse the same vault item if this exact document was already vaulted (matches the upload's
  // own dedupe — spec §13.4: evidence is reused, not duplicated).
  const existing = await prisma.vaultItem.findFirst({ where: { organisationId: input.organisationId, documentId: doc.id } });
  if (existing) return { ...existing, duplicate: true };

  return prisma.$transaction(async (tx) => {
    const item = await tx.vaultItem.create({
      data: {
        organisationId: input.organisationId,
        evidenceType: input.evidenceType,
        documentId: doc.id,
        documentVersion: doc.version,
        status: "FRESH",
        validFrom: input.validFrom ? new Date(input.validFrom) : undefined,
        validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      },
    });
    await writeAudit(tx, {
      action: "VAULT_ITEM_ADDED",
      entityType: "VAULT_ITEM",
      entityId: item.id,
      actorId: input.uploadedBy,
      organisationId: input.organisationId,
      after: { evidenceType: input.evidenceType, documentId: doc.id },
    });
    return { ...item, duplicate: false };
  });
}

export interface ReadinessItem {
  requirementCode: string;
  mandatory: boolean;
  plainEnglish: string | null;
  evidenceTypes: string[];
  status: "AVAILABLE" | "ACTION_NEEDED" | "MISSING";
}

/** Compares a published tender's active rules against the bidder's vault (spec §13.5). Labelled
 * "Preview" by the caller — never "rejected"/"not eligible" (spec §13.5, §26 wording guide): this
 * is a checklist, not a decision, and no interpreter runs yet (that's Phase 4). */
export async function checkReadiness(tenderId: string, organisationId: string): Promise<ReadinessItem[]> {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender || tender.state === "DRAFT" || tender.state === "CANCELLED") throw Errors.notFound("Tender");

  await recomputeVaultFreshness(organisationId);

  const requirements = await prisma.requirement.findMany({
    where: { tenderId, status: "ACTIVE" },
    include: { rules: { include: { versions: true } } },
  });

  const vaultItems = await prisma.vaultItem.findMany({ where: { organisationId } });
  const vaultTypesFresh = new Set(vaultItems.filter((v) => v.status === "FRESH").map((v) => v.evidenceType));
  const vaultTypesAny = new Set(vaultItems.map((v) => v.evidenceType));

  return requirements.map((req) => {
    const active = req.rules[0]?.versions.find((v) => v.status === "ACTIVE" || v.status === "APPROVED");
    const dsl = active?.dsl as { evidence_types?: string[] } | null;
    const evidenceTypes = dsl?.evidence_types ?? [];

    let status: ReadinessItem["status"] = "MISSING";
    if (evidenceTypes.length === 0) {
      status = "ACTION_NEEDED"; // nothing to check against yet — surfaced, not hidden
    } else if (evidenceTypes.every((t) => vaultTypesFresh.has(t as never))) {
      status = "AVAILABLE";
    } else if (evidenceTypes.some((t) => vaultTypesAny.has(t as never))) {
      status = "ACTION_NEEDED"; // present but not fresh, or only some of several types covered
    }

    return {
      requirementCode: req.code,
      mandatory: req.mandatory,
      plainEnglish: active?.plainEnglish ?? null,
      evidenceTypes,
      status,
    };
  });
}

export async function listVaultItems(organisationId: string) {
  await recomputeVaultFreshness(organisationId);
  return prisma.vaultItem.findMany({
    where: { organisationId },
    include: { document: { select: { id: true, originalFilename: true, processingStatus: true, docType: true } } },
    orderBy: { createdAt: "desc" },
  });
}
