import { Router } from "express";
import { z } from "zod";
import type { PortalType } from "@prisma/client";
import { config } from "../../config.js";
import { Errors } from "../../lib/errors.js";
import { requireAuth, requireCsrf, type RequestContext } from "../../authz/middleware.js";
import { prisma } from "../../lib/prisma.js";
import * as authService from "./service.js";
import type { LoginStepResult, SessionCookies } from "./service.js";
import { registerBidder } from "./registration.js";

export const authRouter = Router();

const PORTAL_MAP: Record<string, PortalType> = { government: "GOVERNMENT", bidder: "BIDDER", admin: "PLATFORM" };

const cookieOpts = (maxAgeMs: number, httpOnly = true) => ({
  httpOnly,
  secure: config.APP_ENV === "production" || config.APP_ENV === "staging" || config.APP_ENV === "demo",
  sameSite: "lax" as const,
  maxAge: maxAgeMs,
  path: "/",
});

function setSessionCookies(res: import("express").Response, cookies: SessionCookies) {
  res.cookie("ts_at", cookies.accessToken, cookieOpts(cookies.accessTtlMs));
  res.cookie("ts_rt", cookies.refreshToken, cookieOpts(cookies.refreshTtlMs));
  res.cookie("ts_csrf", cookies.csrfToken, cookieOpts(cookies.refreshTtlMs, false));
}

function respondStep(res: import("express").Response, result: LoginStepResult) {
  if (result.step === "SESSION") {
    setSessionCookies(res, result.cookies);
    return res.json({ status: "SESSION", user: result.user });
  }
  if (result.step === "MFA_REQUIRED") return res.json({ status: "MFA_REQUIRED", challenge: result.challenge });
  if (result.step === "MFA_ENROLLMENT_REQUIRED") {
    return res.json({ status: "MFA_ENROLLMENT_REQUIRED", challenge: result.challenge, otpauthUrl: result.otpauthUrl });
  }
  return res.json({ status: "SELECT_ORGANISATION", challenge: result.challenge, organisations: result.organisations });
}

const loginSchema = z.object({ identifier: z.string().min(1), password: z.string().min(1) });

authRouter.post("/:portal/login", async (req, res, next) => {
  try {
    const portal = PORTAL_MAP[req.params.portal ?? ""];
    if (!portal) return next(Errors.notFound("Login portal"));
    const body = loginSchema.parse(req.body);
    const ip = req.ip ?? null;
    const result = await authService.login(portal, body.identifier, body.password, ip);
    respondStep(res, result);
  } catch (err) {
    next(err);
  }
});

const mfaVerifySchema = z.object({ challenge: z.string().min(1), code: z.string().min(4).max(10) });

authRouter.post("/mfa/verify", async (req, res, next) => {
  try {
    const body = mfaVerifySchema.parse(req.body);
    const result = await authService.verifyMfa(body.challenge, body.code);
    respondStep(res, result);
  } catch (err) {
    next(err);
  }
});

const selectOrgSchema = z.object({ challenge: z.string().min(1), organisationId: z.string().uuid() });

authRouter.post("/select-organisation", async (req, res, next) => {
  try {
    const body = selectOrgSchema.parse(req.body);
    const result = await authService.selectOrganisation(body.challenge, body.organisationId);
    respondStep(res, result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies?.["ts_rt"];
    if (!token) return next(Errors.sessionExpired());
    const result = await authService.refreshSession(token);
    respondStep(res, result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const ctx = req.ctx as RequestContext;
    await authService.logout(ctx.sessionId, ctx.userId);
    res.clearCookie("ts_at", { path: "/" });
    res.clearCookie("ts_rt", { path: "/" });
    res.clearCookie("ts_csrf", { path: "/" });
    res.json({ status: "OK" });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx as RequestContext;
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, name: true, email: true, portalType: true },
    });
    if (!user) return next(Errors.sessionExpired());
    const organisation = ctx.organisationId
      ? await prisma.organisation.findUnique({ where: { id: ctx.organisationId }, select: { id: true, displayName: true } })
      : null;
    res.json({
      user: { id: user.id, name: user.name, email: user.email, portal: user.portalType },
      organisation,
      roles: ctx.roles,
    });
  } catch (err) {
    next(err);
  }
});

const registerBidderSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  contactName: z.string().min(1),
  mobile: z.string().optional(),
  legalName: z.string().min(1),
  orgSubtype: z.string().min(1),
  pan: z.string().optional(),
  cin: z.string().optional(),
});

authRouter.post("/register/bidder", async (req, res, next) => {
  try {
    const body = registerBidderSchema.parse(req.body);
    const result = await registerBidder(body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
