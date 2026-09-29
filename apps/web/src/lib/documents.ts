// Types mirroring apps/api/src/modules/documents (kept in sync by hand — see docs/PROGRESS.md
// deviation log re: packages/types not yet split out).
export interface DocumentMeta {
  id: string;
  originalFilename: string;
  mime: string;
  sizeBytes: string;
  sha256: string;
  processingStatus: "UPLOADED" | "VALIDATING" | "PROCESSING" | "EXTRACTED" | "REVIEW_REQUIRED" | "FAILED" | "ARCHIVED";
  failureCode: string | null;
  pageCount: number | null;
  textLayer: "NATIVE" | "MIXED" | "NONE" | null;
  docType: string | null;
  declaredType: string | null;
  envelope: string;
  createdAt: string;
}

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ExtractedField {
  id: string;
  field: string;
  valueRaw: string;
  pageNo: number;
  bbox: Bbox;
  confidence: string;
  method: string;
}

export interface EvidenceItem {
  evidenceId: string;
  documentId: string | null;
  documentFilename: string | null;
  pageNo: number | null;
  bbox: Bbox | null;
  excerpt: string | null;
  isThisDocument: boolean;
}

export interface ReconciliationInfo {
  outcome: "CONSISTENT" | "NORMALISED_MATCH" | "CONFLICT" | "INSUFFICIENT_EVIDENCE";
  values: { value: string; evidenceId: string }[];
  createdAt: string;
}

export interface ClaimWithEvidence {
  claimId: string;
  claimType: string;
  value: unknown;
  status: string;
  evidence: EvidenceItem[];
  reconciliation: ReconciliationInfo | null;
}

export const PROCESSING_LABELS: Record<DocumentMeta["processingStatus"], string> = {
  UPLOADED: "Uploaded",
  VALIDATING: "Validating",
  PROCESSING: "Processing",
  EXTRACTED: "Extracted",
  REVIEW_REQUIRED: "Review required",
  FAILED: "Failed",
  ARCHIVED: "Archived",
};

export const IN_PROGRESS_STATUSES = new Set(["UPLOADED", "VALIDATING", "PROCESSING"]);
