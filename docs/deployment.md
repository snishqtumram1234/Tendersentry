# Deployment

TenderSentry runs on **Supabase** (Postgres + Storage) plus app containers (web/Caddy, api, worker, engine, Redis).
Background: docs/BUILD_SPEC.md §25 and docs/DECISIONS.md ADR-001..004.

## Local development

Prerequisites: Docker Desktop (running), Node 20, pnpm (`corepack enable pnpm`), Supabase CLI (installed as a
dev dependency; run via `pnpm supabase …`).

```bash
cp .env.example .env
pnpm install
pnpm supabase start          # Postgres :54322, API/Storage :54321, Studio :54323, Mailpit :54324
pnpm supabase status         # copy the S3 access key/secret into STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY
pnpm db:migrate              # applies prelude, schema, integrity + lock-down migrations as postgres
psql "postgresql://postgres:postgres@localhost:54322/postgres" -v pw="'ts_app_local_only'" -f apps/api/prisma/sql/set-app-role-password.sql
pnpm seed
docker compose up --build    # http://localhost:8080
```

Buckets (`documents`, `captures`, `reports`, `page-images`) are created private from `supabase/config.toml`.

## Hosted Supabase (demo / staging / production)

One Supabase project per environment. Region: `ap-south-1` (Mumbai) preferred.

1. **Create the project**; store the database password in your secret manager.
2. **Auth**: Authentication → Providers → disable email sign-ups (Supabase Auth is not used; ADR-002).
3. **Storage**: create private buckets `documents`, `captures`, `reports`, `page-images`; set the project upload
   limit ≥ `FILE_MAX_MB`. Storage → S3 connection → create an access key pair → `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`.
   `STORAGE_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3`, `STORAGE_REGION=<project region>`.
4. **Migrate** as `postgres` over the session/direct connection:
   `DIRECT_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require pnpm db:migrate`
5. **Runtime role password**: `psql "$DIRECT_URL" -v pw="'<strong>'" -f apps/api/prisma/sql/set-app-role-password.sql`
6. **Runtime connection** (transaction pooler, `ts_app`):
   `DATABASE_URL=postgresql://ts_app.<ref>:<strong>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5&sslmode=require`
7. **Network restrictions**: Database → Network restrictions → allow only the app VM's egress IP.
8. **Verify lock-down**: `pnpm --filter api test:int -t lockdown` against the project (anon/authenticated
   must not read any app table; `ts_private.unlocked_tables()` returns zero rows).
9. **Backups**: enable PITR for production; nightly `scripts/backup.sh` (`pg_dump` over `DIRECT_URL`) and Storage export.
10. Deploy containers: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` with `APP_ENV=production`.

Notes:
- Free-tier projects pause after inactivity; `/admin/health` reports the database as unreachable when paused.
- Never put `SUPABASE_SERVICE_ROLE_KEY`, database passwords or S3 keys in `apps/web` or its build environment.
- The seed refuses to run when `APP_ENV=production`.

## CI (.github/workflows/ci.yml)

Two jobs (`web-api`, `engine`) always run and need no secrets — lint, typecheck, unit tests
(spec §23.1), builds, ruff/mypy/pytest, gitleaks, dependency audit (non-blocking for now).

A third job, `db-integration`, runs the tests that hit a real database (spec §23.2) — cross-org
tenancy, permission enforcement — against a **dedicated CI/staging Supabase project** (never the
demo or production one). It's automatically skipped with a clear notice until these repository
secrets are set (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `DATABASE_URL` | pooled `ts_app` connection string for the CI project |
| `DIRECT_URL` | direct `postgres` connection string for the CI project |
| `TS_APP_DB_PASSWORD` | the `ts_app` role's password on that project (same value embedded in `DATABASE_URL`) |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | that project's Storage S3 credentials |
| `APP_ENCRYPTION_KEY` | any valid 32-byte base64 key — CI-only, unrelated to other environments' keys |

Set these up the same way as any hosted environment (§"Hosted Supabase" above): create the
project, run migrations, then `pnpm db:setup` once locally against it before relying on CI.
