// Audit chain verification endpoint (spec §16, §19 GET /audit/verify-chain).
import { Router } from "express";
import { requireAuth, requirePermission } from "../../authz/middleware.js";
import { prisma } from "../../lib/prisma.js";
import { verifyChain } from "../../audit/service.js";

export const auditRouter = Router();

auditRouter.get("/verify-chain", requireAuth, requirePermission("audit.read"), async (_req, res, next) => {
  try {
    const result = await verifyChain(prisma);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
