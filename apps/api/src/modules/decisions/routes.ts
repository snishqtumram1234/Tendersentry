// Officer decision endpoints (spec §15.8, §19), mounted under /bids/:bidId/decisions.
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireCsrf, requirePermission, type RequestContext } from "../../authz/middleware.js";
import { Errors } from "../../lib/errors.js";
import * as decisionsService from "./service.js";

export const decisionsRouter = Router({ mergeParams: true }); // mounted under /bids/:bidId/decisions

function requireOrgContext(ctx: RequestContext | undefined): asserts ctx is RequestContext & { organisationId: string } {
  if (!ctx) throw Errors.sessionExpired();
  if (!ctx.organisationId) throw Errors.forbidden();
}

const decisionSchema = z.object({
  action: z.enum(["TECHNICALLY_COMPLIANT", "TECHNICALLY_NON_COMPLIANT", "NEEDS_CLARIFICATION", "REFER_TO_COMMITTEE", "FINAL_DECISION"]),
  note: z.string().optional(),
  acknowledgedExceptionIds: z.array(z.string().uuid()).optional(),
});

decisionsRouter.post("/", requireAuth, requireCsrf, requirePermission("decision.record"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = decisionSchema.parse(req.body);
    // A user's primary role for this record is their first assigned role in this org — the
    // permission check above already confirmed at least one grants decision.record.
    const role = ctx.roles[0];
    if (!role) throw Errors.forbidden();
    res.status(201).json(await decisionsService.recordDecision(req.params.bidId as string, ctx.organisationId, ctx.userId, role, body));
  } catch (err) {
    next(err);
  }
});

decisionsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await decisionsService.listDecisions(req.params.bidId as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});
