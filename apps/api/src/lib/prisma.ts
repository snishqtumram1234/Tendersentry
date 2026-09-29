// Single Prisma client for the runtime (ts_app role, pooled connection — spec §7.0, ADR-003).
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
