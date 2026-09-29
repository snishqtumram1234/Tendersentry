// Permission matrix (spec §6.3). One source of truth for who may do what.
import type { Role } from "@prisma/client";

export const PERMISSIONS = {
  "org.manage": ["ORG_ADMIN"],
  "org.users.manage": ["ORG_ADMIN"],
  "bidder.profile.manage": ["BIDDER_ADMIN"],
  "bidder.evidence.manage": ["BIDDER_ADMIN", "DOCUMENT_MANAGER"],

  "tender.create": ["BUYER"],
  "tender.edit_draft": ["BUYER"],
  "tender.import": ["BUYER"],
  "tender.submit_for_approval": ["BUYER"],
  "tender.approve_publication": ["APPROVING_AUTHORITY"],
  "tender.publish": ["BUYER"],
  "tender.corrigendum.create": ["BUYER"],
  "tender.corrigendum.approve": ["APPROVING_AUTHORITY"],

  "rule.compile": ["BUYER", "TECHNICAL_EVALUATOR"],
  "rule.edit": ["BUYER", "TECHNICAL_EVALUATOR"],
  "rule.approve": ["BUYER", "TECHNICAL_EVALUATOR"],
  "rule.reject": ["BUYER", "TECHNICAL_EVALUATOR"],

  "bid.view_technical": ["BUYER", "TECHNICAL_EVALUATOR", "COMMITTEE_MEMBER", "APPROVING_AUTHORITY", "AUDITOR"],
  "bid.view_financial": ["FINANCIAL_EVALUATOR", "BUYER", "APPROVING_AUTHORITY", "AUDITOR"], // + tender-state gate, enforced separately (§15.9)
  "bid.import_package": ["BUYER"],
  "bid.prepare": ["BIDDER_ADMIN", "BID_USER"],
  "bid.submit": ["BIDDER_ADMIN"], // BID_USER only if explicitly granted — checked separately
  "bid.withdraw": ["BIDDER_ADMIN"],
  "clarification.respond": ["BIDDER_ADMIN"],

  "evaluation.run": ["BUYER", "TECHNICAL_EVALUATOR"],
  "verification.work": ["VERIFIER", "BUYER", "TECHNICAL_EVALUATOR"],
  "verification.assign": ["BUYER"],

  "exception.assign": ["BUYER", "TECHNICAL_EVALUATOR"],
  "exception.resolve": ["BUYER", "TECHNICAL_EVALUATOR"],
  "exception.escalate": ["BUYER", "TECHNICAL_EVALUATOR"],

  "result.override": ["BUYER", "APPROVING_AUTHORITY"],
  "decision.record": ["BUYER", "APPROVING_AUTHORITY"],
  "committee.note": ["COMMITTEE_MEMBER"],
  "clarification.request": ["BUYER", "TECHNICAL_EVALUATOR"],

  "report.generate": ["BUYER", "TECHNICAL_EVALUATOR", "AUDITOR", "APPROVING_AUTHORITY"],
  "report.export": ["BUYER", "TECHNICAL_EVALUATOR", "AUDITOR", "APPROVING_AUTHORITY"],
  "audit.read": ["AUDITOR", "BUYER", "APPROVING_AUTHORITY"],

  "platform.manage": ["SYSTEM_ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(roles: readonly Role[], permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return roles.some((r) => allowed.includes(r));
}
