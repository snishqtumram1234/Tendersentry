// Verification router + officer-assisted human queue (spec §14). No live external adapter has
// credentials configured in this environment (see sources.ts), so the only route that produces a
// real result here is OFFICER_ASSISTED: an officer looks the identifier up on the source's own
// official portal (never scraped or automated — spec §14.3) and records what they saw, with a
// required captured artefact for a positive match. AUTHORITATIVE_VERIFIED is reachable only
// through that recorded, non-simulated path (spec §2 rule 2, §8.3), enforced here in code and
// backed by the DB CHECK-style discipline the spec asks for.
import type { Prisma, VerificationOutcome, VerificationTaskStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { Errors } from "../../lib/errors.js";
import { uploadDocument } from "../documents/service.js";
import { triggerRunsForOrg } from "../compliance/service.js";
import { recomputeVerificationLevel } from "../bidder/service.js";
import { CLAIM_TYPE_TO_SOURCE } from "./sources.js";

async function nextTaskCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.verificationTask.count({ where: { code: { startsWith: `VT-${year}-` } } });
  return `VT-${year}-${String(count + 1).padStart(5, "0")}`;
}

/** Government-org officer requests verification for a claim it can see because the claim's
 * organisation has a bid on one of that officer's tenders (a claim itself carries no tender link —
 * it's organisation-scoped, Phase 3 finding — so tenancy is checked via that indirect path). */
async function assertClaimVisibleToGov(claimId: string, organisationId: string) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) throw Errors.notFound("Claim");
  const hasBidOnMyTender = await prisma.bid.findFirst({ where: { bidderOrgId: claim.subjectOrgId, tender: { organisationId } } });
  if (!hasBidOnMyTender) throw Errors.notFound("Claim");
  return claim;
}

export async function requestVerification(claimId: string, organisationId: string, actorId: string) {
  const claim = await assertClaimVisibleToGov(claimId, organisationId);
  const sourceCode = CLAIM_TYPE_TO_SOURCE[claim.claimType];
  if (!sourceCode) throw Errors.validation(`Claim type ${claim.claimType} has no verification route in this build.`);
  const source = await prisma.verificationSource.findUniqueOrThrow({ where: { code: sourceCode } });

  const existing = await prisma.verificationRequest.findFirst({ where: { claimId, sourceId: source.id }, orderBy: { createdAt: "desc" } });
  if (existing) {
    const openTask = await prisma.verificationTask.findFirst({ where: { requestId: existing.id, status: { in: ["QUEUED", "IN_PROGRESS"] } } });
    if (openTask) return { requestId: existing.id, taskId: openTask.id, taskCode: openTask.code };
  }

  if (source.capabilityStatus !== "MANUAL_ONLY") {
    // No LIVE_VALIDATED external adapter exists yet for any identity claim type (see sources.ts);
    // this branch is here so the route decision is honest once one does exist, rather than
    // silently treating every source as manual forever.
    throw Errors.validation(`No automated route is available for ${source.name} yet — it must go through the human queue.`);
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.verificationRequest.create({
      data: { claimId, sourceId: source.id, route: "HUMAN", automationState: "HUMAN_REQUIRED", createdBy: actorId },
    });
    const code = await nextTaskCode();
    const task = await tx.verificationTask.create({
      data: { code, requestId: request.id, status: "QUEUED", dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });
    await writeAudit(tx, {
      action: "VERIFICATION_REQUESTED",
      entityType: "VERIFICATION_TASK",
      entityId: task.id,
      actorId,
      organisationId,
      after: { claimId, claimType: claim.claimType, source: source.code },
    });
    return { requestId: request.id, taskId: task.id, taskCode: task.code };
  });
}

export interface TaskListItem {
  id: string;
  code: string;
  status: VerificationTaskStatus;
  dueAt: Date | null;
  assigneeId: string | null;
  claimType: string;
  claimValue: unknown;
  bidderOrgId: string;
  bidderLegalName: string;
  sourceCode: string;
  sourceName: string;
  portalUrl: string | null;
  instructions: string | null;
}

