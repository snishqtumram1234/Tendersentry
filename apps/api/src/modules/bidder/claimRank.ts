// Mirrors the ClaimStatus progression from spec §8.3 — same ranking the engine's
// engine/compliance/types.py CLAIM_STATUS_RANK uses, kept in sync by hand (packages/types isn't
// shared with Python yet — see docs/PROGRESS.md deviation log).
export const CLAIM_STATUS_RANK: Record<string, number> = {
  DOCUMENT_UPLOADED: 0,
  FIELD_EXTRACTED: 1,
  STRUCTURALLY_VALID: 2,
  DOCUMENT_SUPPORTED: 3,
  RECONCILED: 4,
  AUTHORITATIVE_VERIFIED: 5,
};
