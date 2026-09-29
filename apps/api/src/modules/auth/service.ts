// Login flow for all three portals (spec §6.1, §6.4):
//   identifier + password → MFA → organisation resolution → session issued
// An account can only sign in through the entry matching its portal_type; a wrong-portal attempt
// returns the same generic error as a wrong password (spec §6.1: "do not reveal ... exists in
// another portal").
import type { PortalType, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { Errors } from "../../lib/errors.js";
import { hashPassword, verifyPassword, decryptSecret, encryptSecret, randomToken, sha256Hex } from "../../lib/crypto.js";
import { generateSecret, otpauthUrl, verifyMfaCode } from "../../lib/totp.js";
import { signAccessToken } from "../../lib/jwt.js";
import { signChallenge, verifyChallenge } from "./challenge.js";
import { writeAudit } from "../../audit/service.js";
import { config } from "../../config.js";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

export type LoginStepResult =
  | { step: "MFA_REQUIRED"; challenge: string }
  | { step: "MFA_ENROLLMENT_REQUIRED"; challenge: string; otpauthUrl: string; secret: string }
  | { step: "SELECT_ORGANISATION"; challenge: string; organisations: { id: string; displayName: string }[] }
  | { step: "SESSION"; user: SessionUser; cookies: SessionCookies };

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  portal: PortalType;
  organisationId: string | null;
  roles: Role[];
}

export interface SessionCookies {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessTtlMs: number;
  refreshTtlMs: number;
}

function requiresMfa(portal: PortalType, roles: Role[]): boolean {
  if (portal !== "BIDDER") return true; // government + platform always require MFA (spec §6.4)
  return roles.includes("BIDDER_ADMIN");
}

async function rolesForUser(userId: string, organisationId?: string): Promise<Role[]> {
  const rows = await prisma.userRole.findMany({
    where: { userId, ...(organisationId ? { organisationId } : {}) },
    select: { role: true },
  });
  return rows.map((r) => r.role);
}

export async function login(portal: PortalType, identifier: string, password: string, ip: string | null): Promise<LoginStepResult> {
  const user = await prisma.user.findFirst({ where: { email: identifier.toLowerCase(), portalType: portal } });

  // Constant-shape failure path whether the account doesn't exist, is in another portal, or the
  // password is wrong — spec §6.1.
  if (!user) {
    await auditLoginFailure(null, portal, ip, "NO_SUCH_ACCOUNT");
    throw Errors.invalidCredentials();
  }
  if (user.status === "LOCKED" && user.lockedUntil && user.lockedUntil > new Date()) {
    await auditLoginFailure(user.id, portal, ip, "LOCKED");
    throw Errors.accountLocked();
  }
  if (user.status === "DEACTIVATED" || user.status === "INVITED") {
    await auditLoginFailure(user.id, portal, ip, `STATUS_${user.status}`);
    throw Errors.invalidCredentials();
  }
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    await handleFailedPassword(user.id);
    await auditLoginFailure(user.id, portal, ip, "BAD_PASSWORD");
    throw Errors.invalidCredentials();
  }

  // Success: reset lockout counters.
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });

  const roles = await rolesForUser(user.id);
  if (requiresMfa(portal, roles)) {
    if (!user.mfaEnabled || !user.mfaSecretEnc) {
      const secret = generateSecret();
      // Store pending secret encrypted; only becomes active once verified in enrolMfa().
      await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret) } });
      const challenge = await signChallenge({ userId: user.id, portal, mfaVerified: false });
      return { step: "MFA_ENROLLMENT_REQUIRED", challenge, otpauthUrl: otpauthUrl(secret, user.email), secret };
    }
    const challenge = await signChallenge({ userId: user.id, portal, mfaVerified: false });
    return { step: "MFA_REQUIRED", challenge };
  }

  return resolveOrganisation(user.id, portal, roles);
}

async function handleFailedPassword(userId: string): Promise<void> {
  const user = await prisma.user.update({ where: { id: userId }, data: { failedLogins: { increment: 1 } } });
  if (user.failedLogins >= LOCKOUT_THRESHOLD) {
    await prisma.user.update({
      where: { id: userId },
      data: { status: "LOCKED", lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) },
    });
  }
}

export async function verifyMfa(challengeToken: string, code: string): Promise<LoginStepResult> {
  const challenge = await safeVerifyChallenge(challengeToken);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: challenge.userId } });
  if (!user.mfaSecretEnc) throw Errors.mfaEnrollmentRequired();

  const secret = decryptSecret(user.mfaSecretEnc);
  if (!(await verifyMfaCode(secret, code, user.isDemo))) {
    await auditLoginFailure(user.id, challenge.portal, null, "BAD_MFA_CODE");
    throw Errors.mfaInvalidCode();
  }
  if (!user.mfaEnabled) {
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  }
  const roles = await rolesForUser(user.id);
  return resolveOrganisation(user.id, challenge.portal, roles);
}

