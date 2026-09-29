// spec §19: POST /documents, GET /documents/:id, GET /documents/:id/url.
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { DocType, Envelope } from "@prisma/client";
import { requireAuth, requireCsrf, type RequestContext } from "../../authz/middleware.js";
import { Errors } from "../../lib/errors.js";
import { config } from "../../config.js";
import * as documentService from "./service.js";

const uploadFieldsSchema = z.object({
  declaredType: z.nativeEnum(DocType).optional().or(z.literal("")),
  envelope: z.nativeEnum(Envelope).optional().or(z.literal("")),
});

export const documentsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.FILE_MAX_MB * 1024 * 1024 },
});

function requireOrgContext(ctx: RequestContext | undefined): asserts ctx is RequestContext & { organisationId: string } {
  if (!ctx) throw Errors.sessionExpired();
  if (!ctx.organisationId) throw Errors.forbidden();
}

documentsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const docs = await documentService.listDocumentsForOrg(ctx.organisationId);
    res.json({ items: docs });
  } catch (err) {
    next(err);
  }
});

documentsRouter.post("/", requireAuth, requireCsrf, upload.single("file"), async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    if (!req.file) return next(Errors.validation("No file was uploaded. Send it as multipart field 'file'."));
    const fields = uploadFieldsSchema.parse(req.body ?? {});

    const result = await documentService.uploadDocument({
      ownerOrgId: ctx.organisationId,
      uploadedBy: ctx.userId,
      originalFilename: req.file.originalname,
      buffer: req.file.buffer,
      declaredType: fields.declaredType || undefined,
      envelope: fields.envelope || undefined,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const doc = await documentService.getDocumentForOrg(req.params.id as string, ctx.organisationId);
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id/fields", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const fields = await documentService.getDocumentFields(req.params.id as string, ctx.organisationId);
    res.json({ items: fields });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id/claims", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const claims = await documentService.getDocumentClaims(req.params.id as string, ctx.organisationId);
    res.json({ items: claims });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:id/url", requireAuth, async (req, res, next) => {
  try {
    const ctx = req.ctx;
    requireOrgContext(ctx);
    const result = await documentService.getSignedDocumentUrl(req.params.id as string, {
      userId: ctx.userId,
      organisationId: ctx.organisationId,
      ip: req.ip ?? null,
      sessionId: ctx.sessionId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
