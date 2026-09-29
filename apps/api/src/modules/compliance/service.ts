// Compliance run orchestration (spec §15.1): snapshot context → evaluate each ACTIVE rule version
// via the engine's pure interpreter → mandatory gates → score → risk → exception sync → persist
// atomically → audit. Runs are immutable; a new trigger always creates a new run (never updates
// one in place), so the dashboard's "Run history" is just every row for a bid, newest first.
import { createHash } from "node:crypto";
import type { ComplianceResult, GateStatus, Prisma, RiskLevel, RunTrigger } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { callEngine } from "../../lib/engineClient.js";
import { Errors } from "../../lib/errors.js";
import { buildComplianceContext } from "./context.js";
import { buildExceptionDrafts, syncExceptions } from "./exceptions.js";
import { computeRelationshipSignals } from "./relationships.js";

interface EngineResult {
  requirementId: string;
  ruleVersionId: string;
  result: ComplianceResult;
  mandatory: boolean;
  weight: string;
  earnedWeight: string;
  trace: unknown;
  evidenceIds: string[];
  explanation: string | null;
}
interface EngineGate {
  status: GateStatus;
  passedCount: number;
  failedCount: number;
  pendingCount: number;
}
interface EngineScore {
  total: string;
  applicableWeight: string;
  earnedWeight: string;
  maxAchievable: string;
  provisional: boolean;
  breakdown: unknown;
}
interface EngineRiskSignal {
  category: string;
  severity: string;
  detail?: string;
  field?: string;
  requirementId?: string;
}
interface EngineEvaluateResponse {
  results: EngineResult[];
  gate: EngineGate;
  score: EngineScore;
  riskSignals: EngineRiskSignal[];
}

const RISK_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

async function nextRunCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.complianceRun.count({ where: { code: { startsWith: `CR-${year}-` } } });
  return `CR-${year}-${String(count + 1).padStart(6, "0")}`;
}

export async function runCompliance(bidId: string, actorId: string | null, triggerReason: RunTrigger): Promise<{ runId: string }> {
  const bid = await prisma.bid.findUniqueOrThrow({ where: { id: bidId }, include: { tender: true } });

  const ruleVersions = await prisma.ruleVersion.findMany({
    where: { status: "ACTIVE", rule: { tenderId: bid.tenderId } },
    include: { rule: true },
  });
  const engineRules = ruleVersions.filter((v) => v.dsl).map((v) => ({ requirement_id: v.rule.requirementId, rule_version_id: v.id, dsl: v.dsl as Record<string, unknown> }));

  const { bidContext, referenceDate } = await buildComplianceContext(bidId);
  const evidenceSnapshotHash = createHash("sha256").update(JSON.stringify(bidContext)).digest("hex");
  const code = await nextRunCode();

  let outcome: EngineEvaluateResponse;
  try {
    outcome = await callEngine<EngineEvaluateResponse>("/engine/compliance/evaluate", { reference_date: referenceDate, rules: engineRules, bid_context: bidContext });
  } catch (err) {
    await prisma.complianceRun.create({
      data: {
        code,
        tenderId: bid.tenderId,
        bidId,
        bidVersion: bid.currentBidVersion,
        tenderVersion: bid.tender.currentVersion,
        ruleVersionIds: ruleVersions.map((v) => v.id),
        evidenceSnapshotHash,
        referenceDate: new Date(referenceDate),
        status: "FAILED",
        finishedAt: new Date(),
        triggeredBy: actorId,
        triggerReason,
      },
    });
    throw err;
  }

  const relationshipSignals = await computeRelationshipSignals(bid.tenderId, bid.bidderOrgId);
  const allSignals: EngineRiskSignal[] = [...outcome.riskSignals, ...relationshipSignals.map((s) => ({ category: s.category, severity: s.severity, detail: s.detail }))];
  const riskLevel: RiskLevel = allSignals.reduce<RiskLevel>((worst, s) => {
    const sev = s.severity as RiskLevel;
    return RISK_RANK[sev] > RISK_RANK[worst] ? sev : worst;
  }, "LOW");

  const exceptionDrafts = buildExceptionDrafts(
    bidId,
    outcome.results.map((r) => ({ requirementId: r.requirementId, result: r.result, mandatory: r.mandatory, explanation: r.explanation, evidenceIds: r.evidenceIds })),
    [...outcome.riskSignals, ...relationshipSignals.map((s) => ({ category: s.category, severity: s.severity, detail: s.detail, linkedOrgId: s.linkedOrgId }))],
  );

  return prisma.$transaction(async (tx) => {
    const run = await tx.complianceRun.create({
      data: {
        code,
        tenderId: bid.tenderId,
        bidId,
        bidVersion: bid.currentBidVersion,
        tenderVersion: bid.tender.currentVersion,
        ruleVersionIds: ruleVersions.map((v) => v.id),
        evidenceSnapshotHash,
        engineVersion: "phase4-v1",
        referenceDate: new Date(referenceDate),
        status: "COMPLETE",
        finishedAt: new Date(),
        triggeredBy: actorId,
        triggerReason,
      },
    });

    for (const r of outcome.results) {
      await tx.requirementResult.create({
        data: {
          runId: run.id,
          requirementId: r.requirementId,
          ruleVersionId: r.ruleVersionId,
          result: r.result,
          mandatory: r.mandatory,
          weight: r.weight,
          earnedWeight: r.earnedWeight,
          trace: r.trace as Prisma.InputJsonValue,
          explanation: r.explanation,
          evidenceIds: r.evidenceIds,
        },
      });
    }

    await tx.score.create({
      data: {
        runId: run.id,
        total: outcome.score.total,
        applicableWeight: outcome.score.applicableWeight,
        earnedWeight: outcome.score.earnedWeight,
        maxAchievable: outcome.score.maxAchievable,
        provisional: outcome.score.provisional,
        breakdown: outcome.score.breakdown as Prisma.InputJsonValue,
      },
    });

    await tx.mandatoryGateResult.create({
      data: { runId: run.id, passedCount: outcome.gate.passedCount, failedCount: outcome.gate.failedCount, pendingCount: outcome.gate.pendingCount, status: outcome.gate.status },
    });

    await tx.riskAssessment.create({ data: { runId: run.id, level: riskLevel, signals: allSignals as unknown as Prisma.InputJsonValue } });

    await syncExceptions(tx, bid.tenderId, bidId, run.id, exceptionDrafts);

    await writeAudit(tx, {
      action: "COMPLIANCE_RUN_COMPLETED",
      entityType: "COMPLIANCE_RUN",
      entityId: run.id,
      actorId,
      organisationId: bid.tender.organisationId,
      tenderId: bid.tenderId,
      bidId,
      after: { runCode: code, gate: outcome.gate.status, score: outcome.score.total, risk: riskLevel, trigger: triggerReason },
    });

    return { runId: run.id };
  });
}

