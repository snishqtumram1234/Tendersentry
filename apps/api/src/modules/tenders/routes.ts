// spec §19: tenders, requirements, rules, publication (Phase 2 scope — see service.ts header for
// the deviations from the full spec).
import { Router } from "express";
import { z } from "zod";
import { ProcurementMode, ReferenceDatePolicy } from "@prisma/client";
import { requireAuth, requireCsrf, requirePermission, type RequestContext } from "../../authz/middleware.js";
import { Errors } from "../../lib/errors.js";
import * as tenders from "./service.js";

export const tendersRouter = Router();
export const publicTendersRouter = Router();

function requireOrgContext(ctx: RequestContext | undefined): asserts ctx is RequestContext & { organisationId: string } {
  if (!ctx) throw Errors.sessionExpired();
  if (!ctx.organisationId) throw Errors.forbidden();
}

const createTenderSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.string().optional(),
  department: z.string().optional(),
  objective: z.string().optional(),
  procurementMode: z.nativeEnum(ProcurementMode).default("SINGLE_ENVELOPE"),
  estimatedValue: z.string().optional(),
  valuePublic: z.boolean().optional(),
  quantity: z.string().optional(),
  deliveryLocation: z.string().optional(),
  requiredBy: z.string().datetime().optional().or(z.string().date().optional()),
  bidOpenAt: z.string().datetime().optional(),
  bidDeadline: z.string().datetime().optional(),
  techOpeningAt: z.string().datetime().optional(),
  referenceDatePolicy: z.nativeEnum(ReferenceDatePolicy).optional(),
});

tendersRouter.post("/", requireAuth, requireCsrf, requirePermission("tender.create"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = createTenderSchema.parse(req.body);
    const tender = await tenders.createTender({ organisationId: ctx.organisationId, createdBy: ctx.userId, ...body });
    res.status(201).json(tender);
  } catch (err) {
    next(err);
  }
});

tendersRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await tenders.listTendersForOrg(ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

tendersRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await tenders.getTenderForOrg(req.params.id as string, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

const attachDocSchema = z.object({ documentId: z.string().uuid(), role: z.enum(["MAIN", "ANNEXURE", "SCHEDULE", "OTHER"]).default("MAIN") });

tendersRouter.post("/:id/documents", requireAuth, requireCsrf, requirePermission("tender.edit_draft"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = attachDocSchema.parse(req.body);
    const result = await tenders.attachTenderDocument(req.params.id as string, ctx.organisationId, body.documentId, body.role, ctx.userId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

tendersRouter.get("/:id/documents", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await tenders.listTenderDocuments(req.params.id as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

tendersRouter.post("/:id/analyze", requireAuth, requireCsrf, requirePermission("rule.compile"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const result = await tenders.analyzeTender(req.params.id as string, ctx.organisationId, ctx.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

tendersRouter.get("/:id/requirements", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await tenders.listRequirements(req.params.id as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

tendersRouter.get("/:id/rules", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await tenders.listTenderRules(req.params.id as string, ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

tendersRouter.post("/:id/validate", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await tenders.validateForPublication(req.params.id as string, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

tendersRouter.post("/:id/publish", requireAuth, requireCsrf, requirePermission("tender.publish"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await tenders.publishTender(req.params.id as string, ctx.organisationId, ctx.userId));
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────── Rules (top-level, not nested under /tenders) ───────────────────────────────

export const rulesRouter = Router();

rulesRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await tenders.getRuleReviewData(req.params.id as string, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

const editSchema = z.object({ dsl: z.record(z.string(), z.unknown()), editReason: z.string().min(1).optional() });

rulesRouter.post("/:id/versions", requireAuth, requireCsrf, requirePermission("rule.edit"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = editSchema.parse(req.body);
    res.status(201).json(await tenders.editRule(req.params.id as string, ctx.organisationId, ctx.userId, body));
  } catch (err) {
    next(err);
  }
});

export const ruleVersionsRouter = Router();

ruleVersionsRouter.post("/:id/approve", requireAuth, requireCsrf, requirePermission("rule.approve"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await tenders.approveRuleVersion(req.params.id as string, ctx.organisationId, ctx.userId));
  } catch (err) {
    next(err);
  }
});

const rejectSchema = z.object({ reason: z.string().min(1) });

ruleVersionsRouter.post("/:id/reject", requireAuth, requireCsrf, requirePermission("rule.reject"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = rejectSchema.parse(req.body);
    res.json(await tenders.rejectRuleVersion(req.params.id as string, ctx.organisationId, ctx.userId, body.reason));
  } catch (err) {
    next(err);
  }
});

const resolveAmbiguitySchema = z.object({ code: z.string().min(1), resolution: z.string().min(1) });

ruleVersionsRouter.post("/:id/resolve-ambiguity", requireAuth, requireCsrf, requirePermission("rule.edit"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = resolveAmbiguitySchema.parse(req.body);
    res.json(await tenders.resolveAmbiguity(req.params.id as string, ctx.organisationId, ctx.userId, body.code, body.resolution));
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────── Public (no auth — spec §21.5) ───────────────────────────────

publicTendersRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ items: await tenders.listPublicTenders() });
  } catch (err) {
    next(err);
  }
});

publicTendersRouter.get("/:publicId", async (req, res, next) => {
  try {
    res.json(await tenders.getPublicTender(req.params.publicId as string));
  } catch (err) {
    next(err);
  }
});
