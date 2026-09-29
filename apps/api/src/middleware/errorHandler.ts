// Uniform error response shape (spec §4.5).
import type { ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { ApiError } from "../lib/errors.js";
import { config } from "../config.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

  if (err instanceof MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? `File exceeds the ${config.FILE_MAX_MB}MB limit.` : err.message;
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message, retryable: false, details: {}, requestId } });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, retryable: err.retryable, details: err.details, requestId },
    });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request.", retryable: false, details: { issues: err.issues }, requestId },
    });
  }

  req.log?.error({ err, requestId }, "unhandled error");
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong.", retryable: true, details: {}, requestId },
  });
};
