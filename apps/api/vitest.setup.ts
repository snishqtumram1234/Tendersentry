// Unit tests never touch the network or a database, but importing anything that transitively
// imports config.ts still runs its zod validation at module-load time. Provide safe dummy values
// so that validation passes — these are never actually connected to. Values already set (e.g. by
// `dotenv -e .env` for `pnpm test:int`) are left alone.
const defaults: Record<string, string> = {
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:8080",
  ENGINE_URL: "http://localhost:8000",
  ENGINE_TOKEN: "unit-test-engine-token-0000000000",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  DIRECT_URL: "postgresql://test:test@localhost:5432/test",
  STORAGE_ENDPOINT: "http://localhost:54321/storage/v1/s3",
  STORAGE_REGION: "local",
  STORAGE_ACCESS_KEY: "test",
  STORAGE_SECRET_KEY: "test",
  SESSION_JWT_SECRET: "unit-test-session-secret-unit-test-session-secret-32bytes",
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
