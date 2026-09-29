// Document processing orchestration (spec §9.1): call the engine, persist extracted fields as
// claims + evidence with page/bbox provenance, then reconcile claims of the same type across all
// of the organisation's documents (spec §13.2).
//
// Deviations from the full spec, tracked in docs/PROGRESS.md:
//  - No BullMQ/Redis queue yet (Docker unavailable in this dev environment) — this runs
//    fire-and-forget right after upload instead of via a `document_processing` worker job.
//  - No DocumentPage rows yet (native page text/words) — only page-level metadata is kept
//    (textSource, charCount, ocrConfidence), not full word-level OCR data per page.
//  - Reconciliation is organisation-scoped (there's no bid yet to scope it to); the bid-scoped
//    version (spec §13.2 exactly as written) arrives with the bid module.
//  - OCR fallback (spec §9.1 Phase 3) is real, but Tesseract is only installed in the Docker
//    image, not this dev host — see docs/PROGRESS.md. A scanned page still never gets a
//    fabricated result: it's honestly recorded as unreadable when OCR is unavailable.
import { Prisma, type DocType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { callEngine } from "../../lib/engineClient.js";
import { recomputeVerificationLevel } from "../bidder/service.js";

interface EngineFieldResult {
  field: string;
  valueRaw: string;
  pageNo: number;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  confidence: number;
  method: string; // NATIVE_REGEX | OCR_REGEX
  valid: boolean;
  flags: string[];
}

interface EnginePageResult {
  pageNo: number;
  textSource: string; // NATIVE | OCR | NONE
  charCount: number;
  ocrConfidence: number | null;
}

interface EngineProcessResponse {
  documentId: string;
  pageCount: number;
  textLayer: "NATIVE" | "OCR" | "MIXED" | "NONE";
  failureCode: string | null;
  docType: string | null;
  docTypeConfidence: number;
  declaredTypeMismatch: boolean;
  pages: EnginePageResult[];
  fields: EngineFieldResult[];
  qrPayloads: { pageNo: number; data: string; symbology: string }[];
}

/** Recomputes CONSISTENT/CONFLICT for one (organisation, claimType) from every claim's current evidence
 * (spec §13.2). Always inserts a fresh row — the latest one by createdAt is "the" current picture. */
async function reconcile(tx: Prisma.TransactionClient, organisationId: string, claimType: string): Promise<void> {
  const claims = await tx.claim.findMany({
    where: { subjectOrgId: organisationId, claimType },
    include: { evidence: true },
  });
  if (claims.length === 0) return;

  const values: { value: string; evidenceId: string }[] = [];
  for (const claim of claims) {
    for (const ev of claim.evidence) {
      // Each piece of evidence carries its OWN extracted value in `excerpt` — using the claim's
      // single cached `value` here instead would compare every document's evidence to the same
      // constant (the first-ever extraction), never detecting a real conflict.
      if (ev.excerpt) values.push({ value: ev.excerpt, evidenceId: ev.id });
    }
  }
  if (values.length === 0) return;

  const distinct = new Set(values.map((v) => v.value));
  const outcome = distinct.size <= 1 ? "CONSISTENT" : "CONFLICT";
  const newClaimStatus = distinct.size <= 1 ? "RECONCILED" : "CONFLICT";

  await tx.reconciliationResult.create({
    data: {
      orgId: organisationId,
      field: claimType,
      outcome,
      values: values as unknown as Prisma.InputJsonValue,
      method: "EXACT_MATCH",
    },
  });

  for (const claim of claims) {
    if (claim.status === "STRUCTURALLY_VALID" || claim.status === "RECONCILED" || claim.status === "CONFLICT") {
      await tx.claim.update({ where: { id: claim.id }, data: { status: newClaimStatus } });
    }
  }
}

export async function processDocument(documentId: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return;

  await prisma.job.updateMany({ where: { entityId: documentId, queue: "document_processing", status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
  await prisma.document.update({ where: { id: documentId }, data: { processingStatus: "PROCESSING" } });

  let result: EngineProcessResponse;
  try {
    result = await callEngine<EngineProcessResponse>("/engine/documents/process", {
      document_id: documentId,
      storage_bucket: doc.storageBucket,
      storage_key: doc.storageKey,
      declared_type: doc.declaredType,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown engine error";
    await prisma.document.update({ where: { id: documentId }, data: { processingStatus: "FAILED", failureCode: "SOURCE_UNAVAILABLE" } });
    await prisma.job.updateMany({
      where: { entityId: documentId, queue: "document_processing", status: "RUNNING" },
      data: { status: "FAILED", finishedAt: new Date(), errorCode: "SOURCE_UNAVAILABLE", errorMessage: message },
    });
    return;
  }

  const claimTypesTouched = new Set<string>();

  await prisma.$transaction(async (tx) => {
    if (result.failureCode) {
      await tx.document.update({
        where: { id: documentId },
        data: { processingStatus: "FAILED", failureCode: result.failureCode, pageCount: result.pageCount, textLayer: result.textLayer },
      });
      await writeAudit(tx, {
        action: "DOCUMENT_PROCESSING_FAILED",
        entityType: "DOCUMENT",
        entityId: documentId,
        organisationId: doc.ownerOrgId,
        reason: result.failureCode,
      });
      return;
    }

    for (const field of result.fields) {
      const extracted = await tx.extractedField.create({
        data: {
          documentId,
          field: field.field,
          valueRaw: field.valueRaw,
          unit: null,
          pageNo: field.pageNo,
          bbox: (field.bbox ?? Prisma.DbNull) as Prisma.InputJsonValue,
          confidence: field.confidence,
          method: field.method === "OCR_REGEX" ? "OCR_REGEX" : "NATIVE_REGEX",
          extractorVersion: "phase3-v1",
        },
      });

      let claim = await tx.claim.findFirst({ where: { subjectOrgId: doc.ownerOrgId, bidId: null, claimType: field.field } });
      const claimStatus = field.valid ? "STRUCTURALLY_VALID" : "REVIEW_REQUIRED";
      if (!claim) {
        claim = await tx.claim.create({
          data: {
            subjectOrgId: doc.ownerOrgId,
            claimType: field.field,
            value: { value: field.valueRaw } as unknown as Prisma.InputJsonValue,
            status: claimStatus,
          },
        });
      } else if (claim.status !== "CONFLICT" && claim.status !== "RECONCILED") {
        // Don't downgrade a claim that a previous document already reconciled/conflicted —
        // the reconcile() call below recomputes the real status from all evidence anyway.
        await tx.claim.update({ where: { id: claim.id }, data: { status: claimStatus } });
      }

      await tx.evidence.create({
        data: {
          claimId: claim.id,
          extractedFieldId: extracted.id,
          documentId,
          pageNo: field.pageNo,
          bbox: (field.bbox ?? Prisma.DbNull) as Prisma.InputJsonValue,
          excerpt: field.valueRaw,
          role: "SUPPORTS",
        },
      });

      claimTypesTouched.add(field.field);
    }

    for (const claimType of claimTypesTouched) {
      await reconcile(tx, doc.ownerOrgId, claimType);
    }
    if (claimTypesTouched.size > 0) await recomputeVerificationLevel(tx, doc.ownerOrgId);

    await tx.document.update({
      where: { id: documentId },
      data: {
        processingStatus: "EXTRACTED",
        pageCount: result.pageCount,
        textLayer: result.textLayer,
        docType: (result.docType as DocType | null) ?? undefined,
        docTypeConfidence: result.docType ? result.docTypeConfidence : undefined,
        classificationMethod: result.docType ? "KEYWORD_SIGNATURE_V1" : undefined,
        qrPayloads: result.qrPayloads.length ? (result.qrPayloads as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });

    await writeAudit(tx, {
      action: "DOCUMENT_PROCESSED",
      entityType: "DOCUMENT",
      entityId: documentId,
      organisationId: doc.ownerOrgId,
      after: {
        textLayer: result.textLayer,
        fieldCount: result.fields.length,
        claimTypes: [...claimTypesTouched],
        docType: result.docType,
        declaredTypeMismatch: result.declaredTypeMismatch,
        qrCount: result.qrPayloads.length,
      },
    });
  });

  await prisma.job.updateMany({
    where: { entityId: documentId, queue: "document_processing", status: "RUNNING" },
    data: { status: result.failureCode ? "FAILED" : "SUCCEEDED", finishedAt: new Date(), errorCode: result.failureCode ?? undefined },
  });
}
