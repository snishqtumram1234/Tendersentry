# Architecture decision records

Short entries. Newest at the bottom. Status: Accepted unless noted.

## ADR-001 — Supabase as the database and storage platform (2026-09-28)

**Context.** The product owner asked for Supabase as the database. The spec already required
"PostgreSQL 16 (Supabase-compatible)" and an S3-compatible object store.

**Decision.** Supabase Postgres is the system of record in every environment (hosted project per
environment; Supabase CLI local stack for development). Supabase Storage replaces MinIO and is accessed
server-side through its S3-compatible endpoint, so the storage code stays on `@aws-sdk/client-s3`.
Prisma remains the ORM and sole owner of migrations (`apps/api/prisma/migrations`).

**Consequences.** `docker compose` no longer runs Postgres or MinIO; `pnpm stack:up` runs `supabase start`
first. Runtime connects through Supavisor (transaction mode, `pgbouncer=true`), so only
transaction-scoped advisory locks are used. Each environment is a separate Supabase project.

## ADR-002 — Keep app-owned auth; do not use Supabase Auth (2026-09-28)

**Context.** Spec §6.4 requires three portal-bound entry points, generic errors across portals, argon2id,
TOTP/email OTP, org resolution with a chooser, per-org roles, invitation flow and audit of every login
in the same transaction as the session write.

**Decision.** Keep the Express auth service. Supabase Auth sign-ups are disabled in `supabase/config.toml`
and in hosted projects.

**Consequences.** One identity store (`users`). No Supabase JWTs reach the browser, so RLS cannot key on
`auth.uid()`; tenancy stays in the API repository layer (see ADR-003). Revisit only if an approved
government SSO requires it.

## ADR-003 — Close Supabase's Data API with RLS + a single server-role policy (2026-09-28)

**Context.** Supabase exposes `public` through PostgREST/GraphQL to `anon`/`authenticated`. Our tenancy is
enforced in the API, not by RLS policies.

**Decision.** Every app table: `ENABLE ROW LEVEL SECURITY`, one policy `FOR ALL TO ts_app USING (true)
WITH CHECK (true)`, `REVOKE ALL` from `anon`, `authenticated` (and default privileges likewise). Runtime role
`ts_app` is a non-superuser without `BYPASSRLS`; migrations run as `postgres`. The anon key is never shipped
to the frontend. A test asserts `anon`/`authenticated` cannot read any app table and that every `public`
table has RLS enabled. **Verified 2026-09-28 against the hosted `demo` project** (`pnpm db:setup`):
0 unlocked tables out of 58; neither `anon` nor `authenticated` can read any of them.

**Consequences.** A leaked anon key exposes nothing. Append-only tables (`audit_events`, `tender_versions`,
`bid_versions`, `overrides`) grant `ts_app` only INSERT/SELECT, plus a trigger blocking UPDATE/DELETE.

## ADR-004 — Engine does not connect to the database (2026-09-28)

**Decision.** The Python engine is stateless with respect to Postgres: the API/worker send inputs and persist
outputs. The engine reads/writes files via the Storage S3 endpoint with its own scoped keys, or via signed URLs.

**Consequences.** One place (API/worker) enforces tenancy and writes audit events; the engine stays pure and
easy to test against the golden dataset.

## ADR-005 — `@node-rs/argon2` instead of `argon2` for password hashing (2026-09-28)

**Context.** Spec §6.4 requires argon2id password hashing. The `argon2` npm package compiles a native
addon via `node-gyp`, which failed to build on this machine (no Visual Studio Build Tools / Python
toolchain installed) even though a prebuilt binary would normally be used.

**Decision.** Use `@node-rs/argon2` (napi-rs, ships prebuilt binaries for all supported platforms,
argon2id by default) instead. Same algorithm and security properties; no native compilation needed on
any developer or CI machine.

**Consequences.** None functionally. If a future environment specifically needs the `argon2` package for
some other reason, ensure a C++ build toolchain is present first.

## ADR-006 — Mandatory gate/score/risk aggregation computed in the engine, not the API (2026-09-29)

**Context.** Spec §12.6 explicitly requires the DSL interpreter itself to be a pure, stateless function
(ADR-004). It does not say where the *aggregation* over interpreter results — mandatory gates (§15.2),
score (§15.3), and non-relationship risk signals (§15.4) — should live; that logic could reasonably sit
in either the Python engine or the TypeScript API.

**Decision.** Put gate/score/risk aggregation in `engine.compliance.aggregate` (Python), alongside the
interpreter, and have the single `/engine/compliance/evaluate` call return all four pieces (results,
gate, score, risk signals) together. The API only merges in relationship signals (which need a
cross-bid database query the stateless engine can't do — ADR-004) and persists the combined result.

**Consequences.** All of the deterministic, spec-table-driven arithmetic (§15.2's PASS/FAIL/PENDING
rule, §15.3's weight-sum formula, §15.4's signal-to-severity table) lives in one pytest-tested place
with the interpreter it depends on, instead of being duplicated or split awkwardly across two
languages. The API's `compliance/service.ts` stays a thin persistence/orchestration layer. The one
piece that must stay API-side — relationship signals (§15.6) — is clearly isolated in its own module
(`compliance/relationships.ts`) with a comment explaining why it couldn't move to the engine too.
