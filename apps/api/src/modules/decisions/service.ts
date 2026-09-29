// Officer decision recording (spec §15.8). A decision is recorded against a specific compliance
// run — "the compliance result, gates, score, risk, open exceptions, rules and the run ID being
// decided on" — so it's always traceable to exactly what the officer saw.
//
// Deviation: `decision_label_configs` (per-org configurable labels) isn't wired up yet — every
// decision uses the spec's own default English label for its action. The schema/data model
// already supports per-org overrides; only the lookup is deferred.
import { randomUUID } from "node:crypto";
import type { DecisionAction, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { Errors } from "../../lib/errors.js";

const DEFAULT_LABELS: Record<DecisionAction, string> = {
  TECHNICALLY_COMPLIANT: "Technically compliant",
  TECHNICALLY_NON_COMPLIANT: "Technically non-compliant",
  NEEDS_CLARIFICATION: "Needs clarification",
  REFER_TO_COMMITTEE: "Refer to committee",
  FINAL_DECISION: "Record final decision",
};

const NOTE_REQUIRED_ACTIONS = new Set<DecisionAction>(["TECHNICALLY_NON_COMPLIANT", "FINAL_DECISION"]);

export interface RecordDecisionInput {
  action: DecisionAction;
  note?: string;
  acknowledgedExceptionIds?: string[];
}

async function assertGovAccess(bidId: string, organisationId: string) {
  const bid = await prisma.bid.findUnique({ where: { id: bidId }, include: { tender: { select: { organisationId: true, id: true } } } });
  if (!bid || bid.tender.organisationId !== organisationId) throw Errors.notFound("Bid");
  return bid;
}

export async function recordDecision(bidId: string, organisationId: string, actorId: string, role: Role, input: RecordDecisionInput) {
  const bid = await assertGovAccess(bidId, organisationId);

  if (NOTE_REQUIRED_ACTIONS.has(input.action) && !input.note?.trim()) {
    throw Errors.validation(`A note is required to record "${DEFAULT_LABELS[input.action]}".`);
  }

  const latestRun = await prisma.complianceRun.findFirst({ where: { bidId, status: "COMPLETE" }, orderBy: { startedAt: "desc" } });

  if (input.action === "TECHNICALLY_COMPLIANT") {
    const openHighRisk = await prisma.exceptionItem.findMany({ where: { bidId, status: { not: "RESOLVED" }, severity: { in: ["CRITICAL", "HIGH"] } } });
    if (openHighRisk.length > 0) {
      const acknowledged = new Set(input.acknowledgedExceptionIds ?? []);
      const missing = openHighRisk.filter((e) => !acknowledged.has(e.id));
      if (missing.length > 0) {
        throw Errors.validation("Open CRITICAL/HIGH exceptions must be explicitly acknowledged before recording \"Technically compliant\".", {
          exceptionIds: missing.map((e) => e.id),
          exceptions: missing.map((e) => ({ id: e.id, category: e.category, severity: e.severity, title: e.title })),
        });
      }
    }
  }

  const label = DEFAULT_LABELS[input.action];
  const idempotencyKey = randomUUID();

  return prisma.$transaction(async (tx) => {
    const decision = await tx.decision.create({
      data: {
        tenderId: bid.tenderId,
        bidId,
        runId: latestRun?.id,
        action: input.action,
        label,
        note: input.note,
        acknowledgedExceptionIds: input.acknowledgedExceptionIds ?? [],
        actorId,
        role,
        idempotencyKey,
      },
    });
    await writeAudit(tx, {
      action: "DECISION_RECORDED",
      entityType: "DECISION",
      entityId: decision.id,
      actorId,
      actorRole: role,
      organisationId,
      tenderId: bid.tenderId,
      bidId,
      after: { action: input.action, label, runId: latestRun?.id ?? null },
      reason: input.note,
    });
    return decision;
  });
}

export async function listDecisions(bidId: string, organisationId: string) {
  const bid = await prisma.bid.findUnique({ where: { id: bidId }, include: { tender: { select: { organisationId: true } } } });
  if (!bid || (bid.tender.organisationId !== organisationId && bid.bidderOrgId !== organisationId)) throw Errors.notFound("Bid");
  return prisma.decision.findMany({ where: { bidId }, orderBy: { createdAt: "desc" } });
}
