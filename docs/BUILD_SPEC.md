# TENDERSENTRY — COMPLETE BUILD SPECIFICATION FOR CLAUDE CODE

> **GeM's Intelligence & Trust Layer**
> AI understands. Python verifies. Evidence proves. The officer decides.

This single file is the complete, authoritative handoff for building TenderSentry as a full, working, deployable web application. It merges and reconciles three source documents (the Full Product Blueprint PDF, the Product/UX/Technical Specification, and the Detailed Solution). Where the sources disagreed, this file records the decision taken (see §0.4). If anything here conflicts with the source documents, **this file wins**.

> **Amendment A1 (2026-09-28): Supabase is the database platform.** At the product owner's request, PostgreSQL is provided by **Supabase** (hosted, with the Supabase CLI local stack for development), and object storage is **Supabase Storage** through its S3-compatible endpoint. The amended sections are marked **[Supabase]**. Summary: §0.4, §4.1, §4.2, §4.3, §5, §6.5, §7, §16, §24, §25. Rationale and trade-offs: `docs/DECISIONS.md` ADR-001 to ADR-004.

---

## 0. INSTRUCTIONS FOR CLAUDE CODE (READ FIRST)

### 0.1 How to use this file

1. Save this file in the repository as `docs/BUILD_SPEC.md`. Treat it as the source of truth.
2. Create a short `CLAUDE.md` at the repo root (under 150 lines) containing: the one-paragraph product summary, the non-negotiable rules from §2, the repo layout from §4.3, the commands to run/test/lint, and the line "Full spec: docs/BUILD_SPEC.md — read the relevant section before starting any task."
3. Create `docs/PROGRESS.md`. Before starting each phase in §27, write the phase's checklist into it; tick items as they are completed with the date; record every deviation from this spec and why.
4. Build **phase by phase in the order of §27**. Do not start a phase until the previous phase's acceptance criteria pass. The vertical slice (§27, Phases 0–7) must work end-to-end before any "later" module is started.
5. After each phase: run the full test suite, run the seed script against a fresh database, click through the relevant flows (use Playwright e2e tests), and update `docs/PROGRESS.md`.
6. When a detail is genuinely unspecified, choose the simplest option consistent with §2 and this spec, and record the choice in `docs/DECISIONS.md` (short ADR entries). Do not stop to ask about small details; do ask the user before: adding a paid third-party service, weakening any rule in §2, or dropping an MVP feature.
7. Never mark a feature done because the page renders. "Done" is defined in §27.2.

### 0.2 What "full-fledged, working, deployable" means here

- Every screen in §21 exists, is reachable via navigation, reads and writes real data through the API, and has loading, empty and error states.
- Every button listed does what it says, or is visibly disabled with a tooltip that says why (e.g. "Approve is available once the rule has a source clause").
- **[Supabase]** `supabase start` followed by `docker compose up` (wrapped as `pnpm stack:up`) on a clean machine brings up the entire system with seeded demo data. A production deployment path (§25) against a hosted Supabase project is documented and tested.
- Nothing is faked. Where a real government integration is not available, the UI says so explicitly (§14.6).

### 0.3 The one flow that must work first (walking skeleton)

```
Sample tender PDF → clause → candidate rule → officer approves
→ bidder PDFs → extract PAN / GSTIN → compare across documents
→ CONSISTENT / REVIEW_REQUIRED → verify → deterministic compliance
→ score → risk → multi-bidder dashboard → evidence workbench → officer decision → audit
```

Everything else is built around this slice, not instead of it.

### 0.4 Decisions that reconcile conflicts between the source documents

| Topic | Source A | Source B | Decision |
|---|---|---|---|
| Login pages | 3 entry points (government / bidder / admin) | 1 common `/login` | **Three entry URLs** (`/login/government`, `/login/bidder`, `/login/admin`) sharing **one auth service**. `/login` shows a chooser. An account can only sign in through the entry matching its portal type. No per-role login pages. |
| Backend | Node API + Python service | "Node or FastAPI" | **Node.js (Express, TypeScript) API** for auth, workflow, CRUD, notifications; **one Python FastAPI "engine" service** (modular packages: documents, extraction, rules, compliance, verification, reports). The blueprint's four Python services become four packages inside one deployable service to keep deployment simple; boundaries are kept clean so they can be split later. |
| Knowledge graph | Neo4j | "Neo4j optional" | Relationship signals are computed in **PostgreSQL** in the MVP (shared directors/addresses/contacts tables + SQL). Neo4j is an optional later adapter behind a feature flag. PostgreSQL is always the source of truth. |
| LLM provider | OpenAI key mentioned | unspecified | **Provider-agnostic** LLM client (`MODEL_PROVIDER` = `anthropic` \| `openai` \| `none`). Default `anthropic`. If `none` or key missing, the system still works end-to-end: rule candidates must be authored with the manual rule builder, and the UI states "AI interpretation unavailable". |
| Roles | Buyer, Technical Evaluator, Committee, Approving Authority, Auditor, Primary User | Procurement Officer, Tender Admin, Verifier, Auditor | Unified role list in §6.2. |
| Tender creation in MVP | "Create/import" in MVP; Co-Pilot is vision | "Create Tender" in MVP | MVP: create tender (form) **and** import tender PDF. AI Tender Co-Pilot is Phase 10+. |
| Bidder portal in MVP | Full bidder portal specified | "Bidder package processing" | MVP includes the bidder portal (profile, evidence vault, discovery, readiness check, bid workspace, submission). Officers can additionally **import a bidder package** manually for tenders run outside TenderSentry. |
| **[Supabase]** Database & storage | PostgreSQL + MinIO/S3 | "Supabase-compatible" | **Supabase** Postgres is the system of record (hosted project in production/demo; Supabase CLI local stack in development). **Supabase Storage** (private buckets, S3-compatible endpoint) replaces MinIO. Prisma remains the ORM and migration tool. |
| **[Supabase]** Authentication | own auth | — | **App-owned auth stays** (three portals, argon2id, TOTP, org resolution, portal-bound accounts). Supabase Auth is **not** used, because it cannot express portal-bound identities, per-org role resolution and the audit-in-transaction rule without duplicating state. |
| **[Supabase]** Data API exposure | — | — | The browser **never talks to Supabase directly**. All data flows through the Express API. Supabase's auto-generated Data API (PostgREST/GraphQL) is locked down: RLS enabled with no policies on every app table, and all privileges revoked from `anon` and `authenticated` (§7.0). The `anon` key is not shipped to the frontend at all. Supabase Realtime is not used (SSE from the API instead). |

---

## 1. PRODUCT DEFINITION

### 1.1 One paragraph

TenderSentry is a tender-aware, evidence-first, AI-assisted compliance verification and decision-support platform for government procurement (GeM ecosystem). It converts tender clauses into officer-approved structured rules; processes bidder documents; extracts claims and evidence with page/coordinate provenance; verifies claims through legitimately available machine-verifiable sources; reconciles information across documents; routes human-only verification (CAPTCHA/OTP/login) into a managed queue; evaluates compliance with a closed deterministic rule engine; produces an explainable compliance score and a separate risk level; surfaces exceptions on a multi-bidder dashboard; and records every step in a tamper-evident audit trail. The officer makes every decision.

### 1.2 Positioning

- TenderSentry is **not** a replacement for GeM, not a marketplace, not a chatbot, not a fraud declaration engine, not an autonomous decision-maker.
- It is the **intelligence and trust layer** around procurement: "We make the procurement evidence and evaluation layer intelligent, traceable and easier to verify."
- Closing vision: *TenderSentry starts as evidence-backed compliance verification — and scales into a trust layer across GeM's procurement lifecycle, from verified bidder identity through award.*
- Fraud principle: *Move fraud prevention upstream.* Never claim zero fraud.

### 1.3 Core chain (the product's backbone)

```
TENDER → CLAUSE → RULE (officer-approved) → REQUIREMENT → BIDDER CLAIM → EVIDENCE
→ VERIFICATION → DETERMINISTIC EVALUATION → RESULT → SCORE + RISK
→ EXCEPTIONS → OFFICER REVIEW → DECISION → AUDIT
```

Every result in the UI must be navigable backwards along this chain.

### 1.4 Division of labour

| Actor | May | May not |
|---|---|---|
| LLM | interpret clauses, classify documents, extract ambiguous/semantic fields, suggest, explain | finalise compliance, change approved rules, execute code, invent verification, declare fraud, award |
| Deterministic code (Python) | regex/format validation, arithmetic, dates, thresholds, rule evaluation, scoring, reconciliation | guess |
| Verification adapters | query authorised sources, verify signatures/QR/issuers | report a simulated result as authoritative |
| Officer | approve/edit/reject rules, resolve exceptions, override with reason, record decisions | change anything silently |

---

## 2. NON-NEGOTIABLE RULES

Put all of these into `CLAUDE.md`. Every PR/phase is checked against them.

1. No fake government integrations. A source is shown `LIVE / VALIDATED` only if the system itself recorded a successful live health check (§14.6).
2. No fake verification results. Simulated/sandbox results carry mode `SIMULATED` and can never reach `AUTHORITATIVE_VERIFIED`, and are visibly labelled "Simulated — not a government verification". The simulated adapter is disabled when `APP_ENV=production`.
3. No execution of LLM-generated code. The LLM emits JSON in the closed Rule DSL (§12); a safe interpreter executes it. No `eval`, `exec`, `Function()`, dynamic imports from model output.
4. No AI-only compliance. No rule executes unless its version status is `APPROVED`/`ACTIVE` and it carries the approving officer's ID.
5. No silent overrides. Every change to a system result creates a new state record with reason, actor, time; the original is preserved.
6. Never display "fraud", "fraud detected", "collusion", "blacklisted by AI", "suspicious" or similar. Use: *Identity conflict*, *Evidence conflict*, *Relationship signal*, *Review required*.
7. No universal "verified bidder" legal claim. The badge is "TenderSentry Verified" with the defined meaning (§13.3).
8. No invented numbers. No accuracy/automation/workload percentages anywhere in the UI or marketing pages unless produced by the benchmark scripts (§23.4) and dated.
9. No cross-organisation data exposure. Enforced on the server for every query. **[Supabase]** This includes Supabase's Data API: RLS on, no policies, no grants to `anon`/`authenticated`.
10. No financial-bid leakage before authorised opening (§15.9).
11. Every result is traceable to evidence.
12. Every rule is versioned; approved versions are immutable.
13. Every critical mutation writes an audit event in the same DB transaction.
14. Every external source has an explicit capability/status flag.
15. Frontend role hiding is cosmetic only; the API enforces every permission.
16. Minimum necessary data to LLMs: tender clause text only for rule compilation; never send PAN/GSTIN/bank/personal documents to an external LLM unless `LLM_ALLOW_BIDDER_DOCS=true` and then only the specific page text needed.
17. Idempotency on publish tender, submit bid, create verification, record decision, award.
18. Build the complete vertical slice before expanding features.
19. **[Supabase]** The Supabase `service_role` key and database passwords are server-side secrets only; they never appear in `apps/web`, in client bundles, in logs or in git.

---

## 3. SCOPE

### 3.1 MVP (must ship, Phases 0–9)

Government login · Bidder login · Admin login · MFA · Organisation profiles · RBAC · multi-tenancy · Tender create + PDF import · clause extraction · AI rule compiler + manual rule builder · three-pane rule approval · rule versioning · corrigendum with impact analysis · public tender pages · bidder onboarding & profile · evidence vault · tender discovery · readiness check · bid workspace · pre-submission check · bid submission with hashes · officer-side bidder package import · document pipeline (native text + OCR) · PAN/GSTIN/CIN/Udyam/amount/date extraction · evidence mapping with page + bbox · cross-document reconciliation & conflict engine · verification router · structural validators · PDF digital-signature verification · QR decoding · human verification queue with evidence capture · source registry with honest statuses · deterministic compliance engine · mandatory gates · weighted score with breakdown · risk engine · exception engine & workspace · multi-bidder evaluation dashboard with filters · Evidence Workbench · officer decision & override workflow · clarification workflow · two-envelope separation · tamper-evident audit trail + timeline · notifications (in-app + email) · compliance report (PDF/CSV/JSON) · global search · admin panel (users, orgs, sources, integrations, jobs, feature flags, audit) · public marketing site · seeded deterministic demo.

### 3.2 Later (Phases 10+; architecture must leave room, do not build before MVP passes)

Tender Co-Pilot (AI draft of requirements) · procurement-policy warnings during creation · relationship graph visualisation with Neo4j · live GST/DigiLocker/EPFO/ESIC/MCA adapters (once credentials exist) · award workflow · contract/fulfilment/payment modules · government analytics · GeM/approved SSO · SMS notifications · pgvector clause similarity (**[Supabase]** the `vector` extension is available on Supabase; enable it only in this phase).

### 3.3 Explicitly out of scope

Marketplace, payment engine, order fulfilment, full ERP, reverse auctions, "replacement of GeM".

---

## 4. ARCHITECTURE

### 4.1 System diagram [Supabase]

```
Browser (React SPA)            ← never holds Supabase keys; talks only to /api
   │  HTTPS, httpOnly session cookie
   ▼
Caddy / nginx (TLS, static files, /api proxy)
   │
   ▼
API (Node.js + Express + TypeScript) ──► Supabase
   │  auth, RBAC, tenancy, workflows,       ├─ Postgres (source of truth, via Prisma;
   │  audit, notifications                  │    runtime role ts_app through Supavisor pooler,
   │                                        │    migrations as postgres over the direct/session port)
   │                                        └─ Storage (private buckets, S3-compatible endpoint,
   │                                             signed URLs issued by the API only)
   │                                     ── Redis (BullMQ queues, rate limit)
   │                                     ── SMTP (Mailpit locally)
   ├── Worker (Node, BullMQ consumers) ──► Engine (Python FastAPI, internal network only)
   │                                         ├── documents   (validation, hashing, text, OCR, layout, tables, QR, signatures)
   │                                         ├── extraction  (regex/normalisers, classifier, LLM-assisted fields)
   │                                         ├── rules       (clause segmentation, LLM compiler, DSL schema, validator)
   │                                         ├── compliance  (interpreter, calculations, gates, score, risk)
   │                                         ├── verification(adapters, router, reconciliation)
   │                                         └── reports     (PDF generation)
   └── LLM provider (via engine only; minimum-necessary data)
```

The engine is never exposed publicly. API ↔ engine auth: shared secret header `X-Engine-Token` + internal network. The engine does **not** connect to the database; it receives inputs from the API/worker and reads/writes files through short-lived signed URLs or the storage S3 endpoint with its own scoped credentials.

