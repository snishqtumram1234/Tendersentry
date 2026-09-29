// Exception workspace endpoints (spec §15.7, §19).
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireCsrf, requirePermission, type RequestContext } from "../../authz/middleware.js";
import { Errors } from "../../lib/errors.js";
import * as exceptionsService from "./service.js";

export const bidExceptionsRouter = Router({ mergeParams: true }); // mounted under /bids/:bidId/exceptions
export const exceptionsRouter = Router(); // mounted under /exceptions

function requireOrgContext(ctx: RequestContext | undefined): asserts ctx is RequestContext & { organisationId: string } {
  if (!ctx) throw Errors.sessionExpired();
  if (!ctx.organisationId) throw Errors.forbidden();
}

bidExceptionsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await exceptionsService.listExceptionsForBid(req.params.bidId as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

const resolveSchema = z.object({ resolution: z.string().min(1) });

exceptionsRouter.post("/:id/resolve", requireAuth, requireCsrf, requirePermission("exception.resolve"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = resolveSchema.parse(req.body);
    res.json(await exceptionsService.resolveException(req.params.id as string, ctx.organisationId, ctx.userId, body.resolution));
  } catch (err) {
    next(err);
  }
});

const assignSchema = z.object({ assigneeId: z.string().uuid() });

exceptionsRouter.post("/:id/assign", requireAuth, requireCsrf, requirePermission("exception.assign"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = assignSchema.parse(req.body);
    res.json(await exceptionsService.assignException(req.params.id as string, ctx.organisationId, ctx.userId, body.assigneeId));
  } catch (err) {
    next(err);
  }
});
