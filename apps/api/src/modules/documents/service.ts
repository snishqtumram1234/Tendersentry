// Document upload/access (spec §9.1, §6.5). Async processing (OCR, extraction, classification) is
// queued for the engine in later phases; this covers the synchronous part: validate → hash → dedupe
// → store → record → audit.
import { createHash, randomUUID } from "node:crypto";
import type { DocType, Envelope } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { Errors } from "../../lib/errors.js";
import { putObject, signedDownloadUrl, BUCKETS } from "../../lib/storage.js";
import { validateUploadedFile } from "./validation.js";
import { processDocument } from "./processing.js";

export interface UploadInput {
  ownerOrgId: string;
  uploadedBy: string;
  originalFilename: string;
  buffer: Buffer;
  declaredType?: DocType;
  envelope?: Envelope;
}

export interface UploadResult {
  documentId: string;
  duplicate: boolean;
  processingStatus: string;
}

export async function uploadDocument(input: UploadInput): Promise<UploadResult> {
  const { mime, sizeBytes } = validateUploadedFile(input.originalFilename, input.buffer);
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");

  // Dedupe within the same organisation (spec §9.1): reuse the existing row, skip re-upload.
  const existing = await prisma.document.findFirst({
    where: { ownerOrgId: input.ownerOrgId, sha256 },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return { documentId: existing.id, duplicate: true, processingStatus: existing.processingStatus };
  }

  const storageKey = `${input.ownerOrgId}/${randomUUID()}/${input.originalFilename}`;
  await putObject(BUCKETS.documents, storageKey, input.buffer, mime);

  const document = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        ownerOrgId: input.ownerOrgId,
        uploadedBy: input.uploadedBy,
        originalFilename: input.originalFilename,
        mime,
        sizeBytes: BigInt(sizeBytes),
        sha256,
        storageBucket: BUCKETS.documents,
        storageKey,
        declaredType: input.declaredType,
        envelope: input.envelope ?? "TECHNICAL",
        processingStatus: "UPLOADED",
      },
    });
    await writeAudit(tx, {
      action: "DOCUMENT_UPLOADED",
      entityType: "DOCUMENT",
      entityId: doc.id,
      actorId: input.uploadedBy,
      organisationId: input.ownerOrgId,
      after: { originalFilename: doc.originalFilename, sha256: doc.sha256, sizeBytes: sizeBytes },
    });
    // Phase 0/1: no BullMQ wiring yet (Redis not provisioned in this environment) — record the
    // work item so GET /jobs/:id and the admin jobs monitor (spec §4.4, §21.4) have something real
    // to show, and process it fire-and-forget right after upload instead of via a worker.
    // TODO Phase 3+: move to a real BullMQ `document_processing` queue once Redis is available.
    await tx.job.create({
      data: {
        queue: "document_processing",
        entityType: "DOCUMENT",
        entityId: doc.id,
        organisationId: input.ownerOrgId,
        status: "QUEUED",
      },
    });
    return doc;
  });

  // Never block the upload response on extraction (spec §4.4) — fire-and-forget, errors are
  // captured on the document/job rows themselves, not thrown here.
  void processDocument(document.id).catch((err) => {
    console.error(`processDocument(${document.id}) failed:`, err);
  });

  return { documentId: document.id, duplicate: false, processingStatus: document.processingStatus };
}

export interface DocumentMeta {
  id: string;
  originalFilename: string;
  mime: string;
  sizeBytes: string;
  sha256: string;
  processingStatus: string;
  failureCode: string | null;
  pageCount: number | null;
  textLayer: string | null;
  docType: string | null;
  declaredType: string | null;
  envelope: string;
  createdAt: Date;
}

/** Loads a document's metadata, scoped to the caller's organisation (spec §6.5). */
export async function getDocumentForOrg(documentId: string, organisationId: string): Promise<DocumentMeta> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.ownerOrgId !== organisationId) throw Errors.notFound("Document");
  return {
    id: doc.id,
    originalFilename: doc.originalFilename,
    mime: doc.mime,
    sizeBytes: doc.sizeBytes.toString(),
    sha256: doc.sha256,
    processingStatus: doc.processingStatus,
    failureCode: doc.failureCode,
    pageCount: doc.pageCount,
    textLayer: doc.textLayer,
    docType: doc.docType,
    declaredType: doc.declaredType,
    envelope: doc.envelope,
    createdAt: doc.createdAt,
  };
}