export async function listTasks(organisationId: string, statusFilter?: VerificationTaskStatus[]): Promise<TaskListItem[]> {
  const tasks = await prisma.verificationTask.findMany({
    where: { status: statusFilter ? { in: statusFilter } : undefined },
    include: { request: { include: { claim: { include: { subjectOrg: true } }, source: true } } },
    orderBy: { createdAt: "asc" },
  });
  // Government tenancy: only tasks for claims belonging to an org with a bid on one of my tenders.
  const visible: TaskListItem[] = [];
  for (const t of tasks) {
    const hasBidOnMyTender = await prisma.bid.findFirst({ where: { bidderOrgId: t.request.claim.subjectOrgId, tender: { organisationId } } });
    if (!hasBidOnMyTender) continue;
    visible.push({
      id: t.id,
      code: t.code,
      status: t.status,
      dueAt: t.dueAt,
      assigneeId: t.assigneeId,
      claimType: t.request.claim.claimType,
      claimValue: t.request.claim.value,
      bidderOrgId: t.request.claim.subjectOrgId,
      bidderLegalName: t.request.claim.subjectOrg.legalName,
      sourceCode: t.request.source.code,
      sourceName: t.request.source.name,
      portalUrl: t.request.source.portalUrl,
      instructions: t.request.source.instructions,
    });
  }
  return visible;
}

async function loadTaskForGov(taskId: string, organisationId: string) {
  const task = await prisma.verificationTask.findUnique({ where: { id: taskId }, include: { request: { include: { claim: true } } } });
  if (!task) throw Errors.notFound("Verification task");
  const hasBidOnMyTender = await prisma.bid.findFirst({ where: { bidderOrgId: task.request.claim.subjectOrgId, tender: { organisationId } } });
  if (!hasBidOnMyTender) throw Errors.notFound("Verification task");
  return task;
}

export async function startTask(taskId: string, actorId: string, organisationId: string) {
  const task = await loadTaskForGov(taskId, organisationId);
  if (task.status !== "QUEUED") throw Errors.invalidStateTransition(`Task is already ${task.status}.`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.verificationTask.update({ where: { id: taskId }, data: { status: "IN_PROGRESS", assigneeId: actorId, lastAttemptAt: new Date(), attempts: { increment: 1 } } });
    await writeAudit(tx, { action: "VERIFICATION_TASK_STARTED", entityType: "VERIFICATION_TASK", entityId: taskId, actorId, organisationId });
    return updated;
  });
}

export interface RecordResultInput {
  outcome: VerificationOutcome;
  observedValues?: Record<string, unknown>;
  note?: string;
  capture?: { originalFilename: string; buffer: Buffer };
}

const TASK_STATUS_FOR_OUTCOME: Record<VerificationOutcome, VerificationTaskStatus> = {
  MATCH: "VERIFIED",
  NO_MATCH: "CONFLICT",
  NOT_FOUND: "UNAVAILABLE",
  SOURCE_ERROR: "FAILED",
  SIGNATURE_VALID: "VERIFIED",
  SIGNATURE_INVALID: "FAILED",
  SIGNATURE_UNTRUSTED: "CONFLICT",
  DECODED: "VERIFIED",
};

