import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { rateLimit } from "express-rate-limit";
import { loadContext } from "./authz/middleware.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/routes.js";
import { auditRouter } from "./modules/audit/routes.js";
import { documentsRouter } from "./modules/documents/routes.js";
import { tendersRouter, rulesRouter, ruleVersionsRouter, publicTendersRouter } from "./modules/tenders/routes.js";
import { bidderRouter } from "./modules/bidder/routes.js";
import { bidderTendersBidsRouter, bidsRouter, tenderBidsRouter } from "./modules/bids/routes.js";
import { complianceRouter, complianceRunsRouter } from "./modules/compliance/routes.js";
import { verificationRouter } from "./modules/verification/routes.js";
import { decisionsRouter } from "./modules/decisions/routes.js";
import { bidExceptionsRouter, exceptionsRouter } from "./modules/exceptions/routes.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: config.APP_ENV === "production" ? undefined : false }));
  // Dev/demo: allow any localhost origin (the Vite dev server's port varies). Production: only
  // APP_BASE_URL. Credentials are required so the session/CSRF cookies are sent (spec §6.4).
  app.use(
    cors({
      origin:
        config.APP_ENV === "production"
          ? config.APP_BASE_URL
          : (origin, cb) => cb(null, !origin || /^https?:\/\/localhost:\d+$/.test(origin)),
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ redact: ["req.headers.cookie", "req.headers.authorization"] }));
  app.use(loadContext);

  // Auth endpoints get their own, tighter rate limit (spec §24). In-memory store for now
  // (TODO Phase 5+: Redis store, per docs/PROGRESS.md deviation log).
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
  app.use("/api/v1/auth", authLimiter, authRouter);
  app.use("/api/v1/audit", auditRouter);
  app.use("/api/v1/documents", documentsRouter);
  app.use("/api/v1/tenders", tendersRouter);
  app.use("/api/v1/rules", rulesRouter);
  app.use("/api/v1/rule-versions", ruleVersionsRouter);
  app.use("/api/v1/bidder/tenders/:tenderId/bids", bidderTendersBidsRouter);
  app.use("/api/v1/bidder", bidderRouter);
  app.use("/api/v1/bids", bidsRouter);
  app.use("/api/v1/tenders/:id/bids", tenderBidsRouter);
  app.use("/api/v1/bids/:bidId/compliance", complianceRouter);
  app.use("/api/v1/compliance-runs", complianceRunsRouter);
  app.use("/api/v1/bids/:bidId/decisions", decisionsRouter);
  app.use("/api/v1/bids/:bidId/exceptions", bidExceptionsRouter);
  app.use("/api/v1/exceptions", exceptionsRouter);
  app.use("/api/v1/verification", verificationRouter);

  // Public tender pages (spec §21.5): no auth, own rate limit.
  const publicLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
  app.use("/api/v1/public/tenders", publicLimiter, publicTendersRouter);

  app.get("/api/v1/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "OK", db: "OK" });
    } catch {
      res.status(503).json({ status: "DEGRADED", db: "UNREACHABLE" });
    }
  });

  app.use(errorHandler);
  return app;
}
