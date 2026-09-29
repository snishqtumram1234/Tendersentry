// spec §19: bidder profile, vault, readiness.
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { DocType } from "@prisma/client";
import { requireAuth, requireCsrf, requirePermission, type RequestContext } from "../../authz/middleware.js";
import { Errors } from "../../lib/errors.js";
import { config } from "../../config.js";
import * as bidderService from "./service.js";

export const bidderRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.FILE_MAX_MB * 1024 * 1024 } });

function requireOrgContext(ctx: RequestContext | undefined): asserts ctx is RequestContext & { organisationId: string } {
  if (!ctx) throw Errors.sessionExpired();
  if (!ctx.organisationId) throw Errors.forbidden();
}

bidderRouter.get("/profile", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json(await bidderService.getBidderProfile(ctx.organisationId));
  } catch (err) {
    next(err);
  }
});

bidderRouter.get("/vault", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    res.json({ items: await bidderService.listVaultItems(ctx.organisationId) });
  } catch (err) {
    next(err);
  }
});

const vaultFieldsSchema = z.object({
  evidenceType: z.nativeEnum(DocType),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
});

bidderRouter.post("/vault", requireAuth, requireCsrf, requirePermission("bidder.evidence.manage"), upload.single("file"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    if (!req.file) return next(Errors.validation("No file was uploaded. Send it as multipart field 'file'."));
    const fields = vaultFieldsSchema.parse(req.body ?? {});
    const result = await bidderService.addVaultItem({
      organisationId: ctx.organisationId,
      uploadedBy: ctx.userId,
      originalFilename: req.file.originalname,
      buffer: req.file.buffer,
      evidenceType: fields.evidenceType,
      validFrom: fields.validFrom,
      validUntil: fields.validUntil,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

bidderRouter.post("/tenders/:tenderId/readiness", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const items = await bidderService.checkReadiness(req.params.tenderId as string, ctx.organisationId);
    res.json({ preview: true, items });
  } catch (err) {
    next(err);
  }
});
