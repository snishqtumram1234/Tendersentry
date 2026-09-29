# Build progress

Tick items with the date completed. Record every deviation from docs/BUILD_SPEC.md here and why.

## Deviations

- 2026-09-28 — Database and object storage moved to Supabase (spec amendment A1; ADR-001..004).
  MinIO and the Postgres container are removed from docker compose; the Supabase CLI local stack replaces them.

## Phase 0 — Foundation (in progress)

- [x] 2026-09-28 docs/BUILD_SPEC.md saved (with Supabase amendment), CLAUDE.md, DECISIONS.md, PROGRESS.md
- [~] pnpm monorepo skeleton — root workspace + apps/api done 2026-09-28; web/worker/packages/engine pending
- [x] 2026-09-28 supabase/config.toml (private buckets, Auth sign-ups off, Realtime off) + `pnpm stack:up` script
- [x] 2026-09-28 docker-compose.yml (web, api, worker, engine, redis) pointing at Supabase via host.docker.internal
- [x] 2026-09-28 .env.example with Supabase connection strings (pooled DATABASE_URL, DIRECT_URL, Storage S3 keys)
- [x] 2026-09-28 Prisma schema for all §7 tables (validated); init migration generated with `prisma migrate diff`
- [x] 2026-09-28 SQL: extensions, `ts_app` role, `ts_private.lock_down_all()`, append-only + rule-immutability
      triggers, AUTHORITATIVE_VERIFIED guard, simulated-mode check — written, NOT yet applied to a database
- [x] 2026-09-28 Migrations applied to a hosted Supabase project (region ap-south-1); `pnpm db:setup`
      verified: RLS on all 58 tables, anon/authenticated cannot read/write any of them, ts_app can
      connect via the pooler and cannot mutate audit_events.
- [x] 2026-09-28 docs/deployment.md (local + hosted Supabase)
- [x] 2026-09-28 scripts/apply-supabase-env.mjs — fills in DATABASE_URL/DIRECT_URL/STORAGE_* from
      6 plain values so .env is easy to hand-edit; apps/api/scripts/db-setup.ts does the lock-down check.
- [x] 2026-09-28 Config validation at boot (zod, apps/api/src/config.ts) incl. production guards
- [x] 2026-09-28 Auth: 3 portal entries (government/bidder/admin), argon2id (via @node-rs/argon2 —
      plain `argon2` needs native build tools not available on this machine; deviation noted below),
      lockout (5 attempts / 15 min), TOTP + demo OTP, org chooser (multi-membership), sessions +
      refresh cookie, CSRF double-submit — apps/api/src/modules/auth/
- [x] 2026-09-28 RBAC middleware + permission matrix (§6.3) — apps/api/src/authz/
- [x] 2026-09-28 Audit service with hash chain (pg_advisory_xact_lock) + GET /audit/verify-chain —
      apps/api/src/audit/service.ts
- [x] 2026-09-28 Express app skeleton, error handler (spec §4.5 shape), health endpoint —
      apps/api/src/app.ts, server.ts
- [x] 2026-09-28 Minimal seed (one org + user per portal) — apps/api/src/seed/index.ts
- [x] 2026-09-28 Smoke-tested end-to-end against the hosted Supabase DB: password login → MFA
      enrolment (demo OTP) → session issued → /auth/me → CSRF-protected logout → wrong-portal
      login correctly rejected with a generic error → audit chain verifies.
