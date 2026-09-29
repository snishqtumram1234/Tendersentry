// spec §19: bidder bid workspace (create, attach documents, pre-check, submit).
import { Router } from "express";
import { z } from "zod";
import { Envelope } from "@prisma/client";
import { requireAuth, requireCsrf, requirePermission, type RequestContext } from "../../authz/middleware.js";
import { Errors } from "../../lib/errors.js";
import * as bidService from "./service.js";

// mergeParams is required so `:tenderId` from the mount path
// (/api/v1/bidder/tenders/:tenderId/bids) reaches this router's own req.params — without it,
// Express only exposes params matched by this router's OWN path patterns, and req.params.tenderId
// is silently undefined (caught by an actual failed request, not a type error — Prisma correctly
// rejected the resulting `where: { id: undefined }` rather than doing something unpredictable).
export const bidderTendersBidsRouter = Router({ mergeParams: true }); // mounted under /bidder/tenders/:tenderId/bids
export const bidsRouter = Router(); // mounted under /bids
export const tenderBidsRouter = Router({ mergeParams: true }); // mounted under /tenders/:id/bids (government side)

function requireOrgContext(ctx: RequestContext | undefined): asserts ctx is RequestContext & { organisationId: string } {
  if (!ctx) throw Errors.sessionExpired();
  if (!ctx.organisationId) throw Errors.forbidden();
}

bidderTendersBidsRouter.post("/", requireAuth, requireCsrf, requirePermission("bid.prepare"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const bid = await bidService.createBid(req.params.tenderId as string, ctx.organisationId, ctx.userId);
    res.status(201).json(bid);
  } catch (err) {
    next(err);
  }
});

bidsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await bidService.listBidsForOrg(ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

bidsRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await bidService.getBidForOrg(req.params.id as string, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

const attachDocSchema = z.object({
  documentId: z.string().uuid(),
  envelope: z.nativeEnum(Envelope).default("TECHNICAL"),
  requirementCodes: z.array(z.string()).default([]),
});

bidsRouter.post("/:id/documents", requireAuth, requireCsrf, requirePermission("bid.prepare"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = attachDocSchema.parse(req.body);
    res.status(201).json(await bidService.attachBidDocument(req.params.id as string, ctx.organisationId, ctx.userId, body));
  } catch (err) {
    next(err);
  }
});

bidsRouter.get("/:id/claims", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await bidService.listClaimsForBid(req.params.id as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

bidsRouter.get("/:id/documents", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await bidService.listBidDocuments(req.params.id as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

bidsRouter.post("/:id/precheck", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await bidService.precheckBid(req.params.id as string, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

const submitSchema = z.object({ declarationAccepted: z.boolean() });

bidsRouter.post("/:id/submit", requireAuth, requireCsrf, requirePermission("bid.submit"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = submitSchema.parse(req.body);
    res.json(await bidService.submitBid(req.params.id as string, ctx.organisationId, ctx.userId, body));
  } catch (err) {
    next(err);
  }
});

tenderBidsRouter.get("/", requireAuth, requirePermission("bid.view_technical"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await bidService.listBidsForTender(req.params.id as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});
