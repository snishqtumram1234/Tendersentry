// RBAC + tenancy middleware (spec §6.3, §6.5, CLAUDE.md rule 15: the frontend hides UI for cosmetics
// only — this is the real enforcement point).
import type { NextFunction, Request, Response } from "express";
import type { PortalType, Role } from "@prisma/client";
import { verifyAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/errors.js";
import { roleHasPermission, type Permission } from "./permissions.js";

export interface RequestContext {
  userId: string;
  sessionId: string;
  portal: PortalType;
  organisationId: string | null;
  roles: Role[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

/** Populates req.ctx from the access-token cookie. Does not itself require a valid session (see requireAuth). */
export async function loadContext(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.["ts_at"];
  if (!token) return next();
  try {
    const payload = await verifyAccessToken(token);
    const session = await prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return next();
    req.ctx = {
      userId: payload.sub,
      sessionId: payload.sid,
      portal: payload.portal as PortalType,
      organisationId: payload.orgId,
      roles: payload.roles,
    };
  } catch {
    // invalid/expired token: leave req.ctx undefined, requireAuth will reject
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.ctx) return next(Errors.sessionExpired());
  next();
}

/** CSRF double-submit check for mutating requests (spec §6.4). */
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const cookieToken = req.cookies?.["ts_csrf"];
  const headerToken = req.header("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) return next(Errors.csrfInvalid());
  next();
}

/** Requires the caller to hold `permission` in their current organisation (spec §6.3). */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.ctx) return next(Errors.sessionExpired());
    if (!roleHasPermission(req.ctx.roles, permission)) return next(Errors.forbidden());
    next();
  };
}

/**
 * Requires the caller be assigned to the given tender (spec §6.2: tender-level assignment) — or hold
 * AUDITOR / SYSTEM_ADMIN for org-wide / platform-wide read. Cross-org access returns 404, not 403
 * (spec §6.3: "do not leak existence").
 */
export async function requireTenderAccess(req: Request, _res: Response, next: NextFunction) {
  if (!req.ctx) return next(Errors.sessionExpired());
  const tenderId = (req.params.tenderId ?? req.params.id) as string | undefined;
  if (!tenderId) return next(Errors.notFound("Tender"));

  const tender = await prisma.tender.findUnique({ where: { id: tenderId }, select: { id: true, organisationId: true } });
  if (!tender || tender.organisationId !== req.ctx.organisationId) return next(Errors.notFound("Tender"));

  if (req.ctx.roles.includes("AUDITOR") || req.ctx.roles.includes("SYSTEM_ADMIN")) return next();

  const assigned = await prisma.tenderAssignment.findFirst({ where: { tenderId, userId: req.ctx.userId } });
  if (!assigned) return next(Errors.notFound("Tender"));
  next();
}
