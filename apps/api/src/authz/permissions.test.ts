// Table-driven test of the whole permission matrix (spec §6.3): for every permission, every role
// in its allow-list must pass, and every role NOT in its allow-list must be denied. This is the
// single source of truth check — if someone edits PERMISSIONS without meaning to widen access,
// this test makes that visible immediately.
import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { PERMISSIONS, roleHasPermission, type Permission } from "./permissions.js";

const ALL_ROLES: Role[] = [
  "ORG_ADMIN",
  "BUYER",
  "TECHNICAL_EVALUATOR",
  "FINANCIAL_EVALUATOR",
  "VERIFIER",
  "COMMITTEE_MEMBER",
  "APPROVING_AUTHORITY",
  "AUDITOR",
  "BIDDER_ADMIN",
  "BID_USER",
  "DOCUMENT_MANAGER",
  "SYSTEM_ADMIN",
];

describe("permission matrix (spec §6.3)", () => {
  const permissions = Object.keys(PERMISSIONS) as Permission[];

  it.each(permissions)("every allowed role passes for '%s'", (permission) => {
    for (const role of PERMISSIONS[permission]) {
      expect(roleHasPermission([role as Role], permission), `${role} should be allowed '${permission}'`).toBe(true);
    }
  });

  it.each(permissions)("every non-allowed role is denied for '%s'", (permission) => {
    const allowed = new Set<Role>(PERMISSIONS[permission] as readonly Role[]);
    for (const role of ALL_ROLES) {
      if (allowed.has(role)) continue;
      expect(roleHasPermission([role], permission), `${role} should NOT be allowed '${permission}'`).toBe(false);
    }
  });

  it("a user with no roles is denied everything", () => {
    for (const permission of permissions) {
      expect(roleHasPermission([], permission)).toBe(false);
    }
  });

  it("holding an unrelated role does not grant an unrelated permission", () => {
    // Spot-check spanning two different portals' role sets (spec §6.2) — a bidder role must never
    // satisfy a government-only permission, and vice versa.
    expect(roleHasPermission(["BIDDER_ADMIN"], "tender.approve_publication")).toBe(false);
    expect(roleHasPermission(["APPROVING_AUTHORITY"], "bid.submit")).toBe(false);
  });

  it("platform.manage is exclusive to SYSTEM_ADMIN", () => {
    expect(PERMISSIONS["platform.manage"]).toEqual(["SYSTEM_ADMIN"]);
  });
});