/** A bid's compliance runs are visible to its own bidder organisation and to the government
 * organisation that owns the tender (officer permission is checked separately at the route). */
async function assertBidAccess(bidId: string, organisationId: string): Promise<{ tenderOrgId: string; bidderOrgId: string }> {
  const bid = await prisma.bid.findUnique({ where: { id: bidId }, include: { tender: { select: { organisationId: true } } } });
  if (!bid || (bid.tender.organisationId !== organisationId && bid.bidderOrgId !== organisationId)) throw Errors.notFound("Bid");
  return { tenderOrgId: bid.tender.organisationId, bidderOrgId: bid.bidderOrgId };
}

export async function getLatestRun(bidId: string, organisationId: string) {
  await assertBidAccess(bidId, organisationId);
  const run = await prisma.complianceRun.findFirst({
    where: { bidId, status: "COMPLETE" },
    orderBy: { startedAt: "desc" },
    include: { results: true, score: true, gate: true, risk: true },
  });
  if (!run) throw Errors.notFound("Compliance run");
  return run;
}

export async function listRuns(bidId: string, organisationId: string) {
  await assertBidAccess(bidId, organisationId);
  return prisma.complianceRun.findMany({ where: { bidId }, orderBy: { startedAt: "desc" }, select: { id: true, code: true, status: true, triggerReason: true, startedAt: true, finishedAt: true } });
}

export async function getRun(runId: string, organisationId: string) {
  const run = await prisma.complianceRun.findUnique({ where: { id: runId }, include: { results: true, score: true, gate: true, risk: true } });
  if (!run) throw Errors.notFound("Compliance run");
  await assertBidAccess(run.bidId, organisationId);
  return run;
}

/** Officer-triggered manual "Run evaluation" (spec §15.1, permission `evaluation.run`). Tenancy
 * is deliberately the government org only — a bidder can never trigger a run of their own bid. */
export async function triggerManualRun(bidId: string, actorId: string, organisationId: string): Promise<{ runId: string }> {
  const bid = await prisma.bid.findUnique({ where: { id: bidId }, include: { tender: { select: { organisationId: true } } } });
  if (!bid || bid.tender.organisationId !== organisationId) throw Errors.notFound("Bid");
  return runCompliance(bidId, actorId, "MANUAL");
}

/** Best-effort trigger used right after bid submission — logged but never fails the submission
 * itself (spec §15.1 lists SUBMISSION as a trigger; a compliance-engine hiccup shouldn't block
 * the bidder's already-valid submission). */
export async function triggerSubmissionRun(bidId: string): Promise<void> {
  try {
    await runCompliance(bidId, null, "SUBMISSION");
  } catch (err) {
    console.error(`Compliance run failed for bid ${bidId} after submission:`, err);
  }
}

/** Best-effort re-run for every non-draft bid of a bidder organisation — used after a claim's
 * verification status changes (spec §15.1's VERIFICATION_UPDATE trigger), since a claim isn't
 * scoped to one bid (Phase 3 finding: claims are organisation-scoped) and any of the org's
 * submitted bids could be affected. */
export async function triggerRunsForOrg(bidderOrgId: string): Promise<void> {
  const bids = await prisma.bid.findMany({ where: { bidderOrgId, state: { notIn: ["DRAFT", "WITHDRAWN"] } }, select: { id: true } });
  for (const bid of bids) {
    try {
      await runCompliance(bid.id, null, "VERIFICATION_UPDATE");
    } catch (err) {
      console.error(`Compliance re-run failed for bid ${bid.id} after a verification update:`, err);
    }
  }
}