async function resolveOrganisation(userId: string, portal: PortalType, allRoles: Role[]): Promise<LoginStepResult> {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { organisation: { select: { id: true, displayName: true } } },
  });

  if (memberships.length === 0) {
    // PLATFORM users may be org-less (system administrators).
    if (portal === "PLATFORM") return issueSession(userId, null, allRoles, portal);
    throw Errors.forbidden();
  }
  if (memberships.length === 1) {
    const orgId = memberships[0]!.organisationId;
    const roles = await rolesForUser(userId, orgId);
    return issueSession(userId, orgId, roles, portal);
  }

  const challenge = await signChallenge({ userId, portal, mfaVerified: true });
  return {
    step: "SELECT_ORGANISATION",
    challenge,
    organisations: memberships.map((m) => ({ id: m.organisation.id, displayName: m.organisation.displayName })),
  };
}

export async function selectOrganisation(challengeToken: string, organisationId: string): Promise<LoginStepResult> {
  const challenge = await safeVerifyChallenge(challengeToken);
  if (!challenge.mfaVerified) throw Errors.mfaRequired();

  const membership = await prisma.membership.findUnique({
    where: { userId_organisationId: { userId: challenge.userId, organisationId } },
  });
  if (!membership || membership.status !== "ACTIVE") throw Errors.forbidden();

  const roles = await rolesForUser(challenge.userId, organisationId);
  return issueSession(challenge.userId, organisationId, roles, challenge.portal);
}

async function issueSession(userId: string, organisationId: string | null, roles: Role[], portal: PortalType): Promise<LoginStepResult> {
  const refreshToken = randomToken(32);
  const refreshTokenHash = sha256Hex(refreshToken);
  const refreshTtlMs = config.REFRESH_TTL_DAYS * 24 * 60 * 60_000;

  const { user, sessionId } = await prisma.$transaction(async (tx) => {
    const session = await tx.session.create({
      data: {
        userId,
        organisationId,
        refreshTokenHash,
        mfaVerified: true,
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });
    const u = await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await writeAudit(tx, {
      action: "LOGIN_SUCCESS",
      entityType: "USER",
      entityId: userId,
      actorId: userId,
      actorPortal: portal,
      organisationId,
      sessionId: session.id,
    });
    return { user: u, sessionId: session.id };
  });

  const accessToken = await signAccessToken({ sub: userId, sid: sessionId, portal: portal as never, orgId: organisationId, roles });
  const csrfToken = randomToken(24);

  return {
    step: "SESSION",
    user: { id: user.id, name: user.name, email: user.email, portal, organisationId, roles },
    cookies: {
      accessToken,
      refreshToken,
      csrfToken,
      accessTtlMs: config.SESSION_TTL_MINUTES * 60_000,
      refreshTtlMs,
    },
  };
}

export async function refreshSession(refreshToken: string): Promise<LoginStepResult> {
  const hash = sha256Hex(refreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) throw Errors.sessionExpired();

  await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  const roles = await rolesForUser(session.userId, session.organisationId ?? undefined);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const accessToken = await signAccessToken({
    sub: session.userId,
    sid: session.id,
    portal: user.portalType as never,
    orgId: session.organisationId,
    roles,
  });
  return {
    step: "SESSION",
    user: { id: user.id, name: user.name, email: user.email, portal: user.portalType, organisationId: session.organisationId, roles },
    cookies: {
      accessToken,
      refreshToken, // unchanged; rotate only on new login (simple + safe for Phase 0)
      csrfToken: randomToken(24),
      accessTtlMs: config.SESSION_TTL_MINUTES * 60_000,
      refreshTtlMs: config.REFRESH_TTL_DAYS * 24 * 60 * 60_000,
    },
  };
}

export async function logout(sessionId: string, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await writeAudit(tx, { action: "LOGOUT", entityType: "USER", entityId: actorId, actorId, sessionId });
  });
}

async function safeVerifyChallenge(token: string) {
  try {
    return await verifyChallenge(token);
  } catch {
    throw Errors.invalidChallenge();
  }
}

async function auditLoginFailure(userId: string | null, portal: PortalType, ip: string | null, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, { action: "LOGIN_FAILED", entityType: "USER", entityId: userId, actorId: userId, actorPortal: portal, reason, ip });
  });
}

// Password hashing re-exported for the seed script (spec §22).
export { hashPassword };