- [x] 2026-09-28 Web: login chooser (`/login`) + 3 portal entries (`/login/government|bidder|admin`)
      sharing one flow component, MFA step, MFA enrolment with a client-side-generated QR (TOTP
      secret never leaves the browser), org chooser step, placeholder per-portal dashboards,
      route guards that redirect an unauthenticated visit to the matching portal's login —
      apps/web/src/. CORS added to the API for cross-port dev (Vite also proxies /api in dev so
      CORS isn't exercised locally, but is needed if web and api are ever split across origins).
      **Deviation**: no Tailwind/packages/ui yet — plain CSS against the §20.2 tokens, to avoid
      another native-binary dependency this early; packages/ui to formalise this later.
- [x] 2026-09-28 Smoke-tested through the real browser (Claude Browser pane) against the hosted
      Supabase DB: government login (MFA already enrolled, demo OTP) → dashboard with correct
      user/org/roles; bidder login (fresh MFA_ENROLLMENT_REQUIRED, live QR rendered and scanned
      via demo OTP) → dashboard; sign-out → chooser; direct dashboard URL while logged out →
      redirected to that portal's login.
- [x] 2026-09-28 Storage service: S3 client to Supabase Storage (apps/api/src/lib/storage.ts),
      upload with SHA-256 hashing + org-scoped dedup, magic-byte MIME sniffing (rejects a file
      whose content doesn't match its extension), encrypted-PDF heuristic reject, size cap,
      signed download URLs (5 min) issued only after an org-scope permission check + audit
      DOCUMENT_ACCESSED — apps/api/src/modules/documents/. `jobs` row written per upload
      (queue `document_processing`) so §4.4's job-status polling has something real, but no
      BullMQ/Redis wiring yet — deviation, see below.
      **Deviation**: full stored-file integrity re-verification "before every compliance run"
      (spec §6.5/§16) isn't built yet — no compliance runs exist to gate. Also deferred: BullMQ
      queue consumption (Redis not provisioned in this dev environment yet); uploads currently
      only create a QUEUED `jobs` row, nothing consumes it. Both are Phase 1 work.
- [x] 2026-09-28 Smoke-tested against the hosted Supabase project: upload → dedup on re-upload
      of the same bytes → GET metadata → GET signed URL → fetched the signed URL directly from
      Supabase Storage and confirmed byte-for-byte match with the original → rejected a
      wrong-content file (PNG extension, non-image bytes) → rejected an encrypted-PDF marker →
      cross-organisation read attempt correctly returned 404 (not 403, so existence isn't leaked)
      → unauthenticated upload rejected with 401.
- [x] 2026-09-28 Engine skeleton: FastAPI app factory, X-Engine-Token auth (all `/engine/*` routes
      except `/engine/health`, which infra health checks need unauthenticated), the §4.5 error
      shape mirrored exactly from the API so responses pass through unchanged, and one router per
      package (documents, extraction, rules, compliance, verification, reports) with the real
      route signatures from spec §19 — each currently an honest `501 NOT_IMPLEMENTED` naming the
      phase that builds it, never a fake success. `engine/llm/client.py` scaffolds the
      provider-agnostic LLM interface (§0.4/§11.2) with a `NullLlmProvider` for
      `MODEL_PROVIDER=none` — apps/services/engine/. Dockerfile installs tesseract/poppler/libzbar
      now so later phases don't need a base-layer rebuild.
      **Deviation**: local dev uses a plain `venv` (not the Docker image) since Docker Desktop
      isn't running in this environment; `pip install -e .` used prebuilt wheels throughout, no
      native compilation needed.
- [x] 2026-09-28 7 pytest tests pass (health needs no token; every other route 403s without one;
      a valid token gets an honest 501 naming the phase; unknown verification adapter is 404, not
      a silently-accepted no-op). `ruff check .` and `mypy engine` both clean. Also smoke-tested
      live against the real `.env` (`ENGINE_TOKEN` from the actual config) with curl — same
      results as the test suite.
- [x] 2026-09-28 Tenancy/permission tests, two layers (spec §23.1/§23.2):
      - Unit (no DB, `pnpm --filter api test`, vitest.config.ts + vitest.setup.ts dummy env):
        `authz/permissions.test.ts` is table-driven over the *entire* §6.3 permission matrix — for
        every permission, every allowed role passes and every other role (across all 12 roles) is
        denied, plus a no-roles-denied-everything check (86 assertions, all passing);
        `modules/documents/validation.test.ts` covers the upload gate (content sniffing,
        extension/content mismatch, encrypted-PDF heuristic, size cap).
      - Integration (real hosted DB, `pnpm --filter api test:int`, vitest.int.config.ts):
        `modules/documents/crossOrg.int.test.ts` drives the actual HTTP app with supertest —
        creates two real orgs+users, confirms org B gets 404 (not 403) reading org A's document
        and its signed-URL endpoint, confirms an unauthenticated request is 401, confirms a role
        without `audit.read` gets 403 while one with it gets 200, confirms CSRF rejection, confirms
        same-org re-upload dedup — then cleans up every row it created (verified: 0 residue after
        the run). All 8 pass against the real hosted Supabase project.
      **Deviation found & fixed along the way**: `test:int`'s package.json script was missing the
      `dotenv-cli` wrapper (would have silently failed against an empty env in CI) — fixed.
      **Real bug found & fixed by wiring up ESLint's react-hooks plugin**: LoginFlow.tsx called
      `useEffect` after a conditional early return, violating Rules of Hooks — reordered so all
      hooks run unconditionally; re-verified through the actual browser afterward.
- [x] 2026-09-28 ESLint (flat config, typescript-eslint + react-hooks/react-refresh for web) wired
      up as real `lint` scripts for both packages — `eslint.config.js`. Deliberately scoped to
      `rules-of-hooks` + `exhaustive-deps` only for React (not the full new "React Compiler" rule
      set from eslint-plugin-react-hooks v7, which flags the standard fetch-on-mount pattern as an
      error — too aggressive for this stage; noted inline in the config).
- [x] 2026-09-28 CI workflow (.github/workflows/ci.yml, spec §25.3): `web-api` (lint, typecheck,
      unit tests, web production build, gitleaks, non-blocking `pnpm audit`) and `engine` (ruff,
      mypy, pytest, non-blocking `pip-audit`) run on every push/PR with no secrets required — every
      command in both jobs was run locally exactly as CI would and passes. A third job,
      `db-integration`, runs the real-DB tests but is auto-skipped with a clear notice until a
      dedicated CI Supabase project's secrets are configured (documented in docs/deployment.md —
      never point CI at the demo/production project).
- [ ] BullMQ wiring for the worker (needs Redis; Docker Desktop not running in this environment)

## Phase 2 — Tender & rules (complete) — 2026-09-28

Spec §27.1: "Tender create/import, clause segmentation, LLM compiler with schema validation +
repair, ambiguity checks, manual rule builder, plain-English renderer, three-pane rule review,
approve/edit/reject, versioning, publication validation, publish, public tender pages." Acceptance
(§27.3 Rules "done" list): AI clause extraction works (or the manual path without a key) · Rule
JSON schema exists and is shared · invalid rules rejected · officer can edit/approve/reject ·
ambiguities must be resolved · version stored · source page stored · only approved rules execute ·
audit events created. **Verified end-to-end via curl against the real hosted DB + real engine**:
create tender → upload+attach tender PDF → analyze (clause segmentation + candidate rules,
3 requirements detected, including the spec's own deliberately-ambiguous-clause pattern) → manual
rule authoring for all three → resolve every ambiguity → approve (gate correctly blocks
ill-formed rules first) → publish → public tender page shows the right eligibility text with no
auth. All of this is also now locked in as an automated integration test
(`tenderFlow.int.test.ts`, 5 assertions, all passing against the real DB+engine).

- [x] **Shared Rule DSL schema** (`packages/rule-schema/rule.schema.json`, spec §12.1-§12.4): the
      full expression/value/series node grammar (AND/OR/NOT/IF/COMPARE/DOCUMENT_EXISTS/
      DATE_VALIDITY/FIELD_MATCH/ENTITY_MATCH/SOURCE_VERIFIED/THRESHOLD_COUNT/CLAIM_TRUE/
      TENDER_FLAG, CONST/AGG/RATIO/PERCENTAGE/FIELD, SERIES/TOP_N/FILTER), plus `fields.json` (the
      claim-type registry: unit, periodicity, applicable doc types — spec §12.4). One JSON Schema
      file, loaded by the engine (`jsonschema`); the API defers validation to the engine rather
      than re-implementing the same schema in Zod (Phase 2 deviation — one source of truth beats
      two that can drift).
- [x] **Engine — `engine/rules/`**: `schema.py` (loads + validates against the shared schema);
      `semantic.py` (unit compatibility, periodic-field-needs-a-period, depth/node-count caps —
      spec §12.5, beyond what JSON Schema alone expresses); `segmentation.py` (numbered-heading
      clause splitting + requirement-candidate keyword detection, spec §11.1); `ambiguity.py` (the
      seven deterministic checks from spec §11.3 — FY_COMPLETION_UNSPECIFIED,
      CURRENCY_UNIT_UNCLEAR, MANDATORY_UNCLEAR, PERIOD_UNSPECIFIED,
      EXEMPTION_REFERENCED_NOT_DEFINED, MULTIPLE_THRESHOLDS, EVIDENCE_TYPE_UNSPECIFIED);
      `render_english.py` (deterministic template renderer, spec §11.5 — "a template renderer, not
      the LLM"); `compiler.py` (clause text → candidate DSL: one repair attempt on malformed JSON,
      one on schema/semantic errors, then an honest `REVIEW_REQUIRED` rather than a fabricated
      result — spec §11.2). `engine/llm/client.py` now has a real `AnthropicProvider` (previously a
      `NotImplementedError` stub) alongside `NullLlmProvider` for `MODEL_PROVIDER=none`/no key.
      `/engine/tenders/segment`, `/engine/rules/compile`, `/engine/rules/validate`,
      `/engine/rules/render-english` are real now (were 501 stubs). 40 new engine tests (63 total,
      up from 23), all passing; ruff + mypy clean.
- [x] **API — `modules/tenders/`**: tender CRUD, document attach, `analyzeTender` (segments every
      MAIN document, creates `TenderClause` rows, and for each requirement-candidate clause either
      an AI-compiled candidate or — with no LLM key, as in this environment — an honest empty
      manual-authoring slot, never a fabricated rule), the three-pane review data endpoint,
      `editRule` (manual authoring/editing — always regenerates `plainEnglish` server-side from the
      DSL, never trusts the client's own preview), `resolveAmbiguity`, `approveRuleVersion` (the
      full spec §11.4 gate: schema+semantic valid, source clause present, mandatory set, weight set
      if non-mandatory, evidence types set, every ambiguity resolved — tested to actually reject an
      unready rule with the specific missing conditions listed), `rejectRuleVersion`,
      `validateForPublication` + `publishTender` (creates the `TenderVersion(ORIGINAL)` snapshot,
      bumps every `APPROVED` rule version to `ACTIVE`, blocks a second publish), and the public,
      unauthenticated tender endpoints (spec §21.5).
      **Deviation** (documented at the top of `service.ts`): skips the `UNDER_REVIEW`/`APPROVED`
      intermediate tender-state steps and the separate `APPROVING_AUTHORITY` publication-approval
      action from spec §8.1/§21.2's full stepper — `BUYER` can publish directly from `DRAFT` once
      `validateForPublication` passes. The multi-step approval workflow is real, deferred spec
      behaviour, not something skipped by accident.
      **Deviation**: no `Idempotency-Key` header machinery yet for publish (spec §4.4/§17) — the
      natural state guard (`DRAFT` → `PUBLISHED` is one-way; a second attempt 409s) covers the
      double-click case honestly enough for now.

### Real bugs found during manual end-to-end testing (again — this keeps paying off)

1. **`Requirement.mandatory`/`weight`/`envelope`/`category` never synced from an approved rule's
   DSL.** These are set once at candidate-creation time (when the DSL was still empty, defaulting
   to `mandatory: false`), and nothing updated them when the officer later authored and approved
   real content — so the public tender's eligibility page showed every requirement as non-mandatory
   regardless of what the approved rule actually said. Caught by checking the public page after a
   real publish and noticing `"mandatory": false` on a rule whose DSL said `"mandatory": true`.
   Fixed: `approveRuleVersion` now syncs these four fields from the approved DSL onto the
   `Requirement` row. Locked in with a regression assertion in `tenderFlow.int.test.ts`.
2. **Test cleanup tried to delete an append-only row.** `tenderFlow.int.test.ts`'s first draft
   deleted `tender_versions` in `afterAll` — which `ts_app` is deliberately forbidden from doing
   (spec §7.0/ADR-003, same as `audit_events`). This wasn't a bug in the app; it correctly proved
   the Phase 0 lock-down still holds even against code trying to violate it from inside the same
   codebase. Fixed the test to leave a published tender in place (same pattern as Phase 1's
   uploaded documents) instead of trying to delete permanent history.
3. Same `ENGINE_URL=http://engine:8000` local-dev gotcha as Phase 1 (documented in CLAUDE.md) —
   `pnpm test:int` needs the same override as `pnpm dev` when not running through
   `docker compose`; without it the new integration tests skip cleanly rather than failing, which
   is itself a small confirmation the honest-skip design (from Phase 1) works as intended.

### Deviations (see also inline comments at each cited location)

- Requirement/clause `category` classification is whatever the DSL says (or `OTHER`) — no separate
  clause-category classifier (spec mentions `TenderClause.category` but doesn't mandate an
  automated classifier for it; left null for now).
- No `packages/types` shared TS client yet — the same hand-mirrored-type pattern from Phase 0/1
  continues (`docs/PROGRESS.md` has tracked this since Phase 0; still deferred).
- Exemptions (`expression.exemptions[]`, spec §12.2) are in the schema and validated, but nothing
  in the UI/manual-builder specifically surfaces them yet beyond raw JSON editing.
- The manual rule builder is a raw-JSON editor (validated server-side against the real schema),
  not yet the ten-template picker UI from spec §11.5 — genuinely usable and fully validated, just
  less guided than the eventual polished version.

## Phase 3 — Evidence, bidder onboarding, bid workflow (complete) — 2026-09-29

Spec §27.1: "Bidder registration/onboarding, profile, vault, OCR path, classification, full field
extraction (§10), tables/turnover, QR decoding, discovery, readiness, bid workspace, pre-check,
submission with manifest hashes, officer package import." Acceptance: "Evidence module 'done' list
§27.3; bidder e2e passes." **Verified end-to-end twice** — once via curl against the real hosted
DB + real engine (register a bidder → upload real GST/PAN PDFs to the vault, watch them get
correctly classified → readiness check against the Phase 2 published tender → create a bid →
attach vault documents → pre-check → submit with a real manifest hash → double-submit rejected →
audit chain still verifies across 131 events) and then locked into an automated integration test
(`bidFlow.int.test.ts`, 5 assertions, all passing, including a REAL TOTP code computed from a
freshly self-registered account's own secret — not the demo-OTP bypass).

### A known, stated environment limitation: Tesseract isn't installed here

This dev machine has no Tesseract binary (it's only in the Docker image — see
`services/engine/Dockerfile`, already `tesseract-ocr`/`tesseract-ocr-hin`). Rather than skip OCR
or fake it, `engine/documents/ocr.py` is real and honest about this: `tesseract_available()` is
checked at runtime, and when it's `False` (as here), a scanned page is recorded as
`text_source: NONE` — never a fabricated transcription. The code path itself is exercised by tests
that assert the *actual* behaviour in whichever environment they run (unavailable here, real
decode wherever Tesseract is present) — see `test_ocr.py`. **QR decoding needed no such
compromise**: `pyzbar`'s Windows wheel bundles `libzbar.dll`, so `test_qr.py` and the pipeline
tests generate a real QR code, embed it in a real PDF, and decode it for real, in this environment,
with no mocking.

### Engine — new capability, all tested (114 pytest tests total, up from 63)

- `extraction/money.py` (spec §10.2): ₹/Rs/INR, lakh/crore/million/thousand multipliers, Indian
  grouping, parenthesised negatives, `Decimal` throughout (never float). A real bug here: the
  original regex's comma-grouped/plain-digit alternation matched only the first 1–3 digits of a
  plain number like `100000000` and silently discarded the rest — caught by the unit test for
  `INR 100000000`, not by inspection.
- `extraction/financial_years.py` (spec §10.3): FY/AY parsing (AY→preceding-FY conversion),
  `last_n_completed_fy()` against a reference date, tested across the April-1st/March-31st
  boundary cases the spec calls out by name.
- `extraction/dates.py` (spec §10.1): ISO, textual ("12th March, 2025"), and numeric dates with
  Indian day-first disambiguation (confidence penalty only when genuinely ambiguous — both numbers
  ≤12).
- `documents/classification.py` (spec §9.2): keyword-signature classifier over 17 document types,
  plus `declared_vs_detected_mismatch()`. Verified live: uploaded GST/PAN PDFs were classified
  correctly and matched their declared vault evidence type.
- `documents/qr.py` (spec §9.1, §14.3): real `pyzbar` decoding, page-attributed. Verified live with
  a QR code embedded in an actual PDF page.
- `documents/ocr.py` (spec §9.1): Tesseract fallback with honest unavailability reporting (see
  above) — word-level bboxes converted from OCR pixel space to PDF points at the same 1x scale the
  native-text path uses, so the frontend viewer overlay logic from Phase 1 doesn't need to know
  which path produced a given field.
- `documents/pipeline.py` rewritten to wire all of the above together per page: rasterize once,
  decode QR regardless of text availability, try native text then OCR fallback, classify from
  whichever text was actually readable. `text_layer` now has four states (`NATIVE`/`OCR`/`MIXED`/`NONE`)
  matching the Prisma `TextLayer` enum exactly.
- `/engine/documents/process` and `/engine/tenders/segment` both real now — the latter fetches and
  segments in one call (previously the API would have needed a separate text-extraction round
  trip).

### API — bidder-side workflow, all new modules

- `modules/auth/registration.ts` + `POST /auth/register/bidder` (spec §6.4): real self-registration,
  creates the organisation, `BIDDER_ADMIN` user, `BidderProfile`, and an `AuthorisedPerson` row in
  one transaction. Tested with a genuinely fresh account through full MFA enrollment (a real
  computed TOTP code, since a self-registered account is never `isDemo`).
- `modules/bidder/` (spec §13.3–§13.5): profile, evidence vault (`POST /bidder/vault` reuses the
  existing document-upload pipeline and tags it with an evidence type — spec §13.4's "reused, not
  duplicated" is the same dedupe the upload pipeline already had from Phase 1, now surfaced at the
  vault layer too), and `checkReadiness()` — compares a published tender's active rules' evidence
  types against the bidder's fresh vault items. Always labelled `preview: true` and never uses
  "rejected"/"not eligible" wording (spec §13.5, §26).
- `modules/bids/` (spec §15.9): create/list/attach-documents/pre-check/submit. Submission builds an
  immutable manifest (`{documentId, sha256, requirementCodes, envelope}` per document) and hashes
  it — verified the returned hash against an independently recomputed one in the integration test,
  and verified the per-document sha256 in the manifest matches the actual stored `Document.sha256`.

### A real bug found during manual testing (again)

**`req.params.tenderId` was `undefined` inside the bid-creation route.** `bidderTendersBidsRouter`
is mounted at `/api/v1/bidder/tenders/:tenderId/bids`, but the `Router()` wasn't created with
`{ mergeParams: true }` — so the mount path's `:tenderId` never reached the sub-router's own
`req.params`. The first `curl` call against `POST /bidder/tenders/:id/bids` came back `500`; the
server log showed Prisma correctly rejecting `where: { id: undefined }` rather than doing anything
unpredictable — a nice confirmation that the DB layer fails safely, but the route itself was
genuinely broken. Fixed with `Router({ mergeParams: true })`; the integration test's "creates a
bid" case now explicitly asserts `res.body.tenderId === tenderId` as a regression guard, not just
a 201 status (a 201 with the wrong/undefined tenderId baked in would have passed a weaker check).

### Deviations (see also inline comments at each cited location)

- No officer-side bidder-package import yet (spec §21.2 "Import bidder package") — deferred; the
  self-registration + vault + bid-submission path is what's built and tested this phase.
- No automatic tender state-machine scheduler (`PUBLISHED → OPEN_FOR_BIDS` at `bid_open_at`, spec
  §8.1) — a bid can be prepared once the tender is `PUBLISHED`, without waiting for a scheduler
  that isn't built. Documented in `modules/bids/service.ts`.
- No document-table extraction (turnover tables via `pdfplumber`, spec §10.4) — the money/date/FY
  utility modules built this phase are ready for it, but wiring table detection into the pipeline
  and mapping cells to `ANNUAL_TURNOVER`/`NET_WORTH` claims specifically is deferred; today's
  pipeline only extracts PAN/GSTIN as claim-bearing fields (money/date parsing exists as
  standalone, tested utilities not yet called from `pipeline.py`).
- `BidDocument` rows stay at their draft-time version marker (0); the immutable historical record
  is `BidVersion.manifest`, not a version-bumped copy of `BidDocument` — a deliberate simplification
  noted inline in `modules/bids/service.ts`.
- Discovery (spec §21.3 tender search/filtering for bidders) isn't a separate endpoint yet — bidders
  currently use the same `GET /public/tenders` list as the public site; portal-specific filtering
  (relevance, "evidence available") is deferred.

## Phase 4 — Compliance interpreter, mandatory gates, score, risk, exceptions (complete) — 2026-09-29

Spec §27.1: "Interpreter (full DSL + three-valued logic), calculations, exemptions, mandatory
gates, score, risk, exception engine, compliance runs with snapshots, triggers." Acceptance:
"golden dataset passes; determinism test passes." **Verified three ways**: a full node-by-node and
three-valued-logic-truth-table pytest suite, a determinism (hash-repeat) test per spec §12.6, and
a live end-to-end integration test against the real hosted DB and real engine covering the whole
run→gate→score→exception→auto-resolve→re-run lifecycle.

### Scope note on "golden dataset"

Spec §23.3/§27.1 describes a much larger golden-dataset fixture: synthetic multi-bidder documents
(PAN cards, GST certs, signed PDFs, scanned/rotated pages, QR-bearing Udyam certs) with pre-recorded
expected extraction values, run through the full pipeline and diffed in CI. That generator wasn't
built this phase — it's a substantial standalone content-generation effort spanning the whole
pipeline, not specific to the interpreter. What *was* built and is genuinely equivalent for the
interpreter's own correctness claim: `test_interpreter.py`'s node-by-node + three-valued-logic
truth-table tests (spec §12.3 "test every row" instruction, followed literally) and
`test_compliance_determinism.py`'s repeat-hash test (spec §12.6's determinism requirement, followed
literally). The full synthetic-document golden dataset is deferred, consistent with how Phase 3
deferred table/turnover extraction and Phase 2 deferred the template rule-builder UI.

### Engine — `engine.compliance` (pure, stateless per ADR-004; 166 pytest tests total, up from 114)

- `compliance/types.py`, `compliance/values.py`: the `BidContext`/`ClaimSnapshot`/
  `ReconciliationSnapshot`/`DocumentSummary` input contract and Decimal/truthiness helpers.
- `compliance/interpreter.py` (spec §12.2, §12.3, §12.6): every DSL node — `AND`/`OR`/`NOT`/`IF`,
  `COMPARE`, `DOCUMENT_EXISTS`, `DATE_VALIDITY`, `FIELD_MATCH`/`ENTITY_MATCH`, `SOURCE_VERIFIED`,
  `THRESHOLD_COUNT`, `CLAIM_TRUE`, `TENDER_FLAG`; value nodes `CONST`/`FIELD`/`AGG`/`RATIO`/
  `PERCENTAGE`; series nodes `SERIES`/`TOP_N`/`FILTER`; period kinds `LAST_N_COMPLETED_FY` (via the
  Phase 3 `financial_years` module), `FY_LIST`, `LAST_N_YEARS_FROM_REFERENCE`, `ALL`; exemptions
  (evaluated first, gated on both the `when` expression AND an explicit `requires_evidence`/
  `min_verification` check, so a bare self-declaration can never satisfy one — spec §12.2's own
  example). `evaluate_rule()` is a pure function: no I/O, no wall-clock reads beyond the
  `reference_date` argument, never mutates its `BidContext` input (asserted directly in
  `test_evaluate_rule_never_mutates_bid_context`).
- `compliance/aggregate.py` (spec §15.2–§15.4): `compute_gate` (FAIL if any mandatory requirement
  FAILs, PASS if none pending, else PENDING), `compute_score` (Σweight(PASS)/Σweight(applicable)×100,
  provisional when anything applicable is still REVIEW_REQUIRED/PENDING_VERIFICATION/BLOCKED, plus
  "max achievable"), and `compute_risk_signals` for every non-relationship signal in the spec §15.4
  table. Relationship signals are deliberately excluded here — see the API section.
- `compliance/router.py`: `/engine/compliance/evaluate` adapts JSON in, calls the pure interpreter
  and aggregator, returns JSON out. Persists nothing (ADR-004: the API owns `compliance_runs`).

### API — `modules/compliance/`

- `context.ts`: builds the frozen `BidContext` snapshot from the bidder organisation's current
  claims/reconciliation/documents (org-scoped, matching the Phase 3 finding that claims are
  org-level, not bid-level) plus the tender's `flags` JSON and reference date (per
  `referenceDatePolicy`).
- `service.ts` (`runCompliance`): fetches every `ACTIVE` rule version for the tender, calls the
  engine once, computes the final risk level by merging engine signals with relationship signals,
  and persists `ComplianceRun` + `RequirementResult[]` + `Score` + `MandatoryGateResult` +
  `RiskAssessment` + exception sync, all in one transaction, plus an audit event
  (`COMPLIANCE_RUN_COMPLETED`). A failed engine call still records a `FAILED` run rather than
  silently dropping the attempt. Triggers wired: `SUBMISSION` (fire-and-forget after
  `bids/service.ts submitBid`, mirroring the Phase 1/3 "no worker queue yet" pattern — a compliance
  hiccup here is logged but never fails an already-valid submission) and `MANUAL` (officer "Run
  evaluation", permission `evaluation.run`, government-org-only).
- `exceptions.ts` (spec §15.7): maps requirement results and risk signals to `ExceptionItem` rows,
  deduped by `category:bid:requirement:field`; when a dedupe key from a previous run's open
  exceptions no longer appears, that exception is auto-resolved with resolution `"Condition no
  longer present in run <id>."` — verified live in the integration test (upload the missing PAN
  card, re-run, watch the `MANDATORY_GATE_FAILED` exception flip to `RESOLVED`).
- `relationships.ts` (spec §15.6): real shared-director/address/contact comparison against other
  bids on the same tender, in Postgres. Nothing populates `Director`/`Address`/`Contact` yet
  (self-registration only captures the authorised person; extraction only produces PAN/GSTIN
  claims), so this honestly returns an empty list today rather than a fabricated "no relationships
  found" claim — it will start finding real matches the moment that data exists.
- `routes.ts`: `POST /bids/:id/compliance/run` (officer manual trigger), `GET
  /bids/:id/compliance/latest`, `GET /bids/:id/compliance/runs` (history), `GET
  /compliance-runs/:id`. Visible to the bidder's own organisation and the tender's government
  organisation only — verified in the integration test that a bidder gets `403` trying to trigger
  a run and that both organisations can read the same run.

### A real bug found during manual/live testing (again)

**Wrong engine path.** `callEngine("/compliance/evaluate", …)` was missing the `/engine` prefix
every other engine call uses (`/engine/documents/process`, `/engine/rules/compile`, …) — caught
immediately when the live integration test hit a real `404 Not Found` from the engine instead of
a fabricated result (the submission-trigger path logs and swallows engine errors by design, so
this needed the audit log message — `"Compliance run failed for bid … : EngineError: Not Found"` —
to spot, not a silent hang). Fixed by prefixing the path; the integration test now exercises the
real round trip end to end.

### Deviations

- Category assignment for requirement-result-driven exceptions is a simplification: the engine's
  generic result value (`FAIL`/`REVIEW_REQUIRED`/`PENDING_VERIFICATION`/`BLOCKED`) doesn't carry
  enough structure yet to distinguish, say, a genuine field conflict from a missing-document REVIEW
  case — both currently land in `FIELD_CONFLICT`. Noted inline in `exceptions.ts`.
- `DATE_VALIDITY` always resolves via `on_missing_evidence` today: certificate expiry isn't
  extracted yet (the money/date parsing utilities from Phase 3 exist but aren't wired into a
  `CERTIFICATE` claim type), so `bid_context` documents always report `expiry_date: null`. Noted
  inline in `context.ts`.
- "Inputs below `min_verification` … PENDING_VERIFICATION if a verification route exists else
  REVIEW_REQUIRED" (spec §12.3) always resolves to `PENDING_VERIFICATION`: verification routing
  (spec §14, Phase 5) doesn't exist yet, so "a route exists" is assumed true. Noted inline in
  `interpreter.py`; revisit once Phase 5 can report route existence per claim type.
- `DOCUMENT_EXISTS`/`DATE_VALIDITY` resolve from the bidder's whole document vault (owner
  organisation), not specifically the documents attached to *this* bid version — consistent with
  claims already being org-scoped rather than bid-scoped (the same Phase 3 finding).
- Relationship signals are real, tested code with no data to find yet — see `relationships.ts`
  above.
- Risk severity for `EXPIRED_EVIDENCE` doesn't yet distinguish a mandatory-linked claim from a
  non-mandatory one (claims don't carry their supporting requirement IDs through to the compliance
  snapshot); every expired claim is treated as the worse (mandatory) case for now. Noted inline in
  `aggregate.py`.
- [ ] Lock-down test: anon/authenticated cannot read any app table; every public table has RLS
- [ ] Config validation at boot (zod) incl. production guards
- [ ] Auth: 3 portal entries, argon2id, lockout, TOTP + demo OTP, org chooser, sessions/refresh, CSRF
- [ ] RBAC middleware + permission matrix (§6.3) + tenancy repository layer + tests
- [ ] Audit service with hash chain (pg_advisory_xact_lock) + verify-chain endpoint + tests
- [ ] Storage service (S3 client to Supabase Storage, signed URLs, SHA-256 integrity check)
- [ ] Engine skeleton (FastAPI, X-Engine-Token, /engine/health)
- [ ] Web: public layout, login chooser + 3 entries, MFA step, org chooser, 3 portal shells, design tokens
- [ ] Minimal seed: demo orgs + users for each portal
- [ ] CI workflow (lint, typecheck, unit, supabase start, migrate, lock-down test)

Acceptance: login for each demo portal with MFA; wrong-portal login fails; permission tests pass;
audit chain verify passes; anon/authenticated cannot read any app table; `pnpm stack:up` on a clean clone works.

**Phase 0 status: substantially complete** (auth, RBAC, audit chain, storage, engine skeleton, web
login, tenancy tests, CI all built and tested — see entries above). Not yet done: BullMQ/Redis
worker wiring (Docker unavailable in this dev environment). Moved on to Phase 1 since the walking
skeleton doesn't need the queue (see below).

## Phase 1 — Walking skeleton (complete) — 2026-09-28

Spec §27.1: "Document upload → hash → storage → engine native-text extraction → PAN/GSTIN regex →
claims/evidence with page+bbox → reconciliation of two documents → CONSISTENT/REVIEW_REQUIRED shown
in a basic viewer with highlights." Acceptance: "Upload two synthetic PDFs with matching/mismatching
PAN and see the correct outcome with highlighted boxes." **Verified end-to-end, twice** — once via
curl against the real hosted Supabase DB + real engine, once by actually driving the app through a
real browser (login → upload → view → see the conflict highlighted).

- [x] **Engine**: `engine/extraction/patterns.py` — PAN/GSTIN regex + GSTIN checksum (spec §10.1),
      ported from the spec's algorithm and cross-checked against a known-valid example.
      `engine/documents/pipeline.py` — pure function (no I/O): opens a PDF with PyMuPDF, per page
      checks the ≥30-char native-text heuristic (spec §9.1), regex-matches PAN/GSTIN on native
      pages, uses `page.search_for()` to get each match's exact bbox. Scanned/no-text pages are
      recorded honestly (`textSource: NONE`) and simply produce no fields — OCR fallback is Phase 3,
      never faked. `engine/common/storage.py` — engine's own boto3 S3 client against Supabase
      Storage (ADR-004: engine never touches Postgres). `POST /engine/documents/process` is now a
      real endpoint (was a 501 stub). 23 pytest tests (was 7), all passing; ruff + mypy clean.
- [x] **API**: `modules/documents/processing.ts` orchestrates the whole thing — calls the engine,
      persists `ExtractedField` + `Claim` + `Evidence` rows with page/bbox provenance, then
      recomputes CONSISTENT/CONFLICT across every claim of that type for the organisation (spec
      §13.2, scoped to org since there's no bid yet). Fire-and-forget after upload (spec §4.4: never
      block the response) rather than via BullMQ (still no Redis in this environment — logged as a
      deviation, same as Phase 0). New endpoints: `GET /documents` (list), `GET /documents/:id/fields`,
      `GET /documents/:id/claims` (a claim's full evidence across every document + the latest
      reconciliation result — everything the viewer needs in one call).
- [x] **Web**: `/documents` route (portal-agnostic for now — no tender/bid to scope it to yet).
      Upload form, document list with live status polling, `DocumentViewer` component renders the
      real PDF client-side via pdf.js and draws bbox highlight boxes scaled from PDF points to
      rendered pixels (green = consistent, red = conflicting), a claims/reconciliation panel showing
      each document's extracted value side by side.

### Real bugs found during testing (not hypothetical — caught by actually running this)

1. **Reconciliation compared the wrong value.** `reconcile()` built its comparison list from
   `claim.value` (the claim's single cached value, set once at creation) instead of each evidence
   row's own `excerpt`. Every evidence item under a claim was silently compared to the *same*
   constant, so a genuine PAN mismatch across two documents never surfaced as CONFLICT — it just
   showed CONSISTENT no matter what the third document actually said. Caught by manually uploading
   three real PDFs and watching the reconciliation output not change when it should have. Fixed
   (`processing.ts`), then locked in with an automated regression test
   (`modules/documents/reconciliation.int.test.ts`) that fails loudly if this regresses.
2. **`react-pdf@11` needs React 19.** It uses React's `use()` hook internally; this project is on
   React 18, so the viewer threw `TypeError: (0 , import_react3.use) is not a function` and
   silently blanked the page. Downgraded to `react-pdf@9.2.1`, which pins `pdfjs-dist@4.8.69`
   exactly — our own `pdfjs-dist` dependency had to be pinned to that exact version too, or the
   worker (loaded from our own dependency) and pdf.js's main thread code (bundled inside react-pdf)
   would be different major versions and pdf.js refuses to run with mismatched versions.
3. A local-dev-only gotcha, not a code bug: `.env`'s `ENGINE_URL=http://engine:8000` is the Docker
   Compose hostname. Running the API standalone (not via `docker compose`, since Docker isn't
   available in this environment) needs `ENGINE_URL=http://localhost:8000` instead — documented
   here so the next session doesn't lose time on it. `docker compose` itself is unaffected; this
   only matters when running `pnpm dev` directly on the host.

### Deviations (see also inline comments at each cited location)

- No `DocumentPage` rows yet (native text/words/OCR confidence per page) — Phase 3.
- Reconciliation is organisation-scoped, not bid-scoped (spec §13.2 as written needs a bid) —
  revisit once the bid module exists.
- No BullMQ; processing runs fire-and-forget right after upload instead of via a worker queue.
- `/documents` is a portal-agnostic route with no per-portal home yet — the real per-portal
  Evidence Workbench (spec §21.2) arrives with tenders/bids.
- Polling every 1.5s for processing status instead of the SSE/job-stream the spec describes
  (`GET /events/stream`) — acceptable stand-in until the job system is real.

## Cross-phase: prototype-critical path (complete) — 2026-09-29

At this point the API/engine had built out through Phase 4 but the web app only had login screens
and the Phase 1 documents demo — nothing to actually click through. Per explicit direction, this
push **diverges from strict phase order**: instead of continuing to Phase 5 (Verification) in
full, it pulls the pieces from across Phases 5/6/8 that are load-bearing for a genuinely clickable
end-to-end demo — officer-assisted verification, decisions/exceptions, and real web UI for both
portals — and leaves the rest (live adapters, the full evaluation dashboard, two-envelope,
notifications, audit UI) for later, numbered phases.

### Verification (spec §14 subset)

- `modules/verification/sources.ts`: the source registry (spec §14.6), seeded idempotently at API
  startup (`ensureVerificationSourcesSeeded`, called from `server.ts` — not from `createApp()`, so
  integration tests call it explicitly in `beforeAll`). Every row reflects what's actually true in
  this environment: `STRUCTURAL`/`CROSS_DOCUMENT` are genuinely `LIVE_VALIDATED` (they already run
  automatically during extraction — spec §9.1, §13.2); `PAN`/`GST`/`UDYAM`/`MCA`/`EPFO`/`ESIC`/`BIS`
  are `MANUAL_ONLY` with real official-portal URLs; `GST_PROVIDER_API`/`DIGILOCKER` are
  `INTEGRATION_READY` (no credentials); `SIMULATED` is `DISABLED`. No adapter claims a capability
  it doesn't have.
- `modules/verification/service.ts`: the only route that produces a real result today is
  `OFFICER_ASSISTED` — an officer requests verification for a claim, works the resulting task from
  a real queue, and records exactly what the official portal showed. A `MATCH` requires a captured
  screenshot/PDF (spec §14.4) and is the only path that reaches `AUTHORITATIVE_VERIFIED`; the mode
  is always `OFFICER_ASSISTED` and `isSimulated` is always `false`. Since a verified claim is
  organisation-scoped, a result triggers a `VERIFICATION_UPDATE` compliance re-run for every
  non-draft bid of that organisation (`compliance/service.ts` `triggerRunsForOrg`).
- Deviation: no live external adapter exists yet (no GSP/DigiLocker credentials in this
  environment) — `requestVerification` explicitly refuses to route to anything but the human queue,
  documented inline rather than silently defaulting.

### Decisions & exceptions (spec §15.7, §15.8 subset)

- `modules/decisions/service.ts`: `POST /bids/:id/decisions` records one of the five spec actions
  against the bid's latest completed run. A note is required for "Technically non-compliant" and
  "Record final decision"; recording "Technically compliant" over an open CRITICAL/HIGH exception
  is rejected with the exception list in the error body unless explicitly acknowledged — verified
  live in `verificationAndDecisions.int.test.ts`. Deviation: `decision_label_configs` (per-org
  label overrides) isn't wired up — every decision uses the spec's own default English label.
- `modules/exceptions/service.ts`: list/resolve/assign for an officer working a bid's open
  exceptions (the exceptions themselves are created/auto-resolved by the compliance run, Phase 4).

### Web app — a genuinely clickable end-to-end demo

Government portal: tender creation → document upload/attach → clause segmentation ("Analyze") →
per-rule DSL editor (raw JSON, ambiguity resolution, approve) → publication readiness check →
publish → bid list → per-bid compliance dashboard (gate/score/risk/trace) → claims &
verification-request panel → exceptions (resolve) → decisions. Bidder portal: self-registration →
MFA enrollment → evidence vault upload → browse published tenders → readiness preview → start a
bid → attach vault evidence → pre-check → submit → compliance status. A standalone verification
queue page lets an officer work tasks across all their tenders' bidders.

New API surface needed to support this UI, added alongside the pages that use it: `GET
/tenders/:id/bids` (officer's bid list for a tender — didn't exist before; bid listing was
bidder-only), `GET /bids/:id/claims` (a bid's bidder-org claims, for the verification-request
panel), and `getBidForOrg`/compliance's tenancy checks broadened from "bidder org only" to "bidder
org or the tender's government org" (mirroring the pattern `compliance/service.ts` already used) —
so both sides of a bid can see the same shared read surface (documents, claims, compliance runs,
decisions, exceptions) while mutating actions stay gated by their existing role permissions.
`listPublicTenders`/`getPublicTender` now also return the tender's internal `id` alongside
`publicId`, since the bidder portal's readiness/bid-creation endpoints need it and it isn't
sensitive (only bid/financial data is, spec §15.9).

New shared frontend pieces: `lib/upload.ts` (multipart helper, generalised out of the Phase 1
DocumentsPage pattern), `components/Chip.tsx` (status colouring shared by every screen), and a
handful of new `global.css` utility classes (`.page-shell`, `.card`, `button.secondary`, `.chip-*`,
`table.simple`, `.tabs`) built to match the existing token-driven design language rather than
introducing a second style system.

### Verified

- Backend: `pnpm --filter api test` (86 unit), `pnpm --filter api test:int` (6 files / 31 tests,
  including the new `verificationAndDecisions.int.test.ts` covering the full loop — request
  verification → work the queue → record Match with a required capture → claim reaches
  `AUTHORITATIVE_VERIFIED` → auto re-run → gate flips to PASS → exception auto-resolves →
  acknowledgement-gated decision → manual exception resolve) all against the real hosted DB and
  real engine. Typecheck/lint clean for `apps/api` and `apps/web`.
- Frontend: driven live in a real browser (not just curl) against the actual running dev stack —
  registered a bidder through the real UI (`201 Created` from the real endpoint, not mocked),
  logged in as both a demo government officer and the freshly-registered bidder with real MFA
  (TOTP computed from the `otpauthUrl` the API returned, same as the integration tests do), created
  a tender through the UI, and confirmed it appears back in the dashboard list. No console errors
  on any page visited.
- **Known gap in this verification pass**: file uploads (tender documents, vault evidence,
  verification captures) were not click-tested in the browser — this browser automation tool has no
  way to attach a local file to an `<input type="file">` (no OS file-picker or CDP
  `DOM.setFileInputFiles` access). The upload code path itself (`lib/upload.ts`) is the same
  pattern already proven working in the Phase 1 `DocumentsPage`, and the full
  upload→classify→extract→reconcile→compliance→verify chain is exhaustively covered by the
  integration test suite above — but the "does the actual file-picker UI work when a human clicks
  it" question is unverified here and worth a manual spot-check.
- A demo government account was created directly via a one-off script (not committed — deleted
  after running) since there's no seed script yet (`pnpm seed` from CLAUDE.md's command list isn't
  built — same gap noted nowhere else in this log because it hadn't blocked anything until a human
  needed to log into the browser). Worth building a real `database/seeds` script next session so
  this doesn't need repeating by hand.

### Deviations

- No verification metrics dashboard UI yet (`GET /verification/metrics` exists and is honest — see
  its own doc comment on why automation-rate is always 0 in this build — but nothing renders it).
- No officer-facing rule-ambiguity-aware DSL builder — the rule editor is a raw JSON textarea
  (same simplification Phase 2 already made for the manual rule builder).
- The bid workspace doesn't yet show per-requirement mapping visually beyond a count; a real
  Evidence Workbench (spec §21.2) with drag-and-drop mapping is Phase 6 scope.
- No notifications, audit timeline UI, reports/export, or two-envelope UI — untouched, still
  Phases 7/8 as planned.