/** Lists an organisation's documents, newest first (Phase 1: no tender/bid scoping yet). */
export async function listDocumentsForOrg(organisationId: string): Promise<DocumentMeta[]> {
  const docs = await prisma.document.findMany({ where: { ownerOrgId: organisationId }, orderBy: { createdAt: "desc" } });
  return docs.map((doc) => ({
    id: doc.id,
    originalFilename: doc.originalFilename,
    mime: doc.mime,
    sizeBytes: doc.sizeBytes.toString(),
    sha256: doc.sha256,
    processingStatus: doc.processingStatus,
    failureCode: doc.failureCode,
    pageCount: doc.pageCount,
    textLayer: doc.textLayer,
    docType: doc.docType,
    declaredType: doc.declaredType,
    envelope: doc.envelope,
    createdAt: doc.createdAt,
  }));
}

export interface FieldMeta {
  id: string;
  field: string;
  valueRaw: string;
  pageNo: number;
  bbox: unknown;
  confidence: string;
  method: string;
}

/** Extracted fields for one document, with page + bbox provenance (spec §9.1, §19). */
export async function getDocumentFields(documentId: string, organisationId: string): Promise<FieldMeta[]> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.ownerOrgId !== organisationId) throw Errors.notFound("Document");
  const fields = await prisma.extractedField.findMany({ where: { documentId }, orderBy: [{ pageNo: "asc" }, { field: "asc" }] });
  return fields.map((f) => ({ id: f.id, field: f.field, valueRaw: f.valueRaw, pageNo: f.pageNo, bbox: f.bbox, confidence: f.confidence.toString(), method: f.method }));
}

export interface ClaimWithEvidence {
  claimId: string;
  claimType: string;
  value: unknown;
  status: string;
  evidence: {
    evidenceId: string;
    documentId: string | null;
    documentFilename: string | null;
    pageNo: number | null;
    bbox: unknown;
    excerpt: string | null;
    isThisDocument: boolean;
  }[];
  reconciliation: { outcome: string; values: unknown; createdAt: Date } | null;
}

/** Every claim that has evidence in this document, with ALL of that claim's evidence (across
 * documents) and the latest reconciliation result — everything the Evidence Workbench viewer
 * needs in one call (spec §21.2 "Evidence Workbench", walking-skeleton scope). */
export async function getDocumentClaims(documentId: string, organisationId: string): Promise<ClaimWithEvidence[]> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.ownerOrgId !== organisationId) throw Errors.notFound("Document");

  const evidenceHere = await prisma.evidence.findMany({ where: { documentId }, select: { claimId: true } });
  const claimIds = [...new Set(evidenceHere.map((e) => e.claimId))];
  if (claimIds.length === 0) return [];

  const claims = await prisma.claim.findMany({
    where: { id: { in: claimIds } },
    include: { evidence: { include: { document: { select: { id: true, originalFilename: true } } } } },
  });

  const results: ClaimWithEvidence[] = [];
  for (const claim of claims) {
    const reconciliation = await prisma.reconciliationResult.findFirst({
      where: { orgId: organisationId, field: claim.claimType },
      orderBy: { createdAt: "desc" },
    });
    results.push({
      claimId: claim.id,
      claimType: claim.claimType,
      value: claim.value,
      status: claim.status,
      evidence: claim.evidence.map((e) => ({
        evidenceId: e.id,
        documentId: e.documentId,
        documentFilename: e.document?.originalFilename ?? null,
        pageNo: e.pageNo,
        bbox: e.bbox,
        excerpt: e.excerpt,
        isThisDocument: e.documentId === documentId,
      })),
      reconciliation: reconciliation ? { outcome: reconciliation.outcome, values: reconciliation.values, createdAt: reconciliation.createdAt } : null,
    });
  }
  return results;
}

export interface RequestActor {
  userId: string;
  organisationId: string;
  ip: string | null;
  sessionId: string;
}

/** Issues a signed download URL, auditing the access (spec §6.5: "audit DOCUMENT_ACCESSED"). */
export async function getSignedDocumentUrl(documentId: string, actor: RequestActor): Promise<{ url: string; expiresInSeconds: number }> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.ownerOrgId !== actor.organisationId) throw Errors.notFound("Document");

  const expiresInSeconds = 300;
  const url = await signedDownloadUrl(doc.storageBucket, doc.storageKey, expiresInSeconds);

  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      action: "DOCUMENT_ACCESSED",
      entityType: "DOCUMENT",
      entityId: doc.id,
      actorId: actor.userId,
      organisationId: actor.organisationId,
      ip: actor.ip,
      sessionId: actor.sessionId,
    });
  });

  return { url, expiresInSeconds };
}
