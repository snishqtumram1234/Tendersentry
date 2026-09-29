// Exception sync (spec §15.7): every non-normal requirement result or risk signal becomes exactly
// one exception, deduped by `category:bid:requirement:field`. If the underlying condition
// disappears on a later run, the exception auto-resolves with an auditable "Condition no longer
// present" resolution rather than silently vanishing.
//
// Deviation: category assignment for requirement results is a simplification — the engine's
// generic result value (FAIL/REVIEW_REQUIRED/PENDING_VERIFICATION/BLOCKED) doesn't carry enough
// structure yet to distinguish e.g. a genuine field conflict from a missing-document REVIEW
// case; both currently land in FIELD_CONFLICT. Revisit once trace inspection can disambiguate.
import { randomUUID } from "node:crypto";
import type { ExceptionCategory, Prisma, RiskLevel } from "@prisma/client";

export interface ExceptionDraft {
  category: ExceptionCategory;
  severity: RiskLevel;
  title: string;
  detail: string | null;
  nextAction: string | null;
  requirementId: string | null;
  dedupeKey: string;
  evidenceIds: string[];
}

export interface EngineResultLike {
  requirementId: string;
  result: string;
  mandatory: boolean;
  explanation: string | null;
  evidenceIds: string[];
}

export interface RiskSignalLike {
  category: string;
  severity: string;
  detail?: string;
  field?: string;
  linkedOrgId?: string;
}

const SIGNAL_CATEGORIES_TO_RECORD = new Set(["IDENTITY_CONFLICT", "FINANCIAL_EVIDENCE_CONFLICT", "EXPIRED_EVIDENCE", "RELATIONSHIP_SIGNAL"]);

export function buildExceptionDrafts(bidId: string, results: EngineResultLike[], signals: RiskSignalLike[]): ExceptionDraft[] {
  const drafts: ExceptionDraft[] = [];

  for (const r of results) {
    if (r.result === "FAIL") {
      const category: ExceptionCategory = r.mandatory ? "MANDATORY_GATE_FAILED" : "MISSING_DOCUMENT";
      drafts.push({
        category,
        severity: r.mandatory ? "CRITICAL" : "MEDIUM",
        title: r.mandatory ? "Mandatory requirement failed" : "Requirement not met",
        detail: r.explanation,
        nextAction: "Review the requirement's evidence and trace.",
        requirementId: r.requirementId,
        dedupeKey: `${category}:${bidId}:${r.requirementId}:`,
        evidenceIds: r.evidenceIds,
      });
    } else if (r.result === "REVIEW_REQUIRED") {
      drafts.push({
        category: "FIELD_CONFLICT",
        severity: "HIGH",
        title: "Requirement needs review",
        detail: r.explanation,
        nextAction: "Compare the conflicting sources.",
        requirementId: r.requirementId,
        dedupeKey: `FIELD_CONFLICT:${bidId}:${r.requirementId}:`,
        evidenceIds: r.evidenceIds,
      });
    } else if (r.result === "PENDING_VERIFICATION") {
      drafts.push({
        category: "VERIFICATION_PENDING",
        severity: "MEDIUM",
        title: "Awaiting verification",
        detail: r.explanation,
        nextAction: "Route the underlying claim for verification.",
        requirementId: r.requirementId,
        dedupeKey: `VERIFICATION_PENDING:${bidId}:${r.requirementId}:`,
        evidenceIds: r.evidenceIds,
      });
    } else if (r.result === "BLOCKED") {
      drafts.push({
        category: "RULE_AMBIGUITY",
        severity: "MEDIUM",
        title: "Requirement could not be evaluated",
        detail: r.explanation,
        nextAction: "Check the rule version's approval status.",
        requirementId: r.requirementId,
        dedupeKey: `RULE_AMBIGUITY:${bidId}:${r.requirementId}:`,
        evidenceIds: r.evidenceIds,
      });
    }
  }

  for (const s of signals) {
    if (!SIGNAL_CATEGORIES_TO_RECORD.has(s.category)) continue;
    const key = s.field ?? s.linkedOrgId ?? "signal";
    drafts.push({
      category: s.category as ExceptionCategory,
      severity: s.severity as RiskLevel,
      title: s.detail ?? s.category,
      detail: s.detail ?? null,
      nextAction: s.category === "RELATIONSHIP_SIGNAL" ? "Review the linked bidder." : "Compare the sources.",
      requirementId: null,
      dedupeKey: `${s.category}:${bidId}::${key}`,
      evidenceIds: [],
    });
  }

  return drafts;
}

export async function syncExceptions(tx: Prisma.TransactionClient, tenderId: string, bidId: string, runId: string, drafts: ExceptionDraft[]): Promise<void> {
  const existingOpen = await tx.exceptionItem.findMany({ where: { bidId, status: { not: "RESOLVED" } } });
  const currentKeys = new Set(drafts.map((d) => d.dedupeKey));

  for (const existing of existingOpen) {
    if (!currentKeys.has(existing.dedupeKey)) {
      await tx.exceptionItem.update({
        where: { id: existing.id },
        data: { status: "RESOLVED", resolution: `Condition no longer present in run ${runId}.`, resolvedAt: new Date() },
      });
    }
  }

  for (const d of drafts) {
    const existing = await tx.exceptionItem.findUnique({ where: { dedupeKey: d.dedupeKey } });
    if (existing) {
      await tx.exceptionItem.update({
        where: { id: existing.id },
        data: {
          status: existing.status === "RESOLVED" ? "REOPENED" : existing.status,
          severity: d.severity,
          detail: d.detail,
          evidenceIds: d.evidenceIds,
          sourceRunId: runId,
        },
      });
      continue;
    }
    const code = `EXC-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6)}`;
    await tx.exceptionItem.create({
      data: {
        code,
        tenderId,
        bidId,
        requirementId: d.requirementId,
        category: d.category,
        severity: d.severity,
        dedupeKey: d.dedupeKey,
        title: d.title,
        detail: d.detail,
        nextAction: d.nextAction,
        evidenceIds: d.evidenceIds,
        sourceRunId: runId,
      },
    });
  }
}
