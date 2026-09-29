// Bidder verification level (spec §13.3). Computed from claim status — never hand-set, never
// collapsed into a single "trust score" (spec explicitly rejects that): each level is a distinct,
// explainable statement about what's actually been checked.
//
// Deviation: the full spec text for each level references evidence types not extracted yet
// (registered address, CIN/LLPIN, Udyam/EPFO/ESIC "if claimed") — Phase 3's extraction pipeline
// only produces PAN/GSTIN claims today. Each level below is implemented against what's actually
// extractable now and documented inline; it tightens automatically as more claim types come online
// (a level's condition is "the applicable claims that exist all meet the bar", so an unclaimed type
// is simply not counted against the bidder, per the spec's own "if applicable" wording).
import type { Claim } from "@prisma/client";
import { CLAIM_STATUS_RANK } from "./claimRank.js";

export type VerificationLevel = 0 | 1 | 2 | 3;
export type BadgeStatus = "NONE" | "VERIFIED";

function rank(status: string | null): number | null {
  if (!status) return null;
  return CLAIM_STATUS_RANK[status] ?? null;
}

function meetsFloor(claim: Claim | undefined, floor: number): boolean {
  if (!claim) return false;
  if (claim.status === "CONFLICT" || claim.status === "REVIEW_REQUIRED" || claim.status === "REVOKED") return false;
  const effective = rank(claim.verificationStatus) ?? rank(claim.status);
  return effective !== null && effective >= floor;
}

export function computeVerificationLevel(claims: Claim[]): { level: VerificationLevel; badgeStatus: BadgeStatus } {
  const byType = new Map<string, Claim>();
  for (const c of claims) if (!byType.has(c.claimType)) byType.set(c.claimType, c); // first (latest-created, callers order desc) wins

  const pan = byType.get("PAN");
  const gstin = byType.get("GSTIN");

  // Level 1 — identity evidence verified: PAN structurally valid or better, no open conflict.
  const level1 = meetsFloor(pan, CLAIM_STATUS_RANK.STRUCTURALLY_VALID!);

  // Level 2 — statutory evidence verified: GSTIN reconciled or better (spec also asks for Udyam/
  // EPFO/ESIC "if claimed" — none are extracted yet, so they're vacuously satisfied).
  const level2 = level1 && meetsFloor(gstin, CLAIM_STATUS_RANK.RECONCILED!);

  // Level 3 — capability evidence (financial/experience/certification) verified. Not reachable
  // yet: that extraction doesn't exist (Phase 3 deviation carried forward). Left real rather than
  // stubbed true, so it stays honest as those claim types come online.
  const financialOrExperienceTypes = ["ANNUAL_TURNOVER", "NET_WORTH", "EXPERIENCE_PROJECT", "CERTIFICATE"];
  const capabilityClaims = financialOrExperienceTypes.map((t) => byType.get(t)).filter((c): c is Claim => !!c);
  const level3 = level2 && capabilityClaims.length > 0 && capabilityClaims.every((c) => meetsFloor(c, CLAIM_STATUS_RANK.RECONCILED!));

  const level: VerificationLevel = level3 ? 3 : level2 ? 2 : level1 ? 1 : 0;
  const badgeStatus: BadgeStatus = level >= 2 ? "VERIFIED" : "NONE"; // spec §13.3: badge shown at Level 2+

  return { level, badgeStatus };
}