export async function recordResult(taskId: string, actorId: string, organisationId: string, input: RecordResultInput) {
  const task = await loadTaskForGov(taskId, organisationId);
  if (task.status !== "IN_PROGRESS") throw Errors.invalidStateTransition("Start the task before recording a result.");
  if (input.outcome === "MATCH" && !input.capture) throw Errors.validation("A captured screenshot or PDF is required to record a Match (spec §14.4).");

  let capturedDocumentId: string | null = null;
  if (input.capture) {
    const uploaded = await uploadDocument({ ownerOrgId: organisationId, uploadedBy: actorId, originalFilename: input.capture.originalFilename, buffer: input.capture.buffer });
    capturedDocumentId = uploaded.documentId;
  }

  const claim = await prisma.claim.findUniqueOrThrow({ where: { id: task.request.claimId } });

  return prisma.$transaction(async (tx) => {
    const result = await tx.verificationResult.create({
      data: {
        requestId: task.request.id,
        mode: "OFFICER_ASSISTED",
        outcome: input.outcome,
        normalised: (input.observedValues ?? null) as Prisma.InputJsonValue,
        capturedDocumentId,
        checkedAt: new Date(),
        checkedBy: actorId,
        isSimulated: false,
      },
    });

    await tx.verificationTask.update({ where: { id: taskId }, data: { status: TASK_STATUS_FOR_OUTCOME[input.outcome], notes: input.note } });
    await tx.verificationRequest.update({ where: { id: task.request.id }, data: { automationState: input.outcome === "MATCH" ? "VERIFIED" : input.outcome === "NO_MATCH" ? "CONFLICT" : input.outcome === "NOT_FOUND" ? "UNAVAILABLE" : "FAILED" } });

    if (input.outcome === "MATCH") {
      await tx.claim.update({ where: { id: claim.id }, data: { verificationStatus: "AUTHORITATIVE_VERIFIED", verificationMethod: "OFFICER_ASSISTED", verifiedAt: new Date() } });
    } else if (input.outcome === "NO_MATCH") {
      await tx.claim.update({ where: { id: claim.id }, data: { status: "CONFLICT" } });
    }
    await recomputeVerificationLevel(tx, claim.subjectOrgId);

    await writeAudit(tx, {
      action: "VERIFICATION_RESULT_RECORDED",
      entityType: "VERIFICATION_TASK",
      entityId: taskId,
      actorId,
      organisationId,
      after: { outcome: input.outcome, resultId: result.id, claimId: claim.id, claimType: claim.claimType },
    });

    return { resultId: result.id, taskStatus: TASK_STATUS_FOR_OUTCOME[input.outcome] };
  }).then(async (out) => {
    // Outside the transaction: claims are org-scoped, so a verification update can affect any of
    // that org's submitted bids — re-run compliance for all of them (spec §15.1 VERIFICATION_UPDATE).
    await triggerRunsForOrg(claim.subjectOrgId);
    return out;
  });
}

export async function markUnavailable(taskId: string, actorId: string, organisationId: string, reason: string) {
  const task = await loadTaskForGov(taskId, organisationId);
  if (task.status !== "IN_PROGRESS" && task.status !== "QUEUED") throw Errors.invalidStateTransition(`Task is already ${task.status}.`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.verificationTask.update({ where: { id: taskId }, data: { status: "UNAVAILABLE", notes: reason } });
    await tx.verificationRequest.update({ where: { id: task.request.id }, data: { automationState: "UNAVAILABLE" } });
    await writeAudit(tx, { action: "VERIFICATION_MARKED_UNAVAILABLE", entityType: "VERIFICATION_TASK", entityId: taskId, actorId, organisationId, reason });
    return updated;
  });
}

export interface VerificationMetrics {
  total: number;
  autoResolved: number;
  evidenceReconciled: number;
  humanAssisted: number;
  unresolved: number;
  automationRate: number | null;
}

/** Computed, never hand-entered (spec §14.5). MVP scope: only the human-queue route actually
 * produces requests today (see sources.ts), so autoResolved/evidenceReconciled are always 0 here —
 * honest about what's actually automated in this build rather than implying a rate that doesn't exist. */
export async function getMetrics(organisationId: string): Promise<VerificationMetrics> {
  const requests = await prisma.verificationRequest.findMany({ include: { claim: true, tasks: true } });
  const mine = [];
  for (const r of requests) {
    const hasBidOnMyTender = await prisma.bid.findFirst({ where: { bidderOrgId: r.claim.subjectOrgId, tender: { organisationId } } });
    if (hasBidOnMyTender) mine.push(r);
  }
  const total = mine.length;
  const humanAssisted = mine.filter((r) => r.tasks.some((t) => t.status === "VERIFIED" || t.status === "CONFLICT")).length;
  const unresolved = mine.filter((r) => r.tasks.every((t) => t.status === "QUEUED" || t.status === "IN_PROGRESS")).length;
  return { total, autoResolved: 0, evidenceReconciled: 0, humanAssisted, unresolved, automationRate: total > 0 ? 0 : null };
}
