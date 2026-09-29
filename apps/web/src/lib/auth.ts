// Types mirroring apps/api/src/modules/auth (kept in sync by hand until packages/types exists —
// see docs/PROGRESS.md deviation log).
export type Portal = "government" | "bidder" | "admin";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  portal: "GOVERNMENT" | "BIDDER" | "PLATFORM";
  organisationId: string | null;
  roles: string[];
}

export type LoginResponse =
  | { status: "MFA_REQUIRED"; challenge: string }
  | { status: "MFA_ENROLLMENT_REQUIRED"; challenge: string; otpauthUrl: string }
  | { status: "SELECT_ORGANISATION"; challenge: string; organisations: { id: string; displayName: string }[] }
  | { status: "SESSION"; user: SessionUser };

export interface MeResponse {
  user: { id: string; name: string; email: string; portal: string };
  organisation: { id: string; displayName: string } | null;
  roles: string[];
}

export const PORTAL_LABELS: Record<Portal, string> = {
  government: "Government",
  bidder: "Bidder",
  admin: "Platform admin",
};
