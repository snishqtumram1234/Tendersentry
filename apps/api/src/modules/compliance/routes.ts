// Compliance run endpoints (spec §15.1, §19). Officer-triggered manual runs plus read access for
// both the government org that owns the tender and the bidder org that owns the bid.
import { Router } from "express";
import { requireAuth, requireCsrf, requirePermission, type RequestContext } from "../../authz/middleware.js";
import { Errors } from "../../lib/errors.js";
import * as complianceService from "./service.js";

export const complianceRouter = Router({ mergeParams: true }); // mounted under /bids/:bidId/compliance

function requireOrgContext(ctx: RequestContext | undefined): asserts ctx is RequestContext & { organisationId: string } {
  if (!ctx) throw Errors.sessionExpired();
  if (!ctx.organisationId) throw Errors.forbidden();
}

complianceRouter.post("/run", requireAuth, requireCsrf, requirePermission("evaluation.run"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.status(201).json(await complianceService.triggerManualRun(req.params.bidId as string, ctx.userId, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

complianceRouter.get("/latest", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await complianceService.getLatestRun(req.params.bidId as string, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

complianceRouter.get("/runs", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await complianceService.listRuns(req.params.bidId as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

export const complianceRunsRouter = Router(); // mounted under /compliance-runs

complianceRunsRouter.get("/:runId", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await complianceService.getRun(req.params.runId as string, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});
