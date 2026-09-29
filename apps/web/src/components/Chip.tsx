// Small coloured status chip shared by the compliance/verification/decision screens.
const TONE_BY_RESULT: Record<string, "pass" | "fail" | "review" | "neutral"> = {
  PASS: "pass",
  VERIFIED: "pass",
  CONSISTENT: "pass",
  NORMALISED_MATCH: "pass",
  MATCH: "pass",
  RESOLVED: "pass",
  FAIL: "fail",
  CONFLICT: "fail",
  NO_MATCH: "fail",
  FAILED: "fail",
  REVIEW_REQUIRED: "review",
  PENDING_VERIFICATION: "review",
  PENDING: "review",
  QUEUED: "review",
  IN_PROGRESS: "review",
  OPEN: "review",
  ASSIGNED: "review",
  NOT_APPLICABLE: "neutral",
  NOT_ASSESSED: "neutral",
  BLOCKED: "neutral",
  UNAVAILABLE: "neutral",
  NOT_FOUND: "neutral",
};

export default function Chip({ label, tone }: { label: string; tone?: "pass" | "fail" | "review" | "neutral" }) {
  const resolvedTone = tone ?? TONE_BY_RESULT[label] ?? "neutral";
  return <span className={`chip chip-${resolvedTone}`}>{label.replaceAll("_", " ")}</span>;
}

export const RISK_TONE: Record<string, "pass" | "fail" | "review" | "neutral"> = {
  LOW: "pass",
  MEDIUM: "review",
  HIGH: "fail",
  CRITICAL: "fail",
};
