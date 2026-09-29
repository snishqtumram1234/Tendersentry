// Verification human queue endpoints (spec §14.4, §19).
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireCsrf, requirePermission, type RequestContext } from "../../authz/middleware.js";
import { Errors } from "../../lib/errors.js";
import { config } from "../../config.js";
import * as verificationService from "./service.js";

export const verificationRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.FILE_MAX_MB * 1024 * 1024 } });

function requireOrgContext(ctx: RequestContext | undefined): asserts ctx is RequestContext & { organisationId: string } {
  if (!ctx) throw Errors.sessionExpired();
  if (!ctx.organisationId) throw Errors.forbidden();
}

verificationRouter.post("/claims/:claimId/request", requireAuth, requireCsrf, requirePermission("verification.assign"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.status(201).json(await verificationService.requestVerification(req.params.claimId as string, ctx.organisationId, ctx.userId));
  } catch (err) {
    next(err);
  }
});

verificationRouter.get("/tasks", requireAuth, requirePermission("verification.work"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const statusParam = req.query.status;
    const statuses = typeof statusParam === "string" ? (statusParam.split(",") as never) : undefined;
    res.json({ items: await verificationService.listTasks(ctx.organisationId, statuses) });
  } catch (err) {
    next(err);
  }
});

verificationRouter.get("/metrics", requireAuth, requirePermission("verification.work"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await verificationService.getMetrics(ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

verificationRouter.post("/tasks/:id/start", requireAuth, requireCsrf, requirePermission("verification.work"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await verificationService.startTask(req.params.id as string, ctx.userId, ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

const resultSchema = z.object({
  outcome: z.enum(["MATCH", "NO_MATCH", "NOT_FOUND", "SOURCE_ERROR"]),
  observedValues: z.string().optional(), // JSON string when sent via multipart
  note: z.string().optional(),
});

verificationRouter.post("/tasks/:id/result", requireAuth, requireCsrf, requirePermission("verification.work"), upload.single("capture"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = resultSchema.parse(req.body ?? {});
    let observedValues: Record<string, unknown> | undefined;
    if (body.observedValues) {
      try {
        observedValues = JSON.parse(body.observedValues) as Record<string, unknown>;
      } catch {
        return next(Errors.validation("observedValues must be valid JSON."));
      }
    }
    const result = await verificationService.recordResult(req.params.id as string, ctx.userId, ctx.organisationId, {
      outcome: body.outcome,
      observedValues,
      note: body.note,
      capture: req.file ? { originalFilename: req.file.originalname, buffer: req.file.buffer } : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const unavailableSchema = z.object({ reason: z.string().min(1) });

verificationRouter.post("/tasks/:id/unavailable", requireAuth, requireCsrf, requirePermission("verification.work"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const body = unavailableSchema.parse(req.body ?? {});
    res.json(await verificationService.markUnavailable(req.params.id as string, ctx.userId, ctx.organisationId, body.reason));
  } catch (err) {
    next(err);
  }
});