### 4.2 Technology choices

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite, React Router v6, TanStack Query, react-hook-form + zod, Tailwind CSS, Radix UI primitives (shadcn/ui pattern), `react-pdf` (pdf.js) for document viewer with bbox overlays, Recharts for charts, `@xyflow/react` for the relationship graph (later), lucide-react icons |
| API | Node 20 LTS, Express, TypeScript, Prisma ORM, zod validation, argon2 password hashing, `otplib` (TOTP), `jose` (JWT), BullMQ, pino logging, helmet, express-rate-limit (Redis store), nodemailer, `@aws-sdk/client-s3` (pointed at Supabase Storage's S3 endpoint) |
| Engine | Python 3.12, FastAPI, pydantic v2, PyMuPDF (fitz), Tesseract via `pytesseract` (+ `ocrmypdf` optional), `pdfplumber` for tables, `opencv-python-headless` + `pyzbar` for QR, `pyHanko` for PDF signature validation, `reportlab` for reports, `jsonschema`, `anthropic` / `openai` SDKs behind one interface, `python-magic` for MIME sniffing, `clamd` client (optional ClamAV) |
| DB **[Supabase]** | Supabase Postgres (15+). Extensions: `pgcrypto`, `citext`, `pg_trgm` (all available on Supabase; created in the `extensions` schema). `vector` only in a later phase. Prisma `datasource` uses `url` = pooled connection (Supavisor transaction mode, `pgbouncer=true`) and `directUrl` = direct/session connection for migrations. |
| Storage **[Supabase]** | Supabase Storage, private buckets (`documents`, `captures`, `reports`, `page-images`, `public-tender-docs`). Accessed server-side through the S3-compatible endpoint (`/storage/v1/s3`, path-style, S3 access keys generated in the Supabase dashboard). Access for users only via short-lived signed URLs issued by the API after permission checks. No bucket is public; public tender documents are also served through the API. |
| Queue | Redis 7 + BullMQ |
| Tests | Vitest (web + api unit), Supertest (api integration), pytest (engine), Playwright (e2e) |
| Tooling | pnpm workspaces, Turborepo optional, ESLint, Prettier, ruff + mypy for Python, pre-commit hooks, GitHub Actions CI, **Supabase CLI** (local stack, bucket config) |

### 4.3 Repository layout [Supabase]

```
tendersentry/
├── CLAUDE.md
├── docker-compose.yml               # app services (api, worker, engine, web/caddy, redis); DB+storage come from Supabase
├── docker-compose.prod.yml          # production overrides
├── Caddyfile
├── .env.example
├── supabase/
│   └── config.toml                  # Supabase CLI local stack config (ports, storage buckets, auth disabled for app use)
├── apps/
│   ├── web/                         # React SPA (public site + government + bidder + admin workspaces)
│   │   └── src/{app,routes,features,components,lib,styles}
│   ├── api/                         # Express API
│   │   ├── prisma/{schema.prisma,migrations/,sql/}   # sql/ holds triggers, append-only rules, RLS lock-down, roles
│   │   └── src/{modules/*,middleware,lib,jobs,audit,authz}
│   └── worker/                      # BullMQ consumers (can share code with api via packages)
├── services/
│   └── engine/                      # Python FastAPI
│       ├── engine/{documents,extraction,rules,compliance,verification,reports,llm,common}
│       ├── tests/
│       └── golden/                  # golden dataset (§23.3)
├── packages/
│   ├── types/                       # shared TS types + generated OpenAPI client
│   ├── rule-schema/                 # Rule DSL JSON Schema (single source; Python loads the same file)
│   ├── ui/                          # design-system components
│   └── validators/                  # shared zod schemas, PAN/GSTIN validators (TS mirror of Python)
├── database/seeds/                  # seed orchestrator + synthetic document generator
├── docs/{BUILD_SPEC.md,PROGRESS.md,DECISIONS.md,architecture/,api/,rule-dsl/,deployment.md}
└── tests/e2e/                       # Playwright
```

Migrations live only in `apps/api/prisma/migrations` (Prisma-owned). The `supabase/migrations` folder is **not** used for app schema, to keep a single migration history. The Supabase CLI is used for the local stack and storage bucket configuration only.

### 4.4 Asynchronous processing

Never block an HTTP request on PDF/OCR/LLM work. Uploads return a document ID immediately; work runs in queues.

Queues (BullMQ): `document_processing`, `ocr_processing`, `llm_extraction`, `rule_compilation`, `reconciliation`, `verification`, `compliance`, `report_generation`, `notifications`.

Every job row (`jobs` table) stores `job_id, queue, entity_type, entity_id, status (QUEUED|RUNNING|SUCCEEDED|FAILED|DEAD), attempts, max_attempts, started_at, finished_at, error_code, error_message, payload_hash`. The UI polls `GET /api/jobs/:id` (or subscribes via SSE `GET /api/events/stream`) to show real progress.

Retry policy: OCR, LLM, report, notification, read-only verification calls retry with exponential backoff (max 3). Bid submission, decisions, publish, award are never auto-retried; they are idempotent via `Idempotency-Key` header (stored in `idempotency_keys` with response snapshot, 24h TTL).

### 4.5 Error response format (all API errors)

```json
{ "error": { "code": "VERIFICATION_UNAVAILABLE", "message": "Authoritative verification source is unavailable.", "retryable": true, "details": {} , "requestId": "req_…" } }
```

Error codes enum lives in `packages/types`. The frontend maps each code to plain-language copy (§26).

---

## 5. CONFIGURATION [Supabase]

`.env.example` (commit this; never commit `.env`):

```
APP_ENV=local                     # local | demo | staging | production
APP_BASE_URL=http://localhost:8080
API_PORT=4000
ENGINE_URL=http://engine:8000
ENGINE_TOKEN=change-me

# --- Supabase: Postgres ---
# Runtime (API/worker): pooled connection via Supavisor, transaction mode, as the restricted ts_app role.
DATABASE_URL=postgresql://ts_app:ts_app_local@host.docker.internal:54322/postgres
# Migrations/seed: direct (or session-mode) connection as the owner role.
DIRECT_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres
# Hosted example:
#   DATABASE_URL=postgresql://ts_app.<project-ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5
#   DIRECT_URL=postgresql://postgres.<project-ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres

# --- Supabase: project (server-side only; never exposed to apps/web) ---
SUPABASE_URL=http://host.docker.internal:54321
SUPABASE_SERVICE_ROLE_KEY=        # used only for storage admin tasks (bucket bootstrap); not needed at runtime

# --- Supabase Storage (S3-compatible endpoint) ---
STORAGE_ENDPOINT=http://host.docker.internal:54321/storage/v1/s3
STORAGE_REGION=local              # hosted: the project's region, e.g. ap-south-1
STORAGE_FORCE_PATH_STYLE=true
STORAGE_BUCKET_DOCUMENTS=documents
STORAGE_BUCKET_CAPTURES=captures
STORAGE_BUCKET_REPORTS=reports
STORAGE_BUCKET_PAGE_IMAGES=page-images
STORAGE_ACCESS_KEY=               # Supabase dashboard → Storage → S3 access keys (local: printed by `supabase status`)
STORAGE_SECRET_KEY=
FILE_MAX_MB=25

REDIS_URL=redis://redis:6379
SESSION_JWT_SECRET=change-me-64-bytes
SESSION_TTL_MINUTES=60
REFRESH_TTL_DAYS=7
APP_ENCRYPTION_KEY=               # 32-byte base64, AES-GCM for mfa secrets + provider credentials
SMTP_HOST=host.docker.internal    # local: Supabase CLI's bundled Mailpit (web UI :54324, SMTP :54325)
SMTP_PORT=54325
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM="TenderSentry <no-reply@tendersentry.local>"
MODEL_PROVIDER=anthropic          # anthropic | openai | none
MODEL_NAME=                       # configurable, never hard-coded
MODEL_PROVIDER_KEY=
LLM_ALLOW_BIDDER_DOCS=false
OCR_LANGS=eng+hin
CLAMAV_HOST=                      # optional; if empty, scan step records SKIPPED (not PASSED)
DEMO_MODE=false                   # true only for local/demo; enables demo banner + demo OTP
DEMO_OTP=000000
SIMULATED_ADAPTER_ENABLED=false   # forced false when APP_ENV=production
GST_PROVIDER_BASE_URL=
GST_PROVIDER_KEY=
DIGILOCKER_CLIENT_ID=
DIGILOCKER_CLIENT_SECRET=
FEATURE_RELATIONSHIP_GRAPH=false
FEATURE_TENDER_COPILOT=false
NEO4J_URI=
NEO4J_USERNAME=
NEO4J_PASSWORD=
```

Environments: `local` (Supabase CLI stack), `demo` (hosted Supabase project, hackathon deployment), `staging` (separate hosted project), `production` (separate hosted project, `ap-south-1` Mumbai region preferred for data residency). Each environment has its own Supabase project; never share a project between environments. Config loaded and validated at boot with zod (API) and pydantic-settings (engine); boot fails on missing required values.

---

## 6. ACTORS, AUTHENTICATION, ROLES, PERMISSIONS, TENANCY

### 6.1 Portal types

| Portal | Who | Entry URL | Home |
|---|---|---|---|
| GOVERNMENT | Government/buyer organisation users | `/login/government` | `/government/dashboard` |
| BIDDER | Seller/bidder organisation users | `/login/bidder` | `/bidder/dashboard` |
| PLATFORM | TenderSentry system administrators | `/login/admin` | `/admin/dashboard` |
| PUBLIC | Anyone, no login | — | `/`, `/tenders` |

Each `users` row has exactly one `portal_type`. Signing in through a different entry returns the same generic "Incorrect credentials" error (do not reveal that the account exists in another portal).

### 6.2 Roles

Government organisation roles (a user may hold several; roles are per organisation):

| Role | Purpose |
|---|---|
| `ORG_ADMIN` (Primary User) | Manage organisation profile and its users/role assignments. No automatic procurement rights. |
| `BUYER` (Procurement Officer) | Create/import tenders, run rule extraction, approve rules, manage corrigenda, publish, open evaluations, record decisions on assigned tenders. |
| `TECHNICAL_EVALUATOR` | Review technical compliance, evidence, exceptions; record technical recommendation. Cannot see financial envelope. |
| `FINANCIAL_EVALUATOR` | Access financial envelope only after authorised opening. |
| `VERIFIER` | Work the verification queue for assigned tasks. |
| `COMMITTEE_MEMBER` | Read and comment on assigned evaluations; record committee votes/notes. |
| `APPROVING_AUTHORITY` | Approve tender publication; record final decision/award (award is Phase 10+, decision is MVP). |
| `AUDITOR` | Read-only: tenders, rules, evidence provenance, verifications, decisions, audit logs, reports. No mutations except exporting. |

Bidder organisation roles: `BIDDER_ADMIN` (manage company profile, users, evidence; submit bids), `BID_USER` (prepare bids, upload documents; submit only if also granted `bid.submit`), `DOCUMENT_MANAGER` (evidence vault only).

Platform role: `SYSTEM_ADMIN` — users, organisations, integrations, source registry, feature flags, jobs, audit infrastructure. **Never** has procurement permissions and cannot read bidder documents' contents or change any procurement result; admin actions on users are audited.

Tender-level assignment: government users act on a tender only if they belong to the owning organisation **and** are assigned to that tender (`tender_assignments`: tender_id, user_id, role). `ORG_ADMIN` assigns. `AUDITOR` has org-wide read.

### 6.3 Permission matrix (enforced in API middleware `authorize(permission, resourceLoader)`)

| Permission | Roles |
|---|---|
| `org.manage`, `org.users.manage` | ORG_ADMIN, BIDDER_ADMIN (own org) |
| `tender.create`, `tender.edit_draft`, `tender.import` | BUYER |
| `tender.submit_for_approval` | BUYER |
| `tender.approve_publication` | APPROVING_AUTHORITY |
| `tender.publish`, `tender.corrigendum.create` | BUYER (after approval) |
| `tender.corrigendum.approve` | APPROVING_AUTHORITY |
| `rule.compile`, `rule.edit`, `rule.approve`, `rule.reject` | BUYER, TECHNICAL_EVALUATOR (assigned) |
| `bid.view_technical` | BUYER, TECHNICAL_EVALUATOR, COMMITTEE_MEMBER, APPROVING_AUTHORITY, AUDITOR (assigned/org) |
| `bid.view_financial` | FINANCIAL_EVALUATOR, BUYER, APPROVING_AUTHORITY, AUDITOR — **only when tender.state ≥ FINANCIAL_EVALUATION and envelope opened** |
| `bid.import_package` | BUYER |
| `evaluation.run` | BUYER, TECHNICAL_EVALUATOR |
| `verification.work` | VERIFIER, BUYER, TECHNICAL_EVALUATOR |
| `verification.assign` | BUYER |
| `exception.assign`, `exception.resolve`, `exception.escalate` | BUYER, TECHNICAL_EVALUATOR |
| `result.override` | BUYER, APPROVING_AUTHORITY (reason mandatory) |
| `decision.record` | BUYER (technical outcome), APPROVING_AUTHORITY (final) — configurable per org |
| `committee.note` | COMMITTEE_MEMBER |
| `clarification.request` | BUYER, TECHNICAL_EVALUATOR |
| `report.generate`, `report.export` | BUYER, TECHNICAL_EVALUATOR, AUDITOR, APPROVING_AUTHORITY |
| `audit.read` | AUDITOR, BUYER (own tenders), APPROVING_AUTHORITY |
| `bidder.profile.manage`, `bidder.evidence.manage` | BIDDER_ADMIN, DOCUMENT_MANAGER (evidence only) |
| `bid.prepare` | BIDDER_ADMIN, BID_USER |
| `bid.submit`, `bid.withdraw`, `clarification.respond` | BIDDER_ADMIN (+ BID_USER if granted) |
| `platform.*` | SYSTEM_ADMIN only |

Write permission tests for every row: an allowed role succeeds; every other role gets 403 with code `FORBIDDEN`; a user from another organisation gets 404 (do not leak existence).

### 6.4 Authentication flows

Login (all portals):

```
Entry page → identifier (email / user ID) + password → MFA (TOTP, or email OTP fallback)
→ organisation resolution (chooser if the user belongs to more than one org)
→ role resolution → session issued → role-aware dashboard
```

- Passwords: argon2id, min 12 chars, breached-password check optional. Lockout: 5 failures → 15-minute lock; audit every failure.
- Session: short-lived access JWT (60 min) + rotating refresh token, both in `httpOnly; Secure; SameSite=Lax` cookies; CSRF double-submit token for mutating requests. Session records in `sessions` (device, IP, created, last_seen, revoked_at).
- MFA required for all government and admin users; bidder admins required, bid users optional (org policy).
- `DEMO_MODE=true`: demo accounts (flag `is_demo=true`) accept `DEMO_OTP`; the login page shows a clearly styled "Demo environment — test identities only" panel listing demo accounts. Never enabled in production (boot check).
- Forgot password: email link with single-use token (30 min).
- Invitations: ORG_ADMIN/BIDDER_ADMIN invites by email → activation link → set password → enrol MFA.
- Future SSO: `auth/providers/` abstraction with a `LocalProvider` now and an `OidcProvider` stub documented but disabled. Do not claim GeM SSO anywhere.
- **[Supabase]** Supabase Auth is not used (ADR-002). In `supabase/config.toml` and in hosted projects, disable public sign-ups in Supabase Auth so no parallel identity store accumulates users.

Bidder self-registration (`/register/bidder`):

```
Account (email, mobile, password) → email verification → Create organisation:
organisation type (Pvt Ltd / Public Ltd / LLP / Partnership / Proprietorship / Trust / Society / Other)
→ legal name → PAN → CIN/LLPIN/registration no. (conditional on type) → GSTIN(s) → Udyam (optional)
→ registered address → authorised person (name, designation, email, mobile, authorisation letter upload)
→ business details (categories, turnover band, year of establishment) → documents → Verification Centre
```

Government organisations are created only by SYSTEM_ADMIN (with the first ORG_ADMIN invite).

### 6.5 Multi-tenancy & document access

- Every tenant-owned table carries `organisation_id`; tender-scoped tables carry `tender_id`; bid-scoped tables carry `bid_id`/`bidder_org_id`.
- All data access goes through repository functions that require a `RequestContext {userId, orgId, portal, roles, tenderAssignments}` and apply scope filters. Add a lint rule / code review check: no raw Prisma calls in route handlers.
- Government org A can access a bidder document only if that document is part of a bid **submitted** to a tender owned by org A (via `bid_documents` snapshot). Bidder evidence vault items not attached to a submitted bid are invisible to government users.
- Bidder A can never read Bidder B's anything. Bidders never see other bidders' names on a tender until the procurement rules make it public (MVP: never).
- Document download: `GET /api/documents/:id/url` → permission check → audit `DOCUMENT_ACCESSED` → 5-minute signed URL (**[Supabase]** a Supabase Storage signed URL or an S3 presigned URL against the Storage S3 endpoint). Before serving, verify stored SHA-256 matches (integrity check; mismatch → `INTEGRITY_FAILURE` exception + block).
- **[Supabase]** Defence in depth: because tenancy is enforced in the API (not with RLS policies keyed on Supabase Auth JWTs), the Data API must be closed (§7.0). A CI test connects as `anon` and as `authenticated` and asserts that `SELECT` on every app table fails.

---

## 7. DATA MODEL (Supabase Postgres via Prisma)

### 7.0 [Supabase] Database roles, exposure lock-down and connection rules

- **Roles.** `postgres` (Supabase owner) runs migrations and seeds over `DIRECT_URL`. A dedicated runtime role `ts_app` (created by a migration in `prisma/sql/`, `LOGIN NOINHERIT`, not superuser, no `BYPASSRLS`) is used by API and worker over `DATABASE_URL`. `ts_app` gets `SELECT, INSERT, UPDATE, DELETE` on app tables **except** `audit_events`, `tender_versions`, `bid_versions`, `overrides` (INSERT + SELECT only).
- **RLS.** Every table in `public` created by the app has `ENABLE ROW LEVEL SECURITY` and exactly one policy: `CREATE POLICY ts_app_all ON <t> FOR ALL TO ts_app USING (true) WITH CHECK (true)`. No policy exists for any other role. (`ts_app` is the trusted server role; tenancy is enforced in the repository layer. A policy is used instead of `BYPASSRLS` because Supabase's `postgres` role cannot reliably grant that attribute on hosted projects.) A migration helper `ts_lock_down(table)` applies RLS + policy + revokes, and a test fails if any `public` table lacks it. `anon` and `authenticated` get `REVOKE ALL` on all app tables, sequences and functions, and `ALTER DEFAULT PRIVILEGES` ensures future tables are not granted to them. Result: Supabase's Data API returns nothing for app tables even if a key leaks.
- **Pooling.** Runtime uses Supavisor transaction mode (port 6543, `?pgbouncer=true`), which disables prepared statements in Prisma. Transaction-scoped advisory locks (`pg_advisory_xact_lock`) are used (session-level locks are not safe through a transaction pooler). Long-running scripts (seed, chain verification) use `DIRECT_URL`.
- **Extensions** are created in the `extensions` schema (Supabase convention): `pgcrypto`, `citext`, `pg_trgm`.
- **Triggers & immutability** (rule versions, audit append-only, `AUTHORITATIVE_VERIFIED` guard) live in hand-written SQL migrations under `prisma/migrations/*/migration.sql` sourced from `prisma/sql/`.
- **Backups.** Hosted Supabase daily backups (PITR recommended for production) plus `scripts/backup.sh` (`pg_dump` over `DIRECT_URL`) and Storage bucket export.

Conventions: UUID v7 primary keys (`id`), `created_at`, `updated_at`, `created_by`. Human-readable codes for display (`TEN-2026-0001`, `R-07`, `EXC-000123`, `VT-000045`, `AUD-…`). Money stored as `NUMERIC(20,2)` INR; never floats. Enums as Postgres enums. JSON columns are `jsonb` with zod/pydantic validation.

### 7.1 Identity & tenancy
- `organisations` (id, code, type: GOVERNMENT|BIDDER|PLATFORM, legal_name, display_name, org_subtype, pan, cin, status, address jsonb, created_at…)
- `users` (id, portal_type, email citext unique, user_id_handle, name, mobile, password_hash, mfa_secret_enc, mfa_enabled, is_demo, status ACTIVE|INVITED|LOCKED|DEACTIVATED, failed_logins, locked_until, last_login_at)
- `memberships` (user_id, organisation_id, status) ; `user_roles` (user_id, organisation_id, role)
- `tender_assignments` (tender_id, user_id, role)
- `sessions`, `password_reset_tokens`, `invitations`, `idempotency_keys`

### 7.2 Tenders
- `tenders` (id, code, organisation_id, public_id, title, category, department, procurement_mode: SINGLE_ENVELOPE|TWO_ENVELOPE, estimated_value, value_public bool, quantity, delivery_location, required_by, bid_open_at, bid_deadline, tech_opening_at, state, current_version, reference_date_policy: BID_DEADLINE|EVALUATION_DATE, public_fields jsonb)
- `tender_versions` (id, tender_id, version, reason: ORIGINAL|CORRIGENDUM, corrigendum_id, snapshot jsonb, created_by, created_at) — immutable
- `tender_documents` (id, tender_id, tender_version, document_id, role: MAIN|ANNEXURE|CORRIGENDUM|SCHEDULE|OTHER, is_public)
- `tender_clauses` (id, tender_id, tender_version, document_id, clause_ref, heading, text, page_start, page_end, bbox jsonb, category, is_requirement_candidate, segmentation_method)
- `requirements` (id, tender_id, code, title, category: IDENTITY|STATUTORY|FINANCIAL|EXPERIENCE|TECHNICAL|CERTIFICATION|DECLARATION|OTHER, mandatory bool, weight numeric, envelope: TECHNICAL|FINANCIAL, source_clause_id, status ACTIVE|REMOVED)
- `rules` (id, requirement_id, tender_id, code, current_version_id)
- `rule_versions` (id, rule_id, version, origin: AI_GENERATED|OFFICER_AUTHORED|OFFICER_EDITED|CORRIGENDUM|SEEDED, status: DRAFT|AI_EXTRACTED|REVIEW_REQUIRED|APPROVED|ACTIVE|REJECTED|SUPERSEDED, dsl jsonb, plain_english text, ambiguity_flags jsonb, validation_errors jsonb, llm_meta jsonb {provider, model, prompt_hash, latency_ms}, edit_reason, approved_by, approved_at, rejected_reason, supersedes_id, tender_version) — rows with status APPROVED/ACTIVE/SUPERSEDED are immutable (DB trigger)
- `corrigenda` (id, tender_id, code, from_version, to_version, summary, changes jsonb, impact jsonb, state: DRAFT|PENDING_APPROVAL|APPROVED|PUBLISHED|REJECTED, approved_by, published_at)
- `clarifications_public` (id, tender_id, question, answer, published_at) — tender Q&A

### 7.3 Bidders, profiles, evidence vault
- `bidder_profiles` (organisation_id PK, verification_level 0–3, badge_status, summary jsonb, updated_at)
- `authorised_persons` (id, organisation_id, name, designation, email, mobile, authorisation_document_id)
- `directors` (id, organisation_id, name, din, source_document_id) ; `addresses` (id, organisation_id, kind, raw, normalised, hash) ; `contacts` (id, organisation_id, kind, value_normalised)
- `vault_items` (id, organisation_id, evidence_type, document_id, document_version, status, valid_from, valid_until, freshness_policy, last_verified_at)

### 7.4 Documents
- `documents` (id, owner_org_id, uploaded_by, original_filename, mime, size_bytes, sha256, storage_bucket, storage_key, page_count, doc_type (§9.2), doc_type_confidence, classification_method, text_layer: NATIVE|OCR|MIXED|NONE, processing_status: UPLOADED|VALIDATING|PROCESSING|EXTRACTED|REVIEW_REQUIRED|FAILED|ARCHIVED, quality jsonb, scan_status: CLEAN|INFECTED|SKIPPED, envelope: TECHNICAL|FINANCIAL, version, version_group_id, supersedes_id)
- `document_pages` (id, document_id, page_no, width, height, rotation, text_source, text, words jsonb [{t, bbox}], ocr_confidence, image_key)
- `document_tables` (id, document_id, page_no, bbox, rows jsonb)

### 7.5 Bids
- `bids` (id, code, tender_id, bidder_org_id, state, tender_version_at_submission, submitted_at, submission_id, submitted_by, declaration_accepted_at, source: PORTAL|OFFICER_IMPORT, current_bid_version)
- `bid_versions` (id, bid_id, version, reason: SUBMISSION|CLARIFICATION|WITHDRAWAL, manifest jsonb [{document_id, sha256, requirement_codes, envelope}], manifest_hash, created_at) — immutable
- `bid_documents` (bid_id, bid_version, document_id, envelope, mapped_requirement_ids)
- `financial_bids` (id, bid_id, amount, currency, document_id, sealed bool, opened_at, opened_by) — access-controlled (§15.9)

### 7.6 Extraction, claims, evidence
- `extracted_fields` (id, document_id, field, value_raw, value_normalised jsonb, unit, page_no, bbox, confidence, method: NATIVE_REGEX|OCR_REGEX|TABLE_PARSE|LLM|MANUAL, extractor_version)
- `claims` (id, subject_org_id, bid_id nullable, claim_type (e.g. `PAN`, `GSTIN`, `ANNUAL_TURNOVER`, `EXPERIENCE_PROJECT`, `CERTIFICATE_VALIDITY`, `MSME_STATUS`, `DECLARATION`), key (e.g. FY label), value jsonb, status (§8.3), verification_status, verification_method, verified_at, valid_until, freshness_state, requirement_ids uuid[])
- `evidence` (id, claim_id, extracted_field_id, document_id, page_no, bbox, excerpt, role: SUPPORTS|CONFLICTS|CONTEXT, verification_result_id nullable)
- `reconciliation_results` (id, bid_id|org_id, field, outcome: CONSISTENT|NORMALISED_MATCH|CONFLICT|INSUFFICIENT_EVIDENCE, values jsonb [{value, evidence_id}], method, details)

### 7.7 Verification
- `verification_sources` (id, code: PAN|GST|UDYAM|MCA|DIGILOCKER|EPFO|ESIC|BIS|PDF_SIGNATURE|QR|CROSS_DOCUMENT|SIMULATED, name, domain, method: AUTHORIZED_API|PROVIDER_API|QR|DIGITAL_SIGNATURE|ISSUER|RECONCILIATION|OFFICER_ASSISTED|STRUCTURAL|SIMULATED, environment, capability_status (§14.6), last_health_check_at, last_health_result, credential_status: CONFIGURED|MISSING|INVALID, adapter_version, portal_url, notes)
- `verification_requests` (id, claim_id, bid_id, source_id, route: AUTO|RECONCILIATION|HUMAN|UNAVAILABLE, automation_state (§8.4), priority, created_by)
- `verification_tasks` (id, code, request_id, assignee_id, status: QUEUED|IN_PROGRESS|VERIFIED|FAILED|UNAVAILABLE|CONFLICT|EXPIRED|REVIEWED, attempts, last_attempt_at, due_at, notes)
- `verification_results` (id, request_id, mode, outcome: MATCH|NO_MATCH|NOT_FOUND|SOURCE_ERROR|SIGNATURE_VALID|SIGNATURE_INVALID|SIGNATURE_UNTRUSTED|DECODED, normalised jsonb, raw_response_key (storage), captured_document_id, checked_at, checked_by, valid_until, is_simulated bool)

### 7.8 Compliance, score, risk, exceptions, decisions
- `compliance_runs` (id, code, tender_id, bid_id, bid_version, tender_version, rule_version_ids uuid[], evidence_snapshot_hash, verification_snapshot_hash, engine_version, reference_date, status: RUNNING|COMPLETE|FAILED, started_at, finished_at, triggered_by, trigger_reason: MANUAL|SUBMISSION|CORRIGENDUM|CLARIFICATION|VERIFICATION_UPDATE)
- `requirement_results` (id, run_id, requirement_id, rule_version_id, result (§8.5), mandatory, weight, earned_weight, trace jsonb (full evaluation tree with inputs/outputs), explanation text, evidence_ids uuid[])
- `scores` (run_id PK, total numeric(5,2), applicable_weight, earned_weight, provisional bool, breakdown jsonb)
- `mandatory_gate_results` (run_id, passed_count, failed_count, pending_count, status: PASS|FAIL|PENDING)
- `risk_assessments` (run_id, level: LOW|MEDIUM|HIGH|CRITICAL, signals jsonb [{code, severity, reason, evidence_ids, source, detected_at}])
- `exceptions` (id, code, tender_id, bid_id, requirement_id, category (§15.7), severity, status: OPEN|ASSIGNED|IN_REVIEW|CLARIFICATION_REQUESTED|RESOLVED|ESCALATED|REOPENED, dedupe_key unique, title, detail, evidence_ids, assigned_to, resolution, resolved_by, resolved_at)
- `exception_comments` (id, exception_id, author_id, body, created_at)
- `overrides` (id, entity_type, entity_id, original_value jsonb, new_value jsonb, reason, reference, actor_id, created_at) — immutable
- `officer_actions` / `decisions` (id, tender_id, bid_id, run_id, action: TECHNICALLY_COMPLIANT|TECHNICALLY_NON_COMPLIANT|NEEDS_CLARIFICATION|REFER_TO_COMMITTEE|FINAL_DECISION, label (configurable per org), note, actor_id, role, created_at, idempotency_key)
- `clarification_requests` (id, bid_id, exception_id, requested_by, question, due_at, status: OPEN|RESPONDED|CLOSED|EXPIRED, response_text, response_bid_version)
- `decision_label_configs` (organisation_id, action, label, requires_role)

### 7.9 Platform
- `audit_events` (id bigserial, code, occurred_at, actor_id, actor_role, actor_portal, organisation_id, action, entity_type, entity_id, tender_id, bid_id, before jsonb, after jsonb, reason, evidence_refs jsonb, ip, session_id, request_id, prev_hash, hash) — append-only (§16)
- `notifications` (id, user_id, type, title, body, link, read_at, emailed_at)
- `jobs`, `feature_flags` (key, enabled, scope), `system_settings`, `reports` (id, type, entity_id, format, storage_bucket, storage_key, sha256, generated_by, generated_at, data_snapshot_hash)

Seed a `database/schema/ERD.md` generated from Prisma (prisma-erd-generator) and keep it current.

---

## 8. STATE MACHINES & STATUS ENUMS

Implement each as an explicit transition table in code (`transitions.ts` / `transitions.py`); any disallowed transition throws `INVALID_STATE_TRANSITION`. Every transition writes an audit event.

### 8.1 Tender
```
DRAFT → UNDER_REVIEW → APPROVED → PUBLISHED → OPEN_FOR_BIDS → BID_CLOSURE
→ TECHNICAL_EVALUATION → FINANCIAL_EVALUATION (two-envelope only) → AWARD_DECISION → CLOSED
side: CANCELLED (from any pre-CLOSED state, reason required); UNDER_REVIEW → DRAFT (returned with comments)
```
- `PUBLISHED → OPEN_FOR_BIDS` automatically at `bid_open_at` (scheduler job).
- `OPEN_FOR_BIDS → BID_CLOSURE` automatically at `bid_deadline`; submissions after deadline rejected server-side.
- Single-envelope skips FINANCIAL_EVALUATION. Corrigendum does not change state; it bumps `current_version`.
- Imported tenders (evaluation-only mode, tender run elsewhere): may be created directly in `TECHNICAL_EVALUATION` with flag `externally_published=true`.

### 8.2 Bid
```
DRAFT → READY_FOR_SUBMISSION → SUBMITTED → TECHNICAL_REVIEW → VERIFICATION → EVALUATED → DECISION
branches: CLARIFICATION_REQUIRED ⇄ TECHNICAL_REVIEW, WITHDRAWN (before deadline), REJECTED, AWARDED, UNSUCCESSFUL
```

### 8.3 Evidence / claim status (progression, highest reached is shown)
```
DOCUMENT_UPLOADED → FIELD_EXTRACTED → STRUCTURALLY_VALID → DOCUMENT_SUPPORTED → RECONCILED → AUTHORITATIVE_VERIFIED
alternates: CONFLICT, REVIEW_REQUIRED, UNVERIFIABLE, EXPIRED, REVOKED
```
`AUTHORITATIVE_VERIFIED` is reachable only via a verification result whose mode ∈ {AUTHORIZED_API, PROVIDER_API, ISSUER, QR (with captured source response), DIGITAL_SIGNATURE (trusted chain), OFFICER_ASSISTED (with captured artefact)} and `is_simulated=false`. Enforce with a DB CHECK/trigger and a unit test.

Freshness states for reusable evidence: `FRESH | EXPIRING (≤30 days, configurable) | EXPIRED | REVERIFICATION_REQUIRED | REVOKED | CONFLICTED`. Daily job recomputes.

### 8.4 Verification automation state
`AUTO_AVAILABLE | EVIDENCE_RECONCILIATION | HUMAN_REQUIRED | UNAVAILABLE | FAILED | VERIFIED | CONFLICT | EXPIRED`

### 8.5 Compliance result (per requirement)
`NOT_ASSESSED | PENDING_VERIFICATION | PASS | FAIL | REVIEW_REQUIRED | NOT_APPLICABLE | BLOCKED` (BLOCKED = cannot evaluate because the rule is not approved or a dependency errored).

### 8.6 Rule version
`DRAFT → AI_EXTRACTED → REVIEW_REQUIRED → APPROVED → ACTIVE → SUPERSEDED`; `REJECTED` terminal. Editing an APPROVED/ACTIVE version creates a new version (origin OFFICER_EDITED) in REVIEW_REQUIRED; the old one stays ACTIVE until the new one is approved, then becomes SUPERSEDED.

### 8.7 Document processing
`UPLOADED → VALIDATING → PROCESSING → EXTRACTED | REVIEW_REQUIRED | FAILED → ARCHIVED`

### 8.8 Exception
`OPEN → ASSIGNED → IN_REVIEW → RESOLVED | ESCALATED | CLARIFICATION_REQUESTED`; `RESOLVED → REOPENED → IN_REVIEW`

### 8.9 Bid evaluation (per bid, derived)
`NOT_STARTED → EVALUATING → COMPLETE → OFFICER_REVIEW → DECISION_RECORDED`

---

## 9. DOCUMENT PROCESSING ENGINE (Python `engine.documents`)

### 9.1 Pipeline

```
Upload (API) → size/extension/MIME sniff check → SHA-256 → duplicate check (same org + same hash → reuse, note DUPLICATE)
→ store original in Supabase Storage bucket `documents` (never modified) → documents row (UPLOADED) → enqueue document_processing
Worker/engine: VALIDATING: open with PyMuPDF (reject encrypted/corrupt → FAILED: DOCUMENT_UNREADABLE)
→ malware scan (ClamAV if configured; else scan_status=SKIPPED — never "CLEAN")
→ per page: native text? (≥ 30 chars of extractable text and < 30% garbage glyphs) → words with bboxes via page.get_text("words")
   else → rasterise at 300 DPI → deskew/rotation detect (Tesseract OSD) → OCR with word boxes (pytesseract image_to_data) → ocr_confidence
→ quality gate: blank pages, low OCR confidence (< 60 mean) → quality.flags; document → REVIEW_REQUIRED if critical pages unreadable
→ layout & tables (pdfplumber for native; OCR table heuristics for scans)
→ classification (§9.2) → field extraction (§10) → normalisation → extracted_fields
→ QR detection on each page image (pyzbar) → store decoded payloads
→ embedded signature detection (pyHanko) → queue signature verification
→ status EXTRACTED; emit event → API creates/updates claims + evidence, then enqueues reconciliation & compliance
```

Keep the original file, the page images (bucket `page-images`, for the viewer highlight overlay on scans), and the extracted representation separately. Coordinates are stored in PDF points in page space (origin top-left, unrotated), so the frontend overlay is `bbox × (renderWidth / pageWidth)`.

### 9.2 Document types

`PAN_CARD, GST_CERTIFICATE, UDYAM_CERTIFICATE, INCORPORATION_CERTIFICATE (CIN/LLPIN/registration), ITR_ACKNOWLEDGEMENT, BALANCE_SHEET, PROFIT_AND_LOSS, CA_CERTIFICATE_TURNOVER, CA_CERTIFICATE_NETWORTH, EXPERIENCE_CERTIFICATE, WORK_ORDER, COMPLETION_CERTIFICATE, OEM_AUTHORISATION, BIS_CERTIFICATE, ISO_CERTIFICATE, DECLARATION (debarment / integrity / local content / MSE), LOCAL_CONTENT_CERTIFICATE, EPFO_REGISTRATION, ESIC_REGISTRATION, AUTHORISATION_LETTER, FINANCIAL_BID, TENDER_DOCUMENT, CORRIGENDUM, OTHER`

Classification order: (1) uploader-declared type (bidder picks from list), (2) deterministic keyword signatures (e.g. "Udyam Registration Certificate", "Form GST REG-06", "Permanent Account Number", "Certificate of Incorporation"), (3) LLM classification on the first-page text only if 1–2 disagree or are empty and `MODEL_PROVIDER≠none`. A declared-vs-detected mismatch creates a `FIELD_CONFLICT`-style low-severity exception ("Uploaded as GST certificate; content looks like a PAN card").

---

## 10. FIELD EXTRACTION & NORMALISATION (Python `engine.extraction`)

Deterministic first; LLM only for semantic/ambiguous fields. Every extracted field stores field, raw value, normalised value, document, page, bbox, confidence, method, extractor version.

### 10.1 Identifiers (regex + validators; share test vectors with `packages/validators`)

| Field | Pattern | Validation |
|---|---|---|
| PAN | `\b[A-Z]{5}[0-9]{4}[A-Z]\b` | 4th char ∈ {C,P,H,F,A,T,B,L,J,G}; else STRUCTURAL warning `PAN_TYPE_UNKNOWN`. For company bidders expect `C` (LLP/firm `F`) → mismatch is a review signal. OCR confusion repair only for display suggestions (0↔O, 1↔I, 5↔S, 8↔B) in the numeric/alpha positions — never silently change the stored raw value. |
| GSTIN | `\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b` | State code 01–38 (+97, 99); characters 3–12 = PAN; checksum (below). |
| CIN | `\b[LU][0-9]{5}[A-Z]{2}[0-9]{4}(PLC\|PTC\|FLC\|GOI\|NPL\|SGC\|GAP\|GAT\|ULL\|ULT\|OPC)[0-9]{6}\b` | Year plausible; listing flag L/U. |
| LLPIN | `\b[A-Z]{3}-[0-9]{4}\b` | — |
| Udyam | `\bUDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}\b` | State code alpha 2. |
| DIN | `\b[0-9]{8}\b` near "DIN" | context-required |
| Email, phone (+91 10-digit starting 6–9), PIN code (6 digits) | standard | — |
| Dates | dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, "12 March 2025", "12th Mar, 2025", yyyy-mm-dd | Indian day-first default; ambiguous → confidence penalty |

GSTIN checksum (implement exactly, with tests):

```python
CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def gstin_checksum_ok(g: str) -> bool:
    total = 0
    for i, ch in enumerate(g[:14]):
        v = CHARS.index(ch) * (1 if i % 2 == 0 else 2)
        total += v // 36 + v % 36
    return CHARS[(36 - total % 36) % 36] == g[14]
```

Seed data must generate GSTINs with valid checksums computed by this function (and one deliberately invalid one for tests).

### 10.2 Money

Parse: `₹ 10,00,00,000`, `Rs. 10,00,00,000/-`, `INR 100000000`, `10 Crore`, `10 Cr`, `₹10 Cr.`, `1.5 lakh`, `15 Lakhs`, `(in ₹ lakh)` column headers, `12.50` under a "₹ in Crores" table header. Multipliers: lakh = 1e5, crore = 1e7, million = 1e6, thousand = 1e3. Use `Decimal`. Store `{amount: "120000000.00", currency: "INR", raw, unit_context}`. Negative values in parentheses → negative. Display with Indian grouping (`₹12,00,00,000` / "₹12 Cr").

### 10.3 Financial years (India, April–March)

- Canonical label `FY2024-25` = 1 Apr 2024 – 31 Mar 2025. Accept `2024-25`, `2024-2025`, `FY25`, `F.Y. 2024-25`, `AY 2025-26` (assessment year → FY = AY − 1, flag conversion in trace).
- `LAST_N_COMPLETED_FY` relative to a reference date (tender's `reference_date_policy`, default bid deadline): an FY is completed if its 31 March end date < reference date. Return the N most recent completed FYs.
- If the tender clause says "last three financial years" without "completed", the rule compiler must raise ambiguity flag `FY_COMPLETION_UNSPECIFIED`.
- If the latest completed FY's audited figures are absent but a provisional CA certificate is present, mark evidence `provisional=true` and let the rule's `allow_provisional` flag decide (default false → REVIEW_REQUIRED).

### 10.4 Financial tables

Turnover/net-worth extraction from CA certificates and P&L: detect table with FY columns/rows + amount column (pdfplumber; for scans, OCR line grouping by y-coordinate). Output one `ANNUAL_TURNOVER` claim per FY with evidence bbox of the specific cell. Totals rows are ignored for per-year values but cross-checked (sum mismatch → low-severity conflict).

### 10.5 Other fields

Legal name (after "Legal Name of Business", "Name of Enterprise", "Name" on PAN, company name in letterhead), trade name, registered address (normalised: lower-case, expand "No."/"Plot", roman ↔ arabic numerals for "Phase I/1", strip punctuation, PIN extracted), certificate number, issue/expiry dates, issuer, project value, client name, project completion date, declarations (checkbox/text "we are not debarred…" → claim `DECLARATION` with LLM-assisted interpretation marked `method=LLM`).

### 10.6 Confidence

Confidence ∈ [0,1] combining: text source (native 1.0; OCR = word confidence), pattern validity, label proximity (value found next to an expected label), cross-document agreement. **Extraction confidence is not authenticity.** UI label: "Extraction confidence". Fields < 0.75 create `LOW_EXTRACTION_CONFIDENCE` exceptions (threshold configurable).

---

## 11. TENDER UNDERSTANDING & RULE COMPILER (Python `engine.rules`)

### 11.1 Tender ingestion

Officer uploads tender PDF(s) (main document, annexures, schedules, corrigenda). Each gets `document_id`, version, hash, timestamp. Parse into clauses: numbered-heading detection (`^\d+(\.\d+)*\s`, `^\([a-z]\)`, "Clause 7.2", roman numerals), tables kept as units, footnotes attached to parent clause. Store `clause_ref`, page range, bbox, text. Candidate-requirement detection by keywords (shall, must, minimum, not less than, eligible, turnover, experience, certificate, registered, declaration, MSE, exemption, debar) and by LLM if available.

### 11.2 LLM rule compilation

Input to the LLM (and nothing else): the clause text, its heading path, up to 2 neighbouring clauses for context, tender metadata (category, reference-date policy), the Rule DSL JSON Schema, the list of allowed fields (§12.4) and operators. No bidder data.

System prompt essentials (store in `engine/rules/prompts/compile_rule.md`, versioned, prompt hash recorded):
- Output a single JSON object matching the schema; no prose, no markdown fences.
- Use only listed functions/fields/operators. If the clause cannot be expressed, return `{"expressible": false, "reason": "..."}`.
- Always fill `source.clause_ref`, `source.page`, `mandatory`, `on_missing_evidence`, `plain_english`, and `ambiguities[]` (each: `code`, `question`, `options[]`).
- Convert money to INR integers; list the original text in `source.quote`.

Post-processing (deterministic): strip fences → parse JSON → validate with JSON Schema (`packages/rule-schema/rule.schema.json`) → semantic validation (§12.5) → if invalid, one repair attempt sending the validation errors back → if still invalid, store with status `REVIEW_REQUIRED` and `validation_errors`; the officer fixes it in the rule builder. Record provider, model, latency, prompt hash in `llm_meta`.

If `MODEL_PROVIDER=none` or the call fails: candidate requirement is created with an empty rule and status `REVIEW_REQUIRED`, banner "AI interpretation unavailable — author this rule manually."

### 11.3 Ambiguity detection (deterministic checks in addition to LLM flags)

`FY_COMPLETION_UNSPECIFIED`, `CURRENCY_UNIT_UNCLEAR` (e.g. "10" with no unit), `PERIOD_UNSPECIFIED`, `MANDATORY_UNCLEAR` (no shall/must/mandatory wording), `EXEMPTION_REFERENCED_NOT_DEFINED` (mentions MSE/startup exemption without terms), `MULTIPLE_THRESHOLDS`, `EVIDENCE_TYPE_UNSPECIFIED`. A rule with unresolved ambiguities cannot be approved; the officer resolves each (choose an option or write a resolution), stored in the version.

### 11.4 Approval

Approve button enabled only when: schema valid, semantic valid, source clause present, all ambiguities resolved, `mandatory` set, weight set (if not mandatory-only), evidence types set. Approval records officer, timestamp, version; audit `RULE_APPROVED`. Bulk approve is **not** offered (prevents rubber-stamping); keyboard shortcut to move to next rule is fine.

### 11.5 Manual rule builder

A form-based editor producing the same DSL (never free-text code): choose template (Threshold on single value · Aggregate over FYs · Top-N aggregate · Count of qualifying projects · Document exists · Certificate valid on date · Field/entity match · Source verified · Compound AND/OR · Conditional exemption) → fill fields → live JSON preview (read-only) → live plain-English preview generated deterministically from the DSL (template renderer, not the LLM) → "Test against sample values" panel that runs the interpreter on typed inputs.

---

## 12. RULE DSL & INTERPRETER (closed language; `packages/rule-schema` + `engine.compliance`)

### 12.1 Rule envelope

```json
{
  "schema_version": "1.0",
  "rule_code": "R-07",
  "name": "Average annual turnover",
  "requirement_category": "FINANCIAL",
  "mandatory": true,
  "weight": 20,
  "envelope": "TECHNICAL",
  "on_missing_evidence": "REVIEW_REQUIRED",
  "allow_provisional": false,
  "evidence_types": ["CA_CERTIFICATE_TURNOVER", "PROFIT_AND_LOSS"],
  "min_verification": "DOCUMENT_SUPPORTED",
  "expression": { "...": "see 12.2" },
  "exemptions": [],
  "plain_english": "Average turnover over the last 3 completed financial years must be at least ₹10 Cr.",
  "source": { "document_id": "…", "clause_ref": "7.2", "page": 14, "quote": "…" },
  "ambiguities": []
}
```

### 12.2 Expression nodes (discriminated union on `node`)

Boolean nodes (evaluate to a Result):
- `{"node":"AND","args":[…]}`, `{"node":"OR","args":[…]}`, `{"node":"NOT","arg":…}`
- `{"node":"IF","cond":…,"then":…,"else":…}` (`else` optional → NOT_APPLICABLE)
- `{"node":"COMPARE","left":<Value>,"op":">=|>|<=|<|==|!=","right":<Value>}`
- `{"node":"DOCUMENT_EXISTS","doc_type":"BIS_CERTIFICATE","min_count":1}`
- `{"node":"DATE_VALIDITY","doc_type":"BIS_CERTIFICATE","valid_on":"REFERENCE_DATE|EVALUATION_DATE|<ISO date>","min_days_remaining":0}`
- `{"node":"FIELD_MATCH","field":"PAN","scope":"ALL_DOCUMENTS|DOC_TYPES","doc_types":[…]}` (uses reconciliation result)
- `{"node":"ENTITY_MATCH","entity":"LEGAL_NAME|ADDRESS","tolerance":"NORMALISED"}`
- `{"node":"SOURCE_VERIFIED","claim_type":"GSTIN","min_status":"AUTHORITATIVE_VERIFIED|RECONCILED|DOCUMENT_SUPPORTED"}`
- `{"node":"THRESHOLD_COUNT","series":<Series>,"op":">=","value":<Value>,"min_count":3}` (e.g. ≥3 projects each ≥ ₹X)
- `{"node":"CLAIM_TRUE","claim_type":"MSME_STATUS"}` (boolean claim, needs verification level ≥ rule's min_verification)
- `{"node":"TENDER_FLAG","flag":"allows_mse_exemption"}`

Value nodes:
- `{"node":"CONST","value":"100000000","unit":"INR|COUNT|PERCENT|DAYS|YEARS"}`
- `{"node":"AGG","fn":"SUM|AVERAGE|MIN|MAX|COUNT","series":<Series>}`
- `{"node":"RATIO","num":<Value>,"den":<Value>}`, `{"node":"PERCENTAGE","part":<Value>,"whole":<Value>}`
- `{"node":"FIELD","claim_type":"NET_WORTH","period":<Period>}` (single value)

Series nodes:
- `{"node":"SERIES","claim_type":"ANNUAL_TURNOVER","period":{"kind":"LAST_N_COMPLETED_FY","n":3}}`
- period kinds: `LAST_N_COMPLETED_FY {n}`, `FY_LIST {fys:[…]}`, `LAST_N_YEARS_FROM_REFERENCE {n}` (for project completion dates), `ALL`
- `{"node":"TOP_N","series":<Series>,"n":3,"order":"DESC"}`
- `{"node":"FILTER","series":<Series>,"op":">=","value":<Value>}`

Exemptions: `[{ "code":"MSE_EXPERIENCE_EXEMPTION", "when": <Boolean node>, "effect": "NOT_APPLICABLE|PASS", "requires_evidence": ["UDYAM_CERTIFICATE"], "min_verification": "RECONCILED" }]`. An exemption applies only if `when` evaluates PASS using verified evidence; typing "we are MSME" in a form never satisfies it.

### 12.3 Result semantics (three-valued logic; implement exactly and test every row)

Result lattice for unknowns: `PENDING_VERIFICATION` < `REVIEW_REQUIRED` (REVIEW_REQUIRED is "worse"/dominant). `BLOCKED` dominates all unknowns.

- **AND**: drop NOT_APPLICABLE args; if none left → NOT_APPLICABLE. If any FAIL → FAIL. Else if any BLOCKED → BLOCKED. Else if any REVIEW_REQUIRED → REVIEW_REQUIRED. Else if any PENDING_VERIFICATION → PENDING_VERIFICATION. Else PASS.
- **OR**: drop NOT_APPLICABLE; if none → NOT_APPLICABLE. If any PASS → PASS. Else if any BLOCKED → BLOCKED. Else if any REVIEW_REQUIRED → REVIEW_REQUIRED. Else if any PENDING → PENDING. Else FAIL.
- **NOT**: PASS↔FAIL; others unchanged.
- **IF**: cond PASS → then; cond FAIL → else (or NOT_APPLICABLE); cond unknown → that unknown.
- **COMPARE**: if either side is missing → `on_missing_evidence` (FAIL or REVIEW_REQUIRED); if any input evidence is CONFLICT → REVIEW_REQUIRED; if inputs are below `min_verification` but present → PENDING_VERIFICATION (if a verification route exists) else REVIEW_REQUIRED; else numeric comparison with Decimal.
- **AGG over series**: requires exactly the expected number of periods (e.g. 3 FYs). Missing period → missing evidence handling. Duplicate conflicting values for the same FY → REVIEW_REQUIRED (links both evidence items). AVERAGE rounds only for display (keep full precision; compare unrounded).
- **Exemption**: evaluated first; if an exemption applies, result = its effect and the trace records it.

### 12.4 Allowed claim types (field registry)

`PAN, GSTIN, CIN, LLPIN, UDYAM, LEGAL_NAME, REGISTERED_ADDRESS, ANNUAL_TURNOVER (per FY), NET_WORTH (per FY), PROFIT_AFTER_TAX (per FY), EXPERIENCE_PROJECT (value, client, completion_date, category), CERTIFICATE (type, number, issue, expiry), MSME_STATUS, STARTUP_STATUS, LOCAL_CONTENT_PERCENT, DECLARATION (kind, affirmed), EPFO_REGISTRATION, ESIC_REGISTRATION`. The registry (`engine/compliance/fields.py`, mirrored to JSON for the frontend) defines type, unit, periodicity and which document types can supply it.

### 12.5 Semantic validation (reject or send to review)

Schema valid · every claim_type in registry · operator allowed for type · units compatible (no INR vs COUNT comparison) · period defined for periodic fields · `mandatory` defined · source clause present · weight ≥ 0 · depth ≤ 8 and nodes ≤ 64 · no unknown keys (`additionalProperties: false` everywhere).

### 12.6 Interpreter

Pure function `evaluate(rule_version, bid_context, reference_date) -> RequirementResult` with no I/O. `bid_context` is a frozen snapshot (claims, evidence statuses, reconciliation results, tender flags). Returns result, earned weight, and a **trace tree**: each node with inputs (values + evidence IDs), operation, output. The trace powers the "View calculation" UI, e.g.:

```
SERIES ANNUAL_TURNOVER LAST_3_COMPLETED_FY (ref 2026-09-15) → FY2023-24: ₹12,00,00,000 [ev_101]; FY2024-25: ₹11,00,00,000 [ev_102]; FY2025-26: ₹13,00,00,000 [ev_103]
AGG AVERAGE → ₹12,00,00,000
COMPARE ₹12,00,00,000 >= ₹10,00,00,000 → PASS
```

Determinism: same inputs → byte-identical output (sorted keys, no timestamps inside the result). A property test runs each golden case twice and compares hashes. Record `engine_version` (git SHA + DSL version) in the run.

---

## 13. CLAIMS, EVIDENCE, RECONCILIATION, BIDDER PROFILE

### 13.1 Claim–evidence model

Every substantive assertion becomes a claim with evidence links; never store bare `GST = VALID`. Example:

```json
{ "claim_type": "GSTIN", "subject_org_id": "…", "value": "27AABCX1234F1Z5",
  "status": "RECONCILED", "verification_status": "AUTHORITATIVE_VERIFIED", "verification_method": "OFFICER_ASSISTED",
  "verified_at": "…", "valid_until": "…", "evidence": [{"document":"GST.pdf","page":1,"bbox":[…],"role":"SUPPORTS"}] }
```

### 13.2 Cross-document reconciliation (runs automatically after extraction, per bid and per bidder profile)

| Check | Logic | Outcome |
|---|---|---|
| PAN consistency | all PAN values across PAN card, ITR, GST certificate (chars 3–12 of GSTIN), CA certificate, Udyam | identical → CONSISTENT; differ → CONFLICT → `IDENTITY_CONFLICT` exception (severity HIGH, CRITICAL if PAN card vs ITR) |
| GSTIN ↔ PAN | GSTIN[2:12] == PAN | mismatch → IDENTITY_CONFLICT |
| GSTIN checksum/state | §10.1 | invalid → STRUCTURAL failure → REVIEW_REQUIRED |
| Legal name | normalise: lowercase, `private limited`↔`pvt ltd`↔`pvt. ltd.`, `limited`↔`ltd`, `&`↔`and`, strip punctuation/whitespace; then token-set similarity | equal after normalisation → NORMALISED_MATCH; similarity ≥ 0.9 → NORMALISED_MATCH with note; else FIELD_CONFLICT |
| Address | normalised string + PIN code; PIN must match | PIN mismatch → FIELD_CONFLICT (MEDIUM); fuzzy ≥ 0.85 → match |
| Turnover per FY | CA certificate vs P&L/balance sheet vs ITR | difference > 1% → `FINANCIAL_EVIDENCE_CONFLICT` (HIGH) |
| Certificate holder | holder name on BIS/ISO/OEM certificate vs legal name | mismatch → FIELD_CONFLICT |
| Dates | expiry < reference date → EXPIRED_EVIDENCE; expiry within 30 days → EXPIRING signal | — |

Each result stores the values with evidence IDs so the UI can show them side by side with character-level diff (e.g. `AABCX1234F` vs `AABCX1234P`, last character highlighted).

### 13.3 Bidder profile, verification levels, badge

Levels (never collapsed into one "trust score"):
- **Level 0 — Profile created**: organisation account exists.
- **Level 1 — Identity evidence verified**: PAN + legal name + (CIN/LLPIN/registration where applicable) + registered address reconciled with no open identity conflicts, and at least structural validity.
- **Level 2 — Statutory evidence verified**: applicable registrations (GSTIN, Udyam if claimed, EPFO/ESIC if claimed) at `RECONCILED` or higher, and GSTIN at `AUTHORITATIVE_VERIFIED` if any authoritative route (API or officer-assisted) exists.
- **Level 3 — Capability evidence verified**: financial, experience and certification evidence present, current and reconciled.
- **Level 4 — Tender readiness**: computed per tender (§13.5), not stored on the profile.

Badge "TenderSentry Verified" is shown at Level 2+. Tooltip/definition everywhere it appears: *"Evidence-backed identity and document verification completed within TenderSentry according to the applicable verification policy. This is a product status, not a legal certification or a guarantee of eligibility for any tender."*

Profile sections (bidder and government views): Identity · Organisation · Statutory evidence · Capability · Verification history · Procurement history (tenders participated, technical passes/failures, awards, withdrawals, clarifications, verification events — counts only, no commercial rating) · Review signals (count + list, each explainable).

### 13.4 Reusable evidence & freshness

Each vault item stores verified_at, source, method, valid_until, freshness policy, status. When a bidder prepares a bid, required evidence is pulled from the vault if `FRESH`/`EXPIRING` and applicable; `EXPIRED`/`REVERIFICATION_REQUIRED` items are flagged for action. On submission the used versions are snapshotted into `bid_versions.manifest` so later vault changes never alter a submitted bid.

### 13.5 Pre-bid readiness check (bidder side)

Compares the tender's approved rules with the bidder's vault evidence using the same interpreter in "preview" mode (results labelled "Preview — not an evaluation"). Output per requirement: ✓ available · ⚠ action needed (expiring, upload declaration, low confidence) · ✕ missing. Summary: "3 actions required before submission." Never words like "rejected" or "not eligible".

---

## 14. VERIFICATION ENGINE (Python `engine.verification` + API queue)

### 14.1 Router (auto-first)

For each claim needing verification (by rule `min_verification` or profile level policy):

```
Is an adapter with capability LIVE/VALIDATED available for this claim type? → AUTO (enqueue verification job)
else can the claim be reconciled from internal evidence (§13.2)? → EVIDENCE_RECONCILIATION (done automatically)
   and additionally, if the rule requires AUTHORITATIVE_VERIFIED and a human-operable official portal exists → HUMAN_REQUIRED (queue task)
else → UNAVAILABLE (status shown; exception SOURCE_UNAVAILABLE; never a positive result)
```

### 14.2 Adapter interface

```python
class VerificationAdapter(Protocol):
    code: str; supports: set[str]  # claim types
    def capability(self) -> Capability              # from config + last health check
    def health_check(self) -> HealthResult          # real call; records result
    def verify(self, claim: ClaimInput) -> NormalisedResult   # mode, outcome, normalised fields, raw_response(bytes), checked_at, valid_until
```

Raw responses are stored in object storage (hash recorded). Adapters never receive more data than the identifier being verified.

### 14.3 Adapters to implement in MVP

| Adapter | What it really does | Max status it can produce |
|---|---|---|
| `STRUCTURAL` (PAN, GSTIN, CIN, Udyam formats + GSTIN checksum) | local validation | STRUCTURALLY_VALID |
| `CROSS_DOCUMENT` | §13.2 reconciliation | RECONCILED |
| `PDF_SIGNATURE` | pyHanko: detects embedded signatures, checks document integrity since signing, signer certificate details, and chain trust against trust roots configured in `engine/verification/trust_roots/` (ship empty; admin can upload roots). Intact + trusted → SIGNATURE_VALID; intact but untrusted → SIGNATURE_UNTRUSTED (shown as "Signature intact; signer not validated against a configured trust root") | AUTHORITATIVE_VERIFIED only with trusted chain; otherwise DOCUMENT_SUPPORTED |
| `QR` | decodes QR codes on certificates; parses payload; if payload is signed data with a configured issuer key → verifies; if it is a URL on the source's allow-listed official domain → creates a human task with the link prefilled | AUTHORITATIVE_VERIFIED only for cryptographically verified payloads; otherwise feeds HUMAN task |
| `OFFICER_ASSISTED` (human queue) for GST, Udyam, PAN, MCA, EPFO, ESIC, BIS | officer uses the official public portal, records outcome + uploads captured artefact | AUTHORITATIVE_VERIFIED (mode OFFICER_ASSISTED) if artefact captured and outcome MATCH |
| `GST_PROVIDER_API` | HTTP client for an authorised GSP/provider (base URL + key from env); implements health check | AUTHORITATIVE_VERIFIED only when LIVE/VALIDATED |
| `DIGILOCKER` | OAuth flow scaffold per DigiLocker partner docs; disabled without credentials | INTEGRATION_READY |
| `SIMULATED` | deterministic fake responses for local testing | SIMULATED only; disabled in production |

Do not scrape portals, bypass CAPTCHAs, or automate OTP entry. The human queue is the boundary.

### 14.4 Human verification queue workflow

```
Task list (filters: source, bidder, tender, status, priority, assignee, age)
→ Start (status IN_PROGRESS, assigned to me, audit)
→ Task panel: claim + identifier with copy button, bidder, requirement, source, official portal link (opens new tab), instructions for that source
→ Officer performs lookup (CAPTCHA/OTP on the portal itself)
→ Record result: outcome (Match / No match / Not found / Source error), observed values (e.g. legal name, status, registration date as shown), upload capture (screenshot/PDF — required for Match), note
→ Save → verification_result (mode OFFICER_ASSISTED) → claim status updated → affected compliance re-run queued → audit
→ "Save and next" moves to the next queued task
```

Also: Assign, Retry (only if the source supports it), Mark unavailable (reason required; never positive), Open evidence, Add note. Task timeout (configurable, default 48h) → EXPIRED → re-queue.

### 14.5 Verification metrics (computed, never hand-entered)

Total tasks · auto-resolved · evidence-reconciled · human-assisted · unresolved · automation rate = auto-resolved / total. Shown on admin and tender dashboards with the date range they cover.

### 14.6 Source registry & capability status (honesty mechanism)

Status values: `LIVE_VALIDATED` · `INTEGRATION_READY` · `MANUAL_ONLY` (human queue) · `UNAVAILABLE` · `DISABLED` · `SIMULATED` (dev only).

`LIVE_VALIDATED` is **computed**: credentials configured AND the last health check (run by the system, stored in `verification_sources.last_health_result`) succeeded within `HEALTH_MAX_AGE_HOURS` (default 24). Admins cannot set it by hand; the admin UI offers "Run health check". Adapter code with no credentials → `INTEGRATION_READY`. Seed data: GST → INTEGRATION_READY + MANUAL_ONLY route; Udyam, PAN, MCA, EPFO, ESIC, BIS → MANUAL_ONLY; DigiLocker → INTEGRATION_READY; PDF_SIGNATURE, QR, STRUCTURAL, CROSS_DOCUMENT → LIVE_VALIDATED (local capabilities, health check = self-test).

The public Integrations page reads this registry live; no hard-coded "15 integrations" claims. Supabase itself is infrastructure, not a verification source, and is never listed as one.

---

## 15. COMPLIANCE, SCORE, RISK, EXCEPTIONS, DECISIONS

### 15.1 Compliance run

Triggered by: officer "Run evaluation", bid submission (after processing), verification update, clarification response, corrigendum approval (affected bids only). Steps: snapshot context → evaluate each ACTIVE rule version → mandatory gates → score → risk → exception sync → persist run atomically → notify. Runs are immutable; a new trigger creates a new run; the dashboard shows the latest run and a "Run history" with diffs.

### 15.2 Mandatory gates

All mandatory requirements must be PASS or NOT_APPLICABLE for gate PASS. Any FAIL → gate FAIL. Otherwise PENDING. A high score can never make a gate-failed bid appear qualified: the dashboard shows gate status before score, and sorts gate-failed bids with a "Mandatory gate failed" chip regardless of score.

### 15.3 Score

```
Compliance score = Σ weight(requirements with PASS) / Σ weight(applicable requirements) × 100
```
Applicable = result ≠ NOT_APPLICABLE. Requirements in REVIEW_REQUIRED/PENDING earn 0 and the score is marked **provisional** ("Provisional — 2 items pending"). Also show "maximum achievable if pending items pass". Weights are tender-configured on requirements (default: equal weights). Breakdown rows: requirement · weight · earned · result chip · link to trace. Score ≠ qualification; label copy: "Compliance score (decision support)".

### 15.4 Risk (separate from score)

Signals → severity; level = highest severity present (LOW if none).

| Signal | Severity |
|---|---|
| Mandatory gate failed | CRITICAL |
| PAN conflict between PAN card and ITR/GST | CRITICAL |
| Debarment evidence from an authoritative source applicable to the tender | CRITICAL |
| Other identity conflict (GSTIN↔PAN, legal name) | HIGH |
| Financial evidence conflict > 1% | HIGH |
| Mandatory certificate expired | HIGH |
| Verification failed (NO_MATCH) on a mandatory claim | HIGH |
| Verification unavailable for a mandatory claim | MEDIUM |
| Missing non-mandatory evidence | MEDIUM |
| Relationship signal (shared director/address/contact with another bidder on the same tender) | MEDIUM |
| Certificate expiring within 30 days | LOW |
| Low extraction confidence on a non-critical field | LOW |

Each signal shows: why, evidence links, source, timestamp. Relationship signals never auto-disqualify.

### 15.5 Debarment

No internal "blacklist". Debarment is evidence: an officer (or a future authoritative adapter) records a debarment evidence item with source (issuing authority, order reference, document upload), effective date, expiry, scope. Applicability to the tender is a rule (`CLAIM_TRUE` on `DEBARMENT_APPLICABLE` requires officer confirmation). Bidder self-declarations are claims of type DECLARATION.

### 15.6 Relationship signals (MVP in PostgreSQL)

On submission, compare the bidder's directors (name+DIN), normalised addresses, emails and phone numbers against other bidders on the same tender and (count only) historically. Matches create `RELATIONSHIP_SIGNAL` exceptions: "Shared director (DIN …) with another bidder on this tender". Government view shows the linked bidder only to users with `bid.view_technical` on that tender. Later: Neo4j + graph visualisation (Phase 10).

### 15.7 Exception engine

Categories: `MISSING_DOCUMENT, IDENTITY_CONFLICT, FIELD_CONFLICT, FINANCIAL_EVIDENCE_CONFLICT, VERIFICATION_PENDING, VERIFICATION_FAILED, SOURCE_UNAVAILABLE, EXPIRED_EVIDENCE, LOW_EXTRACTION_CONFIDENCE, RULE_AMBIGUITY, MANDATORY_GATE_FAILED, RELATIONSHIP_SIGNAL, DOCUMENT_UNREADABLE, INTEGRITY_FAILURE, DOCUMENT_TYPE_MISMATCH`.

Every non-normal state becomes exactly one exception (dedupe key = `category:bid:requirement:field`). If the underlying condition disappears after a re-run, the exception is auto-resolved with resolution "Condition no longer present in run CR-…" (audited, reopenable). Each exception has one clear next action (e.g. identity conflict → "Compare sources").

### 15.8 Officer actions, overrides, clarifications

- Decision actions (labels configurable per org via `decision_label_configs`): Technically compliant · Technically non-compliant · Needs clarification · Refer to committee · Record final decision. Require a note for non-compliant and final decision. Decision screen shows the compliance result, gates, score, risk, open exceptions, rules and the run ID being decided on. If open CRITICAL/HIGH exceptions exist, recording "Technically compliant" requires an explicit acknowledgement checkbox listing them.
- Override (any requirement result or exception outcome): modal requires new value, reason (min 20 chars), reference (optional document upload). Stored in `overrides`; original remains visible with strike-through + "Overridden by … on … — reason". Score/gates recompute using the override and show the "overridden" marker.
- Clarification: Exception → Request clarification (question, due date) → bidder notified → bidder submits response text and/or new document versions (only against the listed requirement) → new `bid_version` (reason CLARIFICATION) → audit → affected rules re-run. Originals never overwritten.

### 15.9 Two-envelope & financial security

- Documents and fields carry `envelope`. `FINANCIAL_BID` documents are stored but **not** processed by extraction/LLM until opened; only their hash and size are recorded at submission.
- Opening: allowed only when tender state = FINANCIAL_EVALUATION, for bids whose technical decision is "Technically compliant"; action by BUYER/APPROVING_AUTHORITY with confirmation; audit `FINANCIAL_ENVELOPE_OPENED` per bid.
- Every API returning bid data applies a serializer that strips financial fields unless `bid.view_financial` is satisfied. Tests assert a TECHNICAL_EVALUATOR never receives financial fields from any endpoint (including search and reports).
- **[Supabase]** Financial envelope files live in the `documents` bucket under a `financial/` prefix; no signed URL for them is issued before opening (the API check is the gate; the bucket is private).

### 15.10 Corrigendum & impact analysis

```
Active tender → Issue corrigendum → edit allowed fields (dates, thresholds, requirements, documents)
→ version++ (draft) → impact analysis → approval (APPROVING_AUTHORITY) → publish
```
Impact analysis lists: changed fields with old → new (e.g. "Turnover threshold ₹10 Cr → ₹8 Cr"), affected rules (new rule versions created with origin CORRIGENDUM, requiring approval), affected bids/evaluations ("3 open bidder evaluations will be re-run"). On publish: public page shows the corrigendum; bidders notified; affected compliance runs re-triggered with reason CORRIGENDUM.

### 15.11 Awards (vision)

MVP stops at recorded decisions and an "Evidence-backed evaluation package" report. Award workflow is Phase 10+: the authorised authority performs the award; the system never recommends a winner.

---

## 16. AUDIT TRAIL & INTEGRITY

- `audit_events` is append-only: **[Supabase]** `REVOKE UPDATE, DELETE, TRUNCATE` from `ts_app` (and from `anon`, `authenticated`, `service_role`) + a trigger raising an exception on UPDATE/DELETE. Only the owner role used for migrations could bypass this, and it is never used at runtime.
- Hash chain: `hash = sha256(prev_hash || canonical_json(event_without_hash))`, computed inside the insert transaction with a transaction-scoped advisory lock (`pg_advisory_xact_lock`) to serialise (safe through Supavisor transaction pooling). `GET /api/audit/verify-chain` (auditor/admin) re-computes and reports the first broken link. Nightly job runs it and alerts admins on failure.
- Events for: CREATE, EDIT, APPROVE, REJECT, PUBLISH, SUBMIT, VERIFY, OVERRIDE, RESOLVE, DECIDE, plus LOGIN/LOGOUT/LOGIN_FAILED/MFA, DOCUMENT_UPLOADED, DOCUMENT_ACCESSED, FINANCIAL_ENVELOPE_OPENED, ROLE_CHANGED, SOURCE_HEALTH_CHECK, EXPORT.
- Each event: who (actor, role, portal), what (action, entity, before/after), when, why (reason), which rule/document/evidence/verification/result/override (refs), IP, session, request ID.
- Documents: SHA-256 at upload; integrity check on every access and before every compliance run (mismatch → block + INTEGRITY_FAILURE). No blockchain.
- Audit timeline UI groups events by day and entity with filters (actor, action, entity, date).

## 17. NOTIFICATIONS

Channels: in-app (bell + `/notifications`) and email (SMTP). Triggers: tender deadline approaching (72h/24h), corrigendum published, verification task assigned, evidence expiring (30/7 days), bid submitted (bidder confirmation + officer), exception assigned, clarification requested/responded, officer action required (rule approval pending, decision pending), decision recorded, source health check failed (admin), audit chain failure (admin). Users can mute non-critical types. Email templates are plain, include no sensitive document contents, and link back into the app. (Supabase Auth's email templates are not used; all mail is sent by the API via SMTP.)

## 18. REPORTS, EXPORT, SEARCH

### 18.1 Compliance report (per bid) and evaluation package (per tender)

Generated asynchronously by the engine (reportlab), stored in the `reports` bucket with hash and data-snapshot hash, and listed with generation time. Sections: executive summary · tender information (ID, version, rule version set) · bidder information · requirement matrix (requirement, rule, result, evidence refs with document/page) · verification summary (source, mode, time) · calculations (trace excerpts) · exceptions and resolutions · overrides · compliance score + breakdown · risk + signals · officer notes · decision · audit timeline excerpt · footer: "Generated by TenderSentry on … from compliance run CR-…. Decision support only; decisions recorded by authorised officers." Formats: PDF, CSV (matrix), JSON (full). Every number in a report comes from stored run data.

### 18.2 Global search (`Search TenderSentry…`, Ctrl/Cmd+K)

Searches tender ID/title, bidder name, PAN, GSTIN, document ID, exception ID, rule ID, audit ID within the user's permissions (Postgres full-text + `pg_trgm`). Results grouped by type with counts ("Tenders (4) · Bids (8) · Documents (17) · Exceptions (2) · Verification records (13)"), each with "why it matched". PAN/GSTIN results are only returned to users who could open the underlying entity.

---

## 19. API SPECIFICATION (Express, `/api/v1`)

Write the OpenAPI 3.1 spec in `docs/api/openapi.yaml` as endpoints are built; generate the typed client into `packages/types`. All list endpoints support `?page, pageSize (≤100), sort, q` and return `{items, page, pageSize, total}`. All mutating endpoints validate bodies with zod, check permission + tenancy, write audit in the same transaction, and accept `Idempotency-Key` where noted (★).

**Auth**
`POST /auth/{government|bidder|admin}/login` · `POST /auth/mfa/verify` · `POST /auth/mfa/enrol` · `POST /auth/select-organisation` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` (user, orgs, roles, permissions, assignments) · `POST /auth/password/forgot` · `POST /auth/password/reset` · `POST /auth/invitations/:token/accept` · `POST /auth/register/bidder`

**Organisations & users**
`GET/PATCH /organisations/:id` · `GET/POST /organisations/:id/users` · `PATCH /organisations/:id/users/:userId` (roles, deactivate) · `GET/POST /tenders/:id/assignments`

**Public (no auth, rate-limited)**
`GET /public/tenders` · `GET /public/tenders/:publicId` · `GET /public/tenders/:publicId/documents/:docId` · `GET /public/sources` (integration registry, public fields only)

**Tenders**
`GET /tenders` · `POST /tenders` · `POST /tenders/import` (multipart) · `GET /tenders/:id` · `PATCH /tenders/:id` (draft only) · `POST /tenders/:id/documents` · `POST /tenders/:id/analyze` (clause extraction + rule compilation jobs) · `GET /tenders/:id/clauses` · `POST /tenders/:id/validate` (publication validation) · `POST /tenders/:id/submit-for-approval` · `POST /tenders/:id/approve-publication` · `POST /tenders/:id/publish`★ · `POST /tenders/:id/cancel` · `GET /tenders/:id/versions` · `POST /tenders/:id/corrigenda` · `GET /corrigenda/:id` · `POST /corrigenda/:id/impact` · `POST /corrigenda/:id/approve` · `POST /corrigenda/:id/publish`★ · `POST /tenders/:id/financial/open`★ (per bid list)

**Requirements & rules**
`GET /tenders/:id/requirements` · `POST /tenders/:id/requirements` (manual) · `PATCH /requirements/:id` (weight, mandatory, envelope) · `GET /tenders/:id/rules` · `GET /rules/:id` (with versions) · `POST /rules/:id/versions` (edit → new version) · `POST /rule-versions/:id/resolve-ambiguity` · `POST /rule-versions/:id/approve` · `POST /rule-versions/:id/reject` · `POST /rule-versions/:id/test` (dry-run on sample inputs) · `POST /rules/compile-preview` (clause text → candidate, no persistence)

**Bidder profile & vault**
`GET/PATCH /bidder/profile` · `GET /bidder/verification` (levels, tasks, expiring) · `GET /bidder/vault` · `POST /bidder/vault` (upload) · `POST /bidder/vault/:id/replace` · `GET /bidders/:orgId` (government view; only if related via a submitted bid)

**Bids**
`GET /bidder/tenders` (discovery; filters: q, category, location, organisation, closing date, value range, relevance, evidence available/missing) · `GET /bidder/tenders/:id` · `POST /bidder/tenders/:id/readiness` · `POST /bidder/tenders/:id/bids` (create draft) · `GET /bids/:id` · `PATCH /bids/:id` · `POST /bids/:id/documents` · `DELETE /bids/:id/documents/:docId` (draft only) · `POST /bids/:id/precheck` · `POST /bids/:id/submit`★ · `POST /bids/:id/withdraw`★ · `GET /tenders/:id/bids` (government) · `POST /tenders/:id/bids/import`★ (officer package import)

**Documents & evidence**
`POST /documents` (multipart; returns id + job id) · `GET /documents/:id` (metadata, status) · `GET /documents/:id/url` (signed URL; audited) · `GET /documents/:id/pages/:n` (text, words, image URL) · `GET /documents/:id/fields` · `GET /claims/:id` · `GET /claims/:id/evidence` · `GET /evidence/:id` · `GET /bids/:id/reconciliation`

**Verification**
`GET /verification/tasks` · `POST /verification/requests` (manual create)★ · `POST /verification/tasks/:id/start` · `POST /verification/tasks/:id/assign` · `POST /verification/tasks/:id/complete` (multipart with capture) · `POST /verification/tasks/:id/retry` · `POST /verification/tasks/:id/unavailable` · `GET /verification/metrics?tenderId=`

**Compliance & results**
`POST /compliance/run` ({bidId} or {tenderId}) · `GET /bids/:id/compliance` (latest run: results, gates, score, risk) · `GET /compliance/runs/:id` · `GET /compliance/runs/:id/diff/:otherId` · `GET /requirement-results/:id/trace` · `GET /tenders/:id/evaluation` (dashboard rows + aggregates)

**Exceptions, overrides, decisions, clarifications**
`GET /exceptions` (filters: tender, bid, category, severity, status, assignee) · `GET /exceptions/:id` · `POST /exceptions/:id/{assign|start|resolve|escalate|reopen}` · `POST /exceptions/:id/comments` · `POST /overrides`★ · `POST /decisions`★ · `GET /tenders/:id/decisions` · `POST /clarifications`★ · `POST /clarifications/:id/respond`★ (bidder)

**Reports, audit, search, notifications, jobs, events**
`POST /reports` ({type: BID_COMPLIANCE|TENDER_PACKAGE|EXCEPTIONS|VERIFICATION|AUDIT, entityId, format}) · `GET /reports/:id` · `GET /audit` (filters) · `GET /audit/:entityType/:entityId` · `GET /audit/verify-chain` · `GET /audit/export?format=csv|json` · `GET /search?q=` · `GET /notifications` · `POST /notifications/:id/read` · `GET /jobs/:id` · `GET /events/stream` (SSE: job progress, notification, run completed)

**Admin (SYSTEM_ADMIN)**
`GET /admin/health` (**[Supabase]** includes Postgres and Storage reachability) · `GET/POST /admin/organisations` · `GET/POST/PATCH /admin/users` (create, deactivate, reset MFA, assign role, change org, view/revoke sessions) · `GET /admin/sources` · `PATCH /admin/sources/:id` (config, enable/disable — not status) · `POST /admin/sources/:id/health-check` · `GET /admin/jobs` (+ retry dead job) · `GET/PATCH /admin/feature-flags` · `GET/PATCH /admin/settings` (retention policy, thresholds) · `GET /admin/audit`

**Engine (internal only, `X-Engine-Token`)**
`POST /engine/documents/process` · `POST /engine/tenders/segment` · `POST /engine/rules/compile` · `POST /engine/rules/validate` · `POST /engine/rules/render-english` · `POST /engine/compliance/evaluate` · `POST /engine/reconcile` · `POST /engine/verify/{adapter}` · `POST /engine/verify/{adapter}/health` · `POST /engine/reports/render` · `GET /engine/health`

---

## 20. FRONTEND — DESIGN SYSTEM

### 20.1 Direction

"Serious procurement infrastructure." Dense, calm, legible, desktop-first (officer work is document-heavy; min supported width for workspaces 1280px, responsive down to tablet; public site and bidder portal fully responsive to mobile). No gaming UI, no big gradients, no glassmorphism, no chatbot aesthetic, no decorative animation.

**Signature element — the provenance trail.** One component used everywhere a result appears: a horizontal, clickable chain `Result › Rule R-07 v2 › Claim › Evidence › ITR.pdf p.2 › Verification VT-45 › Calculation`. Each segment opens the corresponding side panel. This is the product's identity; keep everything around it quiet.

### 20.2 Tokens

| Token | Value | Use |
|---|---|---|
| `--ink` | `#15233B` | primary text, headings |
| `--ink-muted` | `#51607A` | secondary text |
| `--surface` | `#FFFFFF` | panels |
| `--canvas` | `#F3F5F8` | app background |
| `--rule` | `#D5DBE4` | borders, dividers |
| `--accent` | `#1F4E9A` (Ashoka-leaning blue) | primary actions, links, focus ring |
| `--pass` | `#1B7A4B` on `#E8F4EE` | VERIFIED / PASS |
| `--review` | `#946200` on `#FFF4DB` | REVIEW_REQUIRED / PENDING |
| `--fail` | `#B42318` on `#FDECEA` | FAIL / CONFLICT / CRITICAL |
| `--neutral` | `#5B6475` on `#EEF0F4` | NOT_APPLICABLE / UNAVAILABLE / INTEGRATION_READY |
| `--simulated` | `#6B3FA0` on `#F2ECF9` | SIMULATED (dev only) |

Type: **IBM Plex Sans** (UI, 14px base, 1.45 line-height; scale 12/14/16/20/24/32) and **IBM Plex Mono** only for identifiers and amounts where character-level comparison matters (PAN, GSTIN, CIN, hashes, IDs). Sentence case everywhere; no all-caps labels except status chips. Tabular numerals for all numbers. Radius 6px on controls, 8px on panels; hairline borders instead of heavy shadows.

### 20.3 Status chip system (readable without colour)

`✓ Verified` · `✓ Pass` · `○ Pending` · `⚠ Review required` · `✕ Fail` · `≠ Conflict` · `⌛ Expired` · `— Not applicable` · `⊘ Unavailable` · `◇ Integration ready` · `● Live` · `⚗ Simulated`. Each chip: icon + text + colour + `aria-label`; tooltip explains meaning and method (e.g. "Verified via officer-assisted check on GST portal, 27 Sep 2026 10:32, by R. Sharma").

### 20.4 Core components (`packages/ui`)

AppShell (top bar with org switcher, global search, notifications, user menu; left nav by portal/permissions) · DataTable (sortable, filter chips, column visibility, sticky header, keyboard navigation, CSV export of visible rows when permitted) · StatusChip · ProvenanceTrail · SidePanel (right-hand, stackable) · DocumentViewer (pdf.js pages, zoom, rotate, page thumbnails, bbox highlight overlays with labels, jump-to-evidence, side-by-side compare mode) · ValueDiff (character-level diff for identifiers) · CalculationTrace (tree view of interpreter trace) · RuleDslView (read-only structured rendering) · RuleBuilder · Timeline (audit) · ExceptionCard · ScoreBreakdown (clickable rows) · RiskSignalsList · JobProgress (real job status from SSE) · EmptyState · ErrorState (maps error codes → copy + action) · ConfirmDialog (typed confirmation for irreversible actions) · ReasonDialog (min-length reason) · FileDropzone (type/size validation, hashing progress) · Stepper (onboarding, tender creation) · KeyValueGrid · DemoBanner.

### 20.5 Mandatory UI states on every data view

Loading (skeletons for tables; step text for jobs: "Uploading…", "Processing document…", "Extracting fields…", "Building evidence…", "Compiling rules…", "Running compliance checks…" — driven by real job status, never timers) · Empty (instructional: "All current verification tasks are complete.") · Error (what happened + how to fix + retry if `retryable`) · Permission denied · Not found. Never show a fabricated instant result while a job is running.

### 20.6 Explanation pattern ("Why?")

Every score, risk level, chip and exception has a "Why?" affordance showing: reason in one sentence, evidence links (document + page), source, timestamp, and recommended next action. Example: "PAN differs across 2 documents. PAN.pdf p.1 shows AABCX1234F; ITR.pdf p.2 shows AABCX1234P. Recommended: compare the two sources." Never "The AI thinks…".

---

## 21. FRONTEND — ROUTES & SCREENS

### 21.1 Route map

```
Public:   /  /how-it-works  /for-government  /for-bidders  /security  /integrations  /about
          /tenders  /tenders/:publicId  /login  /login/government  /login/bidder  /login/admin
          /register/bidder  /forgot-password  /reset-password  /invite/:token
Government: /government/dashboard  /government/tenders  /government/tenders/new  /government/tenders/import
          /government/tenders/:id (tabs: overview | documents | requirements | rules | bids | evaluation | corrigenda | decisions | audit)
          /government/tenders/:id/rules/:ruleId
          /government/tenders/:id/evaluation
          /government/tenders/:id/bids/:bidId (tabs: overview | requirements | evidence | verification | identity | financial | relationships | clarifications | audit)
          /government/tenders/:id/bids/:bidId/workbench?req=&claim=&doc=&page=
          /government/tenders/:id/corrigenda/new  /government/tenders/:id/corrigenda/:cid
          /government/verification  /government/exceptions  /government/exceptions/:id
          /government/reports  /government/audit  /government/organisation  /government/notifications
Bidder:   /bidder/dashboard  /bidder/profile  /bidder/verification  /bidder/documents (evidence vault)
          /bidder/tenders  /bidder/tenders/:id  /bidder/bids  /bidder/bids/:id  /bidder/history
          /bidder/notifications  /bidder/settings
Admin:    /admin/dashboard  /admin/organisations  /admin/users  /admin/sources  /admin/integrations
          /admin/jobs  /admin/feature-flags  /admin/settings  /admin/audit
```

Route guards check `GET /auth/me` permissions; the API remains the enforcement point.

### 21.2 Government screens

**Dashboard** — Top row cards (each clickable to a filtered list): Active tenders · Bids under review · Verification queue (mine / all) · Critical exceptions. Middle: compliance distribution per active tender (stacked bar of gate status), verification status (auto / reconciled / human / unresolved counts), deadline timeline (next 30 days). Bottom: recent activity (audit feed, my tenders) and critical cases list. Primary buttons: `+ Create tender`, `Import tender`, `Open verification queue`, `View exceptions`, `Generate report`. Maximum ~6 widgets; no chart clutter.

**Tender list** — search; filters: status, deadline, department, category, assigned to me. Columns: Tender ID · Title · Status · Bids · Deadline · Verification pending · Open exceptions · Assigned officers. Row actions: Open · Corrigendum · View bids · Open evaluation · View audit.

**Create tender** (stepper): 1 Procurement requirement (title, category, department, quantity, delivery location, estimated value + "show value publicly", required date, procurement objective, procurement mode single/two-envelope, dates) → 2 Documents (upload tender PDF + annexures) → 3 Requirements & rules (runs analysis; opens rule review) → 4 Required bidder documents (checklist derived from rules' evidence types, editable) → 5 Evaluation (weights per requirement, reference date policy, decision labels preview) → 6 Validate & send for approval. Buttons: Save draft · Preview public page · Validate · Send for approval · Cancel. **Publication validation** checks and lists: required fields present, dates valid and ordered (open < deadline < opening), at least one document, every requirement has an APPROVED rule, weights valid, mandatory flags set, no unresolved ambiguities, no contradictory rules (same claim type with incompatible thresholds), evaluation criteria defined. Each failure links to the fix.

**Import tender** (evaluation-only mode) — upload tender PDF + metadata; creates tender in DRAFT with `externally_published=true`; analysis runs; after rules are approved, the officer imports bidder packages.

**Tender overview** — header (ID, title, status chip, version, deadline countdown), progress stepper (rules approved x/y · bids received · processed · verified · evaluated · decided), key actions by state.

**Rule review (three-pane)** — the critical screen. Left list of requirements with status chips (AI extracted / review required / approved / rejected) and ambiguity count. Main three panes: *Source clause* (clause text with page/clause ref; "Open in document" shows the tender PDF with the clause highlighted) · *Interpretation* (plain English; ambiguity questions with options that must be answered) · *Structured rule* (RuleDslView; mandatory toggle; weight; evidence types; on-missing-evidence; "Test with sample values"). Actions: Approve (guarded §11.4) · Edit (opens RuleBuilder; reason required; creates version) · Reject (reason) · Flag ambiguity · Next rule. Version history drawer: V1 AI-generated → V2 officer edited → V3 corrigendum, each with diff. Banner when AI unavailable.

**Bids tab** — list of bids with state, submitted at, source (portal/import), processing status. Button: Import bidder package (upload multiple files, map to bidder org created on the fly with legal name/PAN).

**Evaluation dashboard (multi-bidder)** — summary strip: total bids · technical review · verification pending · open exceptions · decisions recorded. Filter chips: All · Mandatory failed · Review required · Verification pending · Identity conflict · Missing evidence · Expired evidence · High risk · Critical · Low risk · Human action required · Unresolved. Table: Bidder · Mandatory gates (x/y, chip) · Compliance score (provisional marker) · Risk (chip + top signal) · Review items · Verification (auto/human/pending counts) · Exceptions · Decision status. Actions: Run evaluation (all) · Compare bidders (requirement × bidder matrix view with chips) · Export matrix · Open bidder. Default sort: risk (highest first), then score (highest first); the gate column is always visible and gate-failed rows carry a "Mandatory gate failed" chip whatever their score.

**Bidder detail (government view)** — header: legal name, PAN (mono), TenderSentry verification level, gate status, score, risk. Summary: requirements total · passed · failed · review · pending verification. Tabs:
- Overview: score breakdown (clickable), risk signals with Why?, open exceptions, latest run ID + run history.
- Requirements: table of requirement results with trace link; Override action.
- Evidence: all claims with status progression and evidence links.
- Verification: requests/tasks/results with mode and capture.
- Identity: reconciliation table (PAN, GSTIN, CIN, legal name, address) with ValueDiff.
- Financial: technical-envelope financial evidence (turnover, net worth); financial bid shown only if opened and permitted, otherwise "Sealed until financial opening".
- Relationships: relationship signals list (graph view later).
- Clarifications: requests and responses with versions.
- Audit: timeline filtered to this bid.
Actions: Record decision · Request clarification · Generate report · Open workbench.

**Evidence Workbench** (three panes, the strongest explainability screen) — Left: documents in the bid grouped by type, each with processing status and hash-verified tick; below, claims list filterable by requirement. Centre: DocumentViewer with highlighted evidence boxes (colour by role: supports / conflicts); compare mode opens two documents side by side (used for PAN conflict). Right: details of the selected item: claim, value (raw + normalised), extraction method + confidence, source document/page/coordinates, verification (mode, source, time, capture link), linked requirement results, calculation trace. ProvenanceTrail across the top. Actions: Open source A / Open source B · Assign review · Add note · Resolve conflict (reason) · Escalate · Request clarification · Verify (routes to adapter or creates a queue task).

**Verification queue** — tabs: Human required · Automatic (history) · Unresolved · All. Columns: Task · Bidder · Tender · Requirement · Claim · Source · Mode · Priority · Status · Assigned to · Age · Last attempt. Actions: Start · Assign · Retry · Open evidence · Mark unavailable · Resolve · Add note. Task panel as §14.4 with "Save and next". Metrics strip (§14.5).

**Exceptions workspace** — counts by severity (Critical · High · Medium · Low) as filter chips; filters by category, tender, status, assignee. Exception detail: issue, affected bidder, requirement, evidence (with viewer), source, history (timeline), assigned officer, comments. Actions: Assign · Start review · Resolve (note) · Request clarification · Escalate · Add note · Reopen.

**Decisions** — per bid decision form (§15.8) and tender-level decision log.

**Corrigendum** — edit allowed fields, see impact analysis, send for approval, publish.

**Reports** — generate/download compliance reports and tender evaluation packages; list with generator/time/hash.

**Audit** — timeline with filters (actor, action, entity, tender, bidder, document, date), event detail drawer (before/after JSON diff), chain verification status, export (CSV/JSON/PDF per permission).

**Organisation** (ORG_ADMIN) — org profile, users, roles, tender assignments, decision label configuration.

### 21.3 Bidder screens

**Dashboard** — cards: verification status (level + badge) · open opportunities (relevant to profile) · draft bids · submitted bids · expiring evidence · review/clarification requests. Primary: Complete profile · Discover tenders.

**Organisation profile** — legal identity, identifiers, addresses, authorised persons, directors, contacts; Edit · Submit for verification.

**Verification centre** — the persistent procurement profile (§13.3): each section with items and chips (✓ PAN · ✓ CIN · ✓ GST · ○ EPFO …), levels progress, actions required (upload, replace, re-verify), verification history. Badge with definition tooltip.

**Evidence vault** (`/bidder/documents`) — documents by type with validity, freshness, verification status, versions; Upload · Replace (creates version) · View · Download.

**Tender discovery** — search (keyword, category, location, organisation, closing date, estimated value, verification requirements); filters: Open · Closing soon · Relevant to my profile · Required evidence available · Evidence missing. Cards show deadline, organisation, value (if public), readiness hint.

**Tender detail** — overview, technical requirements, eligibility (plain-English rules), required documents, important dates, corrigenda (with "changed since you started your bid" banner), evaluation structure (weights, envelopes). Buttons: Check my tender readiness · Prepare bid · Download tender.

**Bid workspace** — left: requirements with chips; right: mapped documents per requirement (from vault or new upload; per-document processing status); bottom: compliance preview ("82% ready · 2 issues require action", clearly labelled preview) with Run check. Envelope sections: Technical documents · Financial bid (amount + document; note "Sealed until the buyer's financial opening"). Autosave draft.

**Pre-submission check** — documents present · fields complete · required evidence available · evidence fresh · technical conditions satisfied (preview) · declarations complete → PASS or ACTION REQUIRED with links. Never auto-submits.

**Submit** — confirmation dialog with declaration text "I confirm that the information and documents submitted are accurate and authorised for this bid." checkbox → Confirm submission (idempotent). Result screen: SUBMITTED · timestamp · submission ID · manifest with document hashes (downloadable receipt PDF).

**My bids / bid detail** — status timeline (state machine), clarification requests (respond with text + new document versions), withdraw (before deadline, reason), results when published by the buyer.

**Procurement history** — counts and list (participations, technical outcomes, awards, withdrawals, clarifications, verification events).

### 21.4 Admin screens

Dashboard (system health: API, engine, **Supabase Postgres, Supabase Storage**, Redis, SMTP, queue depths, failed jobs; audit chain status) · Organisations (create government org + invite ORG_ADMIN; view bidder orgs; suspend) · Users (create, deactivate, reset MFA, assign role, change org, sessions) · Verification sources (registry table: source, domain, method, environment, status (computed), last test, credential status, adapter version, notes; actions: Run health check, Enable/Disable, Edit config — secrets write-only, never displayed) · Integrations (per adapter: status, environment, last successful call, failure rate, adapter version) · AI & document jobs monitor (per queue: completed/failed/pending, rule compilations requiring review, retry dead jobs, job detail with error) · Feature flags · Settings (retention policy per data class — configurable, no hard-coded deletion; thresholds: expiring days, confidence, financial conflict %) · Audit (search by user, tender, bidder, document, action, date; export). Admin can never edit procurement results.

### 21.5 Public website

Shared public layout (header: Tenders · How it works · For government · For bidders · Security · Integrations · About · Sign in ▾ (Government / Bidder); footer with the non-claims statement).

| Page | Content | CTA |
|---|---|---|
| Home | Hero leads with the provenance trail itself: an animated-once example that walks a PASS result back to "ITR.pdf, page 2" (one orchestrated motion; respects reduced-motion). Then: the problem (evidence preparation around the officer's decision), the core line, the chain, "What TenderSentry is / is not", the four-part principle. | Sign in · Request a demo (mailto/form stored in DB) |
| How it works | Tender → rules → evidence → verification → deterministic evaluation → exceptions → officer decision, one section each, with real screenshots of the app (generated from the seeded demo by Playwright). | Explore public tenders |
| For government | Officer workflow, rule approval, evidence workbench, audit, two-envelope handling. | Government sign in |
| For bidders | Profile, evidence vault, readiness check, submission receipts. | Register as a bidder |
| Security | Tenancy isolation, encryption, MFA, audit chain, minimum-necessary AI data, honest integrations. | Contact |
| Integrations | Live table from `/public/sources` with statuses and their definitions. | — |
| About | Product/team; the "what we don't claim" list. | Contact |
| Public tenders | List (search, category, organisation, closing soon) and detail: title, organisation, category, published date, bid deadline, permitted public value, eligibility summary (plain English from approved rules), documents, corrigenda, clarifications. Buttons: Download tender · View corrigendum · View eligibility · Sign in to participate. Never shows bidder names, evidence, evaluation data or financials. | — |

Public pages must contain **no numeric performance claims** unless sourced from the benchmark report with its date (§23.4). Footer copy: "TenderSentry is decision support. Final procurement decisions are made by authorised officers. TenderSentry is not affiliated with or a replacement for GeM unless an official integration is announced."

---

## 22. DEMO DATA & SEED (deterministic)

`pnpm seed` (and automatically on first `pnpm stack:up` when `DEMO_MODE=true`) resets and loads the demo into the Supabase database and Storage buckets. All data is **synthetic**; every generated PDF carries a light diagonal watermark "SYNTHETIC DEMO DOCUMENT" and fictitious identifiers. Never use real people's or companies' data. **[Supabase]** The seed refuses to run against a project whose `APP_ENV` is `production`, and requires `--confirm-reset` when the target is a hosted project.

### 22.1 Organisations & users (password for all demo users: `Demo@TenderSentry2026`, OTP `000000` in demo mode)

- Government: **Department of Public Works (Demo)** — `buyer@demo.gov.test` (BUYER, ORG_ADMIN), `evaluator@demo.gov.test` (TECHNICAL_EVALUATOR, VERIFIER), `finance@demo.gov.test` (FINANCIAL_EVALUATOR), `authority@demo.gov.test` (APPROVING_AUTHORITY), `committee@demo.gov.test` (COMMITTEE_MEMBER), `auditor@demo.gov.test` (AUDITOR).
- A second government org **State Health Mission (Demo)** with one buyer and one tender — used to prove tenancy isolation in tests and demo.
- Platform: `admin@tendersentry.test` (SYSTEM_ADMIN).
- Bidders (each with `admin@<slug>.test` BIDDER_ADMIN):

| Bidder | Scenario | Expected outcome on the demo tender |
|---|---|---|
| ABC Engineering Pvt Ltd | All evidence valid and consistent; GSTIN verified via officer-assisted task (pre-completed with capture) | Gates 5/5 PASS, score 100, risk LOW |
| XYZ Infrastructure Ltd | PAN on PAN card `AABCX1234F` vs ITR page 2 `AABCX1234P` | Gate PAN consistency → REVIEW_REQUIRED, risk CRITICAL, IDENTITY_CONFLICT exception |
| PQR Technologies Ltd | BIS certificate missing | Mandatory gate FAIL, risk CRITICAL, MISSING_DOCUMENT exception, score < 100 |
| DEF Constructions Ltd | ISO certificate expired; turnover FY values ₹8.5/9.1/9.8 Cr | Turnover FAIL (avg ₹9.13 Cr < ₹10 Cr), EXPIRED_EVIDENCE, risk HIGH/CRITICAL |
| LMN Services LLP | CA certificate turnover FY2024-25 ₹11.2 Cr vs P&L ₹9.2 Cr | FINANCIAL_EVIDENCE_CONFLICT, turnover REVIEW_REQUIRED, risk HIGH |
| RST Micro Works (Udyam MSE) | MSE with valid Udyam certificate; lacks 3 prior projects; tender allows MSE experience exemption | Experience NOT_APPLICABLE via exemption (trace shows it), risk LOW |
| UVW Traders | Scanned (image-only) GST certificate → OCR path; shares a director (same DIN) with XYZ | OCR extraction with confidence shown; RELATIONSHIP_SIGNAL (MEDIUM) |
| GHI Systems Pvt Ltd | Document submitted with an embedded digital signature (self-signed demo cert) | Signature intact, "signer not validated against a configured trust root" |

Seed also creates one extra bidder with a draft (unsubmitted) bid to demonstrate the bidder workspace and readiness check, and a pending verification task for XYZ's GSTIN (human-only) to demonstrate the queue.

### 22.2 Demo tender

"Supply, installation and commissioning of solar street-lighting systems" — `TEN-2026-0001`, two-envelope, bid deadline 15 Sep 2026 (so FY2023-24, FY2024-25, FY2025-26 are the last three completed FYs), state TECHNICAL_EVALUATION, generated tender PDF (~16 pages) with clauses including:

1. 7.1 Valid GST registration (mandatory, weight 15) → `SOURCE_VERIFIED GSTIN ≥ RECONCILED` AND `FIELD_MATCH PAN`
2. 7.2 Average annual turnover of last three completed financial years ≥ ₹10 crore (mandatory, weight 20)
3. 7.3 At least three similar completed works each ≥ ₹2 crore in the last 7 years (weight 20) with MSE exemption per clause 7.9
4. 7.4 Valid BIS certificate for luminaires (mandatory, weight 15) → DOCUMENT_EXISTS + DATE_VALIDITY on reference date
5. 7.5 Valid ISO 9001 certificate (weight 10)
6. 7.6 Declaration of not being debarred (mandatory, weight 10)
7. 7.7 Identity consistency: PAN consistent across submitted documents (mandatory, weight 10)
8. 7.8 Net worth positive in the latest completed FY (weight 10)
9. 7.9 MSE exemption clause
10. 7.10 — one deliberately ambiguous clause: "The bidder should have turnover in last three financial years" (no "completed", no threshold unit clarity) → shows ambiguity flags in rule review.

Pre-seeded rule candidates are stored with origin `SEEDED` (labelled "Seeded candidate — not AI-generated" in the UI) so the demo works without an LLM key; when a key is configured, "Re-run AI extraction" produces genuine AI candidates labelled as such. Rules for 7.1–7.8 are seeded APPROVED by the buyer (with audit events); 7.10's ambiguous clause is left in REVIEW_REQUIRED for the live demo of approval.

A second tender in `DRAFT` (for creating/publishing live) and one `OPEN_FOR_BIDS` tender (for bidder discovery and submission) are also seeded. The State Health Mission tender is only visible to its own org.

### 22.3 Synthetic document generator (`database/seeds/docgen/`, Python + reportlab)

Generates per bidder: PAN-card-like page, GST REG-06-like certificate, Udyam-like certificate (with a QR code containing a JSON payload), certificate of incorporation, ITR acknowledgement pages (PAN on page 2), CA turnover certificate with an FY table, P&L summary, experience/completion certificates, BIS and ISO certificates with dates, declarations, authorisation letter; one image-only scan variant (rasterised at 200 DPI with slight rotation and noise) for UVW; one signed PDF for GHI (pyHanko with a generated self-signed key). Records expected field values and bboxes in `golden/expected/*.json` for tests. Output is deterministic (fixed seeds, fixed dates).

---

## 23. TESTING & QUALITY

### 23.1 Unit tests (minimum)

- Identity: same PAN → CONSISTENT; different PAN → REVIEW_REQUIRED (IDENTITY_CONFLICT); invalid PAN → INVALID; PAN type char; GSTIN valid/invalid format, valid/invalid checksum, GSTIN↔PAN mismatch; CIN/Udyam formats.
- Normalisation: every money format in §10.2; FY labels and AY conversion; last-N-completed-FY across reference dates (31 Mar, 1 Apr, mid-year); legal-name and address normalisation cases.
- Financial: AVERAGE, SUM, MIN, MAX, TOP_N, COUNT, RATIO, PERCENTAGE, THRESHOLD_COUNT, FILTER; Decimal precision; missing year; duplicate conflicting year.
- Logic: full truth tables for AND/OR/NOT/IF across all result values including NOT_APPLICABLE and BLOCKED.
- Dates: valid, expired, expiring, future-dated issue.
- DSL validation: every rejection reason in §12.5; malformed LLM JSON; fenced JSON; unknown keys.
- Verification: `AUTHORITATIVE_VERIFIED` unreachable from SIMULATED/STRUCTURAL/CROSS_DOCUMENT; LIVE_VALIDATED computed only from health check.
- Scoring/gates/risk: gate fail with score 95 still FAIL; provisional scoring; risk level = max severity.
- Audit: chain verification detects a tampered row; UPDATE/DELETE blocked.
- Authorization: the full permission matrix (§6.3), cross-tenant 404s, financial-field stripping on every bid-returning endpoint.
- **[Supabase]** Exposure lock-down: connecting as `anon` and `authenticated`, every app table is unreadable and unwritable; `ts_app` cannot UPDATE/DELETE `audit_events`.

### 23.2 Integration & e2e

- Integration: tender + rule + bidder + documents + evidence + verification + compliance produces one complete run with a full trace.
- Playwright e2e (run against the seeded stack): government login with MFA → approve ambiguous rule → run evaluation → filter Review required → open XYZ → workbench compare shows both PAN highlights → complete human verification task with capture → record decision → audit shows every step; bidder flow: register → onboarding → upload evidence → readiness check → prepare bid → pre-check → submit → receipt with hashes; tenancy: State Health Mission buyer cannot open TEN-2026-0001 URLs (404); technical evaluator sees "Sealed" on financial tab.
- Idempotency: double-click submit/decision creates exactly one record.
- **[Supabase]** Integration tests run against the Supabase CLI local stack (CI starts it with `supabase start`, excluding unneeded services).

### 23.3 Golden dataset

`services/engine/golden/`: for each seeded bidder and each rule, the expected result, score, gate status, risk level and exception categories. CI runs the full pipeline on the synthetic documents and diffs against expectations; any change fails CI unless the golden files are updated in the same PR with a reason.

### 23.4 Benchmark scripts (produce the only numbers the product may show)

`services/engine/bench/`:
- `clause_eval.py` — given 15–20 public historical tenders placed by the team in `bench/tenders/` with hand-labelled ground truth (`bench/labels/*.json`): precision, recall, rule-interpretation accuracy, officer-correction rate.
- `extraction_eval.py` — field accuracy (PAN, GSTIN, turnover, dates), evidence-location accuracy (IoU ≥ 0.5), conflict-detection rate on injected discrepancies.
- `compliance_eval.py` — expected vs actual results on labelled cases (target 100%, deterministic).
- `verification_metrics.py` — from real task data: totals by route, automation rate.
- `workload.py` — baseline manual action count (from a documented checklist) vs TenderSentry actions logged in audit.
Each writes `bench/results/<date>.json` + a markdown report. Only these outputs may be quoted, with dates. Until run, the UI/marketing shows no metrics.

### 23.5 Performance targets (measure and log; not marketing claims)

Track p50/p95 for: PDF processing per page (native, OCR), LLM latency, rule evaluation per bid, evaluation dashboard API, verification task duration, report generation. Targets: dashboard API < 500 ms p95 for 50 bids; rule evaluation < 200 ms per bid; native-text document < 3 s for 20 pages.

### 23.6 Observability

pino structured logs with request IDs propagated API → worker → engine; job table as in §4.4; `/admin/jobs` shows failure reasons and retries; health endpoints for every service; optional OpenTelemetry exporter behind env. Supabase dashboard logs/query performance are used for DB-side diagnosis.

---

## 24. SECURITY CHECKLIST

HTTPS everywhere (Caddy auto-TLS; Supabase connections over TLS with `sslmode=require` in hosted environments) · secure cookies + CSRF · MFA · argon2id · rate limiting on auth, public and upload endpoints · helmet headers + strict CSP (no inline scripts) · server-side RBAC + tenancy on every route (tests) · organisation isolation in every query · **[Supabase]** Data API closed: RLS enabled with no policies on all app tables, all privileges revoked from `anon`/`authenticated`, `service_role` key held only server-side (and not required at runtime), anon key never shipped to the browser · **[Supabase]** runtime role `ts_app` separate from the owner role; database password rotated per environment; network restrictions enabled on hosted projects where available · private buckets + short-lived signed URLs + audited access · Storage encrypted at rest by Supabase; Postgres at-rest encryption by Supabase; `mfa_secret` and provider credentials encrypted with an app key (AES-GCM, key from env/secret manager) · file validation (extension allow-list: pdf, png, jpg, jpeg; MIME sniff; max size; page cap 300; reject encrypted PDFs) and ClamAV when configured · PDF processing in the engine container with CPU/memory limits and timeouts · input validation (zod/pydantic) everywhere · no secrets in git (`.env` ignored, gitleaks in CI) · dependency scanning (npm audit / pip-audit in CI) · minimum-necessary LLM data (§2 rule 16) with a unit test asserting the compile-rule payload contains only clause/context/schema · configurable retention per data class (no hard-coded deletion) · backups: Supabase managed backups (PITR for production) + nightly `pg_dump` + Storage export, documented restore procedure tested once · admin actions audited; admin cannot alter procurement results.

---

## 25. DEPLOYMENT [Supabase]

### 25.1 Local

Prerequisites: Docker, Node 20 + pnpm, Supabase CLI.

1. `supabase start` — runs the Supabase local stack (Postgres on :54322, API gateway/Storage on :54321, Studio on :54323, Mailpit on :54324). Storage buckets (`documents`, `captures`, `reports`, `page-images`) are declared private in `supabase/config.toml`.
2. `pnpm db:migrate` — Prisma migrations over `DIRECT_URL` (creates the schema, `ts_app` role, grants, RLS lock-down, triggers).
3. `docker compose up --build` — starts `web` (Vite build served by Caddy on :8080), `api`, `worker`, `engine` (with tesseract-ocr, tesseract-ocr-hin, libzbar0, poppler-utils) and `redis`, connecting to the Supabase stack through `host.docker.internal`.
4. If `DEMO_MODE=true`, the API's first boot runs the seed.

`pnpm stack:up` wraps steps 1–4; `pnpm stack:down` stops both. A `make dev` / `pnpm dev` target runs web/api with hot reload against the same infrastructure.

### 25.2 Production / demo deployment (documented in `docs/deployment.md`, tested once end-to-end)

Primary path: a **hosted Supabase project** per environment (region `ap-south-1` Mumbai for data residency preference) providing Postgres and Storage, plus a single Linux VM (e.g. 4 vCPU / 8 GB, same region) running `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` for web/Caddy, api, worker, engine and Redis. Caddy serves a real domain with automatic HTTPS. Steps: create project → set database password → create Storage buckets (private) and S3 access keys → set `DATABASE_URL` (pooler, transaction mode, `ts_app`) and `DIRECT_URL` (session/direct, `postgres`) → `pnpm db:migrate` → set the `ts_app` password (migration creates the role without one; `scripts/set-app-role-password.sql`) → disable Supabase Auth sign-ups → enable network restrictions → deploy containers. Include: health checks, restart policies, log rotation, `scripts/backup.sh`, `scripts/restore.sh`, and a zero-downtime-ish update procedure (pull → migrate → restart api/worker/engine).

Alternative documented path: frontend on a static host, API/worker/engine as containers on a container platform, hosted Supabase for Postgres/Storage, managed Redis. Keep all configuration env-driven so either works.

Production guards at boot: `APP_ENV=production` forces `DEMO_MODE=false`, `SIMULATED_ADAPTER_ENABLED=false`, requires non-default secrets, HTTPS base URL, SMTP configured, and TLS on the database connection.

### 25.3 CI (GitHub Actions)

Lint + typecheck (TS, ruff, mypy) → unit tests (web, api, engine) → build images → `supabase start` (CLI) → migrate + seed → Supabase exposure lock-down test → golden dataset → compose up → Playwright e2e → gitleaks, npm audit, pip-audit.

---

## 26. WORDING & COPY GUIDE (UI, emails, reports, marketing)

| Never say | Say instead |
|---|---|
| Fraud detected / suspicious | Identity conflict · Evidence conflict · Review required |
| Collusion confirmed | Relationship signal |
| AI recommends winner / AI decided | Evidence-backed evaluation prepared for the authorised officer |
| Government-certified company / allowed to bid everywhere | TenderSentry Verified (with definition) |
| Verified (for a simulated or structural check) | Format valid · Consistent across documents · Simulated — not a government verification |
| We automate government portals | Automatic-first verification with source adapters and a managed queue for human-only steps |
| Zero fraud | Moves fraud prevention upstream |
| Verified forever | Verification is time-bound, source-linked and subject to re-verification |
| Rejected (to bidders during readiness) | Action required before submission |
| "95% accuracy", "80% less work" (unmeasured) | No number, or the dated benchmark result |
| Integrated with 15 government portals | The live registry with honest statuses |

Buttons use verbs that say what happens, and the same verb carries through to confirmations and toasts ("Approve rule" → "Rule R-07 v2 approved").

---

## 27. BUILD PHASES & ACCEPTANCE CRITERIA

### 27.1 Phases (strict order)

| Phase | Build | Acceptance (all must pass) |
|---|---|---|
| **0 Foundation** | Monorepo, **Supabase CLI local stack + `supabase/config.toml`**, docker compose (app services + Redis), Prisma schema on Supabase Postgres (all §7 tables, can be refined), `ts_app` role + RLS lock-down, Supabase Storage buckets, engine skeleton, auth (3 entries, MFA, sessions), orgs, roles, RBAC middleware, tenancy repository layer, audit service with hash chain, app shells for 3 portals + public layout, design tokens/components, CI | Login for each demo portal with MFA; wrong-portal login fails; permission tests for implemented routes; audit chain verify passes; `anon`/`authenticated` cannot read any app table; `pnpm stack:up` on clean clone works |
| **1 Walking skeleton** | Document upload → hash → Supabase Storage → engine native-text extraction → PAN/GSTIN regex → claims/evidence with page+bbox → reconciliation of 2 documents → CONSISTENT / REVIEW_REQUIRED shown in a basic viewer with highlights | Upload two synthetic PDFs with matching/mismatching PAN and see the correct outcome with highlighted boxes |
| **2 Tender & rules** | Tender create/import, clause segmentation, LLM compiler with schema validation + repair, ambiguity checks, manual rule builder, plain-English renderer, three-pane rule review, approve/edit/reject, versioning, publication validation, publish, public tender pages | Rule module "done" list §27.3 |
| **3 Bidder & documents** | Bidder registration/onboarding, profile, vault, OCR path, classification, full field extraction (§10), tables/turnover, QR decoding, discovery, readiness, bid workspace, pre-check, submission with manifest hashes, officer package import | Evidence module "done" list §27.3; bidder e2e passes |
| **4 Compliance** | Interpreter (full DSL + three-valued logic), calculations, exemptions, mandatory gates, score, risk, exception engine, compliance runs with snapshots, triggers | Compliance "done" list; golden dataset passes; determinism test passes |
| **5 Verification** | Router, structural, cross-document, PDF signature, QR, officer-assisted queue with capture, GST provider adapter (INTEGRATION_READY without keys), simulated adapter (dev only), source registry + health checks, metrics | Verification "done" list; no path yields AUTHORITATIVE_VERIFIED from simulated/structural |
| **6 Officer UX** | Government dashboard, evaluation dashboard with filters, compare view, bidder detail tabs, Evidence Workbench with compare mode and provenance trail, exceptions workspace, decisions, overrides, clarifications | Dashboard "done" list; officer e2e passes |
| **7 Audit & reports** | Audit timeline UI, chain verification UI, exports, compliance report + tender package PDF/CSV/JSON, notifications (in-app + email), global search | Audit "done" list; reports contain only stored data |
| **8 Two-envelope & corrigendum** | Financial envelope sealing/opening, serializer stripping, corrigendum with impact analysis and re-runs | Financial leakage tests pass; corrigendum e2e passes |
| **9 Admin, polish, deploy** | Admin panel (all §21.4), feature flags, settings, public marketing pages with real screenshots, all loading/empty/error states, accessibility pass (keyboard, focus, contrast AA, aria on chips), security checklist, production deployment on hosted Supabase | §27.4 final checklist 100% |
| **10+ Later** | Tender Co-Pilot, policy warnings, Neo4j relationship graph + visualisation, live adapters as credentials arrive, award workflow, analytics, SSO, pgvector | Each behind a feature flag; core golden tests still pass |

### 27.2 Definition of done (every feature)

UI + API + database + validation + error handling + loading/empty states + permission check (server) + audit event + tests — all present where applicable, and reachable from navigation.

### 27.3 Module "done" lists

- **Rules**: AI clause extraction works (or manual path without key) · Rule JSON schema exists and is shared · invalid rules rejected · officer can edit/approve/reject · ambiguities must be resolved · version stored · source page stored · only approved rules execute · audit events created.
- **Evidence**: upload → processing → field extraction → page reference → coordinates → claim → evidence → viewer highlight → audit.
- **Verification**: claim → route decision → automatic / reconciliation / queue → result → source → timestamp → status → evidence (capture) → honest capability flags.
- **Compliance**: approved rule + evidence → deterministic evaluation → PASS/FAIL/REVIEW/PENDING/NA → gates → score (clickable breakdown) → risk (explained) → trace.
- **Dashboard**: multiple bidders visible · score, risk, gate, verification status visible · exceptions filterable · bidder drill-down · evidence drill-down.
- **Audit**: who, what, when, why, which rule, which document, which evidence, which verification, which result, which override — reconstructible for any decision; "Why did this bidder receive 86?" answerable from a stored run.

### 27.4 Final checklist (release gate)

- [ ] Three login entries + MFA; role-aware routing; officer cannot reach bidder screens and vice versa (server-enforced)
- [ ] Tender upload stores original + hash; parsing creates source-linked candidates
- [ ] Rules cannot execute until approved; edits create versions + audit
- [ ] Bidder documents isolated by organisation/tender; cross-tenant access returns 404
- [ ] Supabase Data API exposes no app data (`anon`/`authenticated` lock-down test passes against the hosted project)
- [ ] OCR fallback works for scanned PDFs; extracted fields keep page/coordinates
- [ ] Cross-document conflicts visible with side-by-side highlights
- [ ] Every verification source has a computed capability status; unavailable sources never produce positive verification
- [ ] Human-only tasks enter the queue and capture evidence
- [ ] Compliance calculations deterministic (golden + repeat-hash tests)
- [ ] Mandatory gates cannot be overridden by score; overrides require reason and are visible
- [ ] Score breakdown clickable; risk explained; exceptions have clear statuses and next actions
- [ ] Every result traces to evidence via the provenance trail
- [ ] Audit trail captures all critical mutations; chain verification passes
- [ ] Financial envelope sealed until authorised opening; no leakage in any endpoint, search or report
- [ ] Reports reflect stored data only
- [ ] All integrations configuration-driven; no secrets in git
- [ ] Loading/empty/error states on every major screen
- [ ] Seed reproduces the complete demo; production deployment on hosted Supabase documented and performed once
- [ ] No forbidden wording (§26) anywhere (add a CI grep for the forbidden terms in `apps/web/src` and templates)
- [ ] No unmeasured numbers anywhere

---

## 28. DEMO SCRIPT (what the seeded system must support, in order)

1. **Tender** — Government login (buyer) → TEN-2026-0001 → Rules: open the ambiguous clause → three panes show source, interpretation, flags → resolve "completed FYs" and unit → approve → version history shows V1 seeded/AI → V2 officer edited.
2. **Bidders** — Bids tab shows 8 submitted bids processed; (optional live) import one extra package and watch real job progress.
3. **Evidence conflict** — Evaluation → filter "Identity conflict" → XYZ → Workbench compare: PAN.pdf p.1 `AABCX1234F` vs ITR.pdf p.2 `AABCX1234P`, last character highlighted → status Review required → Assign review / Add note.
4. **Verification** — Verification queue → XYZ GSTIN human task → Start → open official portal link → record result with capture → claim updates → run re-evaluated; show ABC's already-verified task with capture; show a signature check (GHI) and the Integrations page honest statuses.
5. **Deterministic finance** — ABC turnover → View calculation: ₹12 Cr, ₹11 Cr, ₹13 Cr → average ₹12 Cr ≥ ₹10 Cr → PASS; DEF shows FAIL with ₹9.13 Cr; RST shows exemption applied.
6. **Dashboard** — all bidders with gates, score, risk; filter Critical, then Review required, then Human action required.
7. **Traceability** — click ABC's score 100 → requirement → rule → claim → document → page → evidence → verification → calculation.
8. **Decision** — record decisions (compliant for ABC; clarification for XYZ; non-compliant for PQR with note) → generate compliance report → audit timeline shows the full history; chain verified.
9. **Bidder side** (optional) — bidder login → readiness check on the open tender → "3 actions required before submission".
Closing line: "AI understands. Python verifies. Evidence proves. The officer decides."

---

## 29. EDGE CASES THE IMPLEMENTATION MUST HANDLE

Scanned PDF with no text · rotated/low-quality pages · encrypted or corrupt PDF · tables spanning pages · financial years written inconsistently (FY/AY/short forms) · company-name spelling variants that are the same entity · PAN/GSTIN/CIN mismatch · duplicate document upload · expired certificate · CA certificate vs financial statement conflict · corrigendum changes a threshold after bids exist (new rule version, re-run, both runs retained) · officer edits a rule after evaluations exist (same) · verification source down (UNAVAILABLE, retry, no fabricated result) · human task timeout · bidder replaces a document after submission (only via clarification → new bid version) · same bidder in multiple tenders (vault reuse, per-bid snapshots) · one document supports several requirements · one requirement needs several documents · exemption applicable only under specific tender flags · mandatory requirement missing while score is high · LLM returns malformed JSON / times out / is disabled · amounts in lakh vs crore columns · two values for the same FY in one document · document declared as one type but classified as another · submission at the exact deadline second (server time, deadline inclusive rule documented) · double-clicked submit/decision · user belonging to two organisations · deactivated user's historical actions still displayed with their name · audit chain verification on large tables (batched) · very large bid packages (per-file 25 MB, per-bid 300 MB, streaming uploads) · **[Supabase]** pooler connection limits reached (API returns `DB_UNAVAILABLE`, retryable) · Supabase free-tier project paused (health check reports it; documented in deployment) · Storage upload size limit configured on the project ≥ `FILE_MAX_MB`.

---

## 30. GLOSSARY

**Claim** — an assertion about a bidder (e.g. "FY2024-25 turnover is ₹11 Cr"). **Evidence** — a located piece of a document or a verification response supporting or contradicting a claim. **Verification** — checking a claim against a source; has a mode and a time. **Reconciliation** — comparing the same fact across documents. **Rule** — an officer-approved, versioned DSL expression for a requirement. **Compliance run** — an immutable evaluation of all active rules for one bid version at one time. **Mandatory gate** — requirements that must all pass regardless of score. **Risk** — severity/review-priority signals, separate from score. **Exception** — any non-normal state needing attention. **Provenance trail** — the clickable chain from a result back to its sources.

---

*End of specification. Build the vertical slice first; every later feature plugs into it.*
