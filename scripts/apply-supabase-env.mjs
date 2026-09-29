#!/usr/bin/env node
// Reads the 6 raw Supabase values at the top of .env and fills in the derived
// connection strings (DATABASE_URL, DIRECT_URL, SUPABASE_URL, STORAGE_*) below.
// Safe to re-run any time you update one of the 6 raw values.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
const raw = {};
for (const line of lines) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) raw[m[1]] = m[2].trim();
}

const need = [
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_POOLER_HOST",
  "SUPABASE_REGION",
  "SUPABASE_STORAGE_ACCESS_KEY",
  "SUPABASE_STORAGE_SECRET_KEY",
];
const missing = need.filter((k) => !raw[k]);
if (missing.length) {
  console.error(
    `Missing values at the top of .env: ${missing.join(", ")}\n` +
      "Fill those in first (see docs/deployment.md → Hosted Supabase), then run this again."
  );
  process.exit(1);
}

const ref = raw.SUPABASE_PROJECT_REF;
const pooler = raw.SUPABASE_POOLER_HOST;
const dbPwEncoded = encodeURIComponent(raw.SUPABASE_DB_PASSWORD);
const appPw = raw.TS_APP_DB_PASSWORD; // already URL-safe (generated)

const derived = {
  DATABASE_URL: `postgresql://ts_app.${ref}:${appPw}@${pooler}:6543/postgres?pgbouncer=true&connection_limit=5&sslmode=require`,
  DIRECT_URL: `postgresql://postgres.${ref}:${dbPwEncoded}@${pooler}:5432/postgres?sslmode=require`,
  SUPABASE_URL: `https://${ref}.supabase.co`,
  STORAGE_ENDPOINT: `https://${ref}.supabase.co/storage/v1/s3`,
  STORAGE_REGION: raw.SUPABASE_REGION,
  STORAGE_ACCESS_KEY: raw.SUPABASE_STORAGE_ACCESS_KEY,
  STORAGE_SECRET_KEY: raw.SUPABASE_STORAGE_SECRET_KEY,
};

const out = lines
  .map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && m[1] in derived) return `${m[1]}=${derived[m[1]]}`;
    return line;
  })
  .join("\n");

writeFileSync(envPath, out);
console.log("✓ .env updated:");
for (const k of Object.keys(derived)) {
  if (k.includes("SECRET") || k === "DATABASE_URL" || k === "DIRECT_URL") console.log(`  ${k}=(set)`);
  else console.log(`  ${k}=${derived[k]}`);
}
console.log("\nNext: pnpm db:migrate   then   pnpm db:setup");
