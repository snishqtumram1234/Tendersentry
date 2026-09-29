// Types mirroring apps/api/src/modules/bidder + modules/bids (see docs/PROGRESS.md deviation log
// re: packages/types not yet split out).
export interface BidderProfile {
  organisationId: string;
  verificationLevel: number;
  badgeStatus: string;
  legalName: string | null;
}

export interface VaultItem {
  id: string;
  evidenceType: string;
  status: string;
  documentId: string;
  document: { id: string; originalFilename: string; processingStatus: string; docType: string | null };
}

export interface ReadinessItem {
  requirementCode: string;
  mandatory: boolean;
  status: "AVAILABLE" | "ACTION_NEEDED" | "MISSING";
  evidenceTypes: string[];
}

export interface Bid {
  id: string;
  code: string;
  tenderId: string;
  bidderOrgId: string;
  state: string;
  currentBidVersion: number;
  createdAt: string;
  tender?: { title: string; code: string };
}

export interface BidDocumentItem {
  bidId: string;
  bidVersion: number;
  documentId: string;
  envelope: string;
  mappedRequirementIds: string[];
  document: { id: string; originalFilename: string; processingStatus: string; docType: string | null; sha256: string };
}

export interface PrecheckItem {
  requirementCode: string;
  mandatory: boolean;
  hasDocument: boolean;
  status: "PASS" | "ACTION_REQUIRED";
}
