// Types mirroring apps/api/src/modules/compliance + verification + exceptions + decisions (see
// docs/PROGRESS.md deviation log re: packages/types not yet split out).
export interface RequirementResult {
  id: string;
  requirementId: string;
  ruleVersionId: string | null;
  result: "NOT_ASSESSED" | "PENDING_VERIFICATION" | "PASS" | "FAIL" | "REVIEW_REQUIRED" | "NOT_APPLICABLE" | "BLOCKED";
  mandatory: boolean;
  weight: string;
  earnedWeight: string;
  trace: unknown;
  explanation: string | null;
  evidenceIds: string[];
}

export interface Score {
  total: string;
  applicableWeight: string;
  earnedWeight: string;
  maxAchievable: string;
  provisional: boolean;
  breakdown: unknown;
}

export interface MandatoryGate {
  status: "PASS" | "FAIL" | "PENDING";
  passedCount: number;
  failedCount: number;
  pendingCount: number;
}

export interface RiskAssessment {
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  signals: { category: string; severity: string; detail?: string }[];
}

export interface ComplianceRun {
  id: string;
  code: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggerReason: string;
  results: RequirementResult[];
  score: Score;
  gate: MandatoryGate;
  risk: RiskAssessment;
}

export interface ComplianceRunSummary {
  id: string;
  code: string;
  status: string;
  triggerReason: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface ExceptionItem {
  id: string;
  code: string;
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: string;
  title: string;
  detail: string | null;
  nextAction: string | null;
  requirementId: string | null;
  resolution: string | null;
  createdAt: string;
}

export interface Decision {
  id: string;
  action: string;
  label: string;
  note: string | null;
  actorId: string;
  createdAt: string;
}

export interface VerificationTask {
  id: string;
  code: string;
  status: string;
  dueAt: string | null;
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
