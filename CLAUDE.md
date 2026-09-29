# TenderSentry

Full spec: docs/BUILD_SPEC.md — read the relevant section before starting any task.
Progress: docs/PROGRESS.md · Decisions (ADRs): docs/DECISIONS.md

## What it is

TenderSentry is a tender-aware, evidence-first, AI-assisted compliance verification and decision-support
platform for government procurement (GeM ecosystem). It turns tender clauses into officer-approved
structured rules (closed JSON DSL), processes bidder documents, extracts claims with page/bbox provenance,
verifies them through honest sources (or a human queue), reconciles across documents, evaluates compliance
deterministically, produces an explainable score and a separate risk level, surfaces exceptions on a
multi-bidder dashboard, and records every step in a tamper-evident audit trail. The officer decides.

## Stack

- Database + object storage: **Supabase** (Postgres via Prisma; Storage via its S3-compatible endpoint).
  Local dev uses the Supabase CLI stack. The browser never talks to Supabase directly.
- `apps/web` React 18 + Vite + TS · `apps/api` Express + TS + Prisma · `apps/worker` BullMQ (Redis)
- `services/engine` Python 3.12 FastAPI (documents, extraction, rules, compliance, verification, reports)
- Auth is app-owned (three portals, argon2id, TOTP). Supabase Auth is NOT used.

## Non-negotiable rules (spec §2)

1. No fake government integrations; `LIVE_VALIDATED` only from a recorded, successful system health check.
2. No fake verification: SIMULATED results never reach `AUTHORITATIVE_VERIFIED`; simulated adapter off in production.
3. Never execute LLM-generated code (no eval/exec/Function/dynamic import). LLM emits DSL JSON; the interpreter runs it.
4. No AI-only compliance: only APPROVED/ACTIVE rule versions with an approving officer ID execute.
5. No silent overrides: every change is a new record with reason, actor, time; originals preserved.
6. Never display "fraud", "collusion", "suspicious", "blacklisted" etc. Use Identity conflict / Evidence conflict /
   Relationship signal / Review required.
7. Badge is "TenderSentry Verified" with its definition — never a legal "verified bidder" claim.
8. No invented numbers/percentages; only dated benchmark outputs (§23.4).
9. No cross-organisation exposure, enforced server-side on every query. Supabase Data API is closed:
   RLS on every app table, only the `ts_app` policy, nothing granted to `anon`/`authenticated`.
10. No financial-bid leakage before authorised opening (serializer stripping everywhere, incl. search/reports).
11. Every result traceable to evidence. 12. Rules versioned; approved versions immutable.
13. Every critical mutation writes an audit event in the same DB transaction (hash chain, append-only).
14. Every external source has an explicit capability/status flag.
15. Frontend role hiding is cosmetic; the API enforces every permission.
16. Minimum necessary data to LLMs: clause text only for rule compilation; no bidder identifiers unless
    `LLM_ALLOW_BIDDER_DOCS=true`.
17. Idempotency (Idempotency-Key) on publish, submit bid, create verification, record decision, award.
18. Build the complete vertical slice before expanding features.
19. Supabase `service_role` key and DB passwords are server-side secrets only — never in `apps/web`, logs or git.

## Repo layout

```
apps/web  apps/api (prisma/{schema.prisma,migrations,sql})  apps/worker
services/engine (engine/{documents,extraction,rules,compliance,verification,reports,llm,common}, tests, golden)
packages/{types,rule-schema,ui,validators}
supabase/config.toml   database/seeds   docs/   tests/e2e
```

Conventions: no raw Prisma calls in route handlers — go through repositories that take a `RequestContext`.
State machines live in `transitions.ts` / `transitions.py`. Money is `Decimal`/`NUMERIC(20,2)`, never float.
Migrations are Prisma-owned (`apps/api/prisma/migrations`); do not add app schema to `supabase/migrations`.

## Commands

```
pnpm install
supabase start                 # local Postgres :54322, Storage/API :54321, Studio :54323, Mailpit :54324
pnpm db:migrate                # prisma migrate deploy over DIRECT_URL
pnpm seed                      # deterministic demo data (refuses APP_ENV=production)
docker compose up --build      # web(:8080) api worker engine redis
pnpm stack:up / stack:down     # all of the above
pnpm dev                       # web + api hot reload
pnpm test                      # vitest unit tests (no DB/network — spec §23.1)
pnpm --filter api test:int     # supertest + real hosted DB (spec §23.2); loads .env via dotenv-cli
cd services/engine && pytest   # engine tests + golden
pnpm e2e                       # playwright against the seeded stack
pnpm lint && pnpm typecheck    # eslint/prettier/tsc
cd services/engine && .venv/Scripts/python -m pytest && .venv/Scripts/ruff check . && .venv/Scripts/mypy engine
cd services/engine && .venv/Scripts/python -m dotenv -f ../../.env run -- .venv/Scripts/uvicorn engine.main:app --port 8000
```

**Local dev without Docker**: `.env`'s `ENGINE_URL=http://engine:8000` is the Docker Compose
hostname. Running `apps/api` standalone (`pnpm dev`, not via `docker compose`) needs it overridden:
`pnpm exec dotenv -e ../../.env -- env ENGINE_URL=http://localhost:8000 tsx watch src/server.ts`.
Same for `pnpm --filter api test:int` when the engine tests need it — prefix with
`env ENGINE_URL=http://localhost:8000` too, or those tests skip cleanly (by design) rather than
failing. `docker compose up` itself is unaffected.

## Working rules

- Build phase by phase (spec §27). Update docs/PROGRESS.md before/after each phase; log deviations.
- Record unspecified choices as short ADRs in docs/DECISIONS.md. Ask before adding paid services,
  weakening any §2 rule, or dropping an MVP feature.
- "Done" = UI + API + DB + validation + errors + loading/empty states + server permission + audit + tests.
