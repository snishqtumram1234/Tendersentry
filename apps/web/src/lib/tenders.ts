// Types mirroring apps/api/src/modules/tenders (kept in sync by hand — see docs/PROGRESS.md
// deviation log re: packages/types not yet split out).
export interface Tender {
  id: string;
  code: string;
  publicId: string;
  title: string;
  category: string | null;
  department: string | null;
  procurementMode: "SINGLE_ENVELOPE" | "TWO_ENVELOPE";
  state: string;
  currentVersion: number;
  createdAt: string;
}

export interface PublicTender {
  id: string;
  publicId: string;
  title: string;
  category: string | null;
  department: string | null;
  bidDeadline: string | null;
  estimatedValue: string | null;
  publishedAt: string | null;
}

export interface RuleVersion {
  id: string;
  version: number;
  origin: string;
  status: string;
  dsl: Record<string, unknown> | null;
  plainEnglish: string | null;
  ambiguityFlags: { code: string; question: string; options: string[]; resolution?: string }[];
  validationErrors: string[];
}

export interface Requirement {
  id: string;
  code: string;
  title: string;
  category: string;
  mandatory: boolean;
  weight: string;
  envelope: string;
  status: string;
}

export interface RuleListItem {
  ruleId: string;
  code: string;
  requirement: Requirement;
  currentVersion: RuleVersion | null;
  versionCount: number;
}

export interface TenderDocumentItem {
  id: string;
  documentId: string;
  role: string;
  document: { id: string; originalFilename: string; processingStatus: string };
}
