// Boot-time configuration validation (spec §5, §24). Fail fast on missing/unsafe values.
import { z } from "zod";

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === "true");

const schema = z
  .object({
    APP_ENV: z.enum(["local", "demo", "staging", "production"]).default("local"),
    APP_BASE_URL: z.string().url(),
    API_PORT: z.coerce.number().int().positive().default(4000),
    ENGINE_URL: z.string().url(),
    ENGINE_TOKEN: z.string().min(16),

    DATABASE_URL: z.string().min(1),
    DIRECT_URL: z.string().min(1),

    STORAGE_ENDPOINT: z.string().url(),
    STORAGE_REGION: z.string().min(1),
    STORAGE_ACCESS_KEY: z.string().min(1),
    STORAGE_SECRET_KEY: z.string().min(1),
    STORAGE_BUCKET_DOCUMENTS: z.string().default("documents"),
    STORAGE_BUCKET_CAPTURES: z.string().default("captures"),
    STORAGE_BUCKET_REPORTS: z.string().default("reports"),
    STORAGE_BUCKET_PAGE_IMAGES: z.string().default("page-images"),
    FILE_MAX_MB: z.coerce.number().int().positive().default(25),

    REDIS_URL: z.string().default("redis://localhost:6379"),
    SESSION_JWT_SECRET: z.string().min(32),
    SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    APP_ENCRYPTION_KEY: z.string().min(1),

    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().default(""),
    SMTP_PASSWORD: z.string().default(""),
    MAIL_FROM: z.string().default("TenderSentry <no-reply@tendersentry.local>"),

    MODEL_PROVIDER: z.enum(["anthropic", "openai", "none"]).default("anthropic"),
    MODEL_NAME: z.string().default(""),
    MODEL_PROVIDER_KEY: z.string().default(""),
    LLM_ALLOW_BIDDER_DOCS: boolFromEnv,

    DEMO_MODE: boolFromEnv,
    DEMO_OTP: z.string().default("000000"),
    SIMULATED_ADAPTER_ENABLED: boolFromEnv,

    FEATURE_RELATIONSHIP_GRAPH: boolFromEnv,
    FEATURE_TENDER_COPILOT: boolFromEnv,
  })
  .superRefine((c, ctx) => {
    if (c.APP_ENV === "production") {
      if (c.DEMO_MODE) ctx.addIssue({ code: "custom", message: "DEMO_MODE must be false in production" });
      if (c.SIMULATED_ADAPTER_ENABLED) ctx.addIssue({ code: "custom", message: "SIMULATED_ADAPTER_ENABLED must be false in production" });
      if (!c.APP_BASE_URL.startsWith("https://")) ctx.addIssue({ code: "custom", message: "APP_BASE_URL must be HTTPS in production" });
      if (!c.SMTP_HOST) ctx.addIssue({ code: "custom", message: "SMTP_HOST is required in production" });
      if (c.SESSION_JWT_SECRET.length < 64) ctx.addIssue({ code: "custom", message: "SESSION_JWT_SECRET must be at least 64 chars in production" });
      if (!c.DIRECT_URL.includes("sslmode=require") && !c.DATABASE_URL.includes("sslmode=require")) {
        ctx.addIssue({ code: "custom", message: "database connections must use sslmode=require in production" });
      }
    }
  });

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid configuration:\n" + parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
    process.exit(1);
  }
  return parsed.data;
}

export const config = load();
