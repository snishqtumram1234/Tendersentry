# TenderSentry 🛡️

> Evidence-first, AI-assisted compliance verification and decision-support platform for government procurement (GeM ecosystem).

---

## 📌 Overview

**TenderSentry** is designed to bring transparency, determinism, and explainability to government tender evaluations. It converts unstructured tender clauses into officer-approved structured rules (closed JSON DSL), processes bidder documents, extracts verifiable claims with page/bounding-box provenance, evaluates compliance deterministically, surfaces signals and discrepancies, and records every step in an immutable, tamper-evident audit trail.

---

## 🏗️ Architecture & Technology Stack

```
                     ┌──────────────────────────────┐
                     │          apps/web            │
                     │  (React 18 + Vite + TS)      │
                     └──────────────┬───────────────┘
                                    │ HTTP / REST
                     ┌──────────────▼──────────────┐
                     │          apps/api           │
                     │  (Express + TS + Prisma)     │
                     └───────┬──────────────┬──────┘
                             │              │
       ┌─────────────────────┼──────────────┼─────────────────────┐
       │                     │              │                     │
┌──────▼───────┐     ┌───────▼──────┐ ┌─────▼───────┐     ┌───────▼──────┐
│  PostgreSQL  │     │  Supabase S3 │ │  FastAPI    │     │   BullMQ     │
│ (Supabase DB)│     │   Storage    │ │ (services/  │     │   Worker     │
└──────────────┘     └──────────────┘ │   engine)   │     │  (Redis)     │
                                      └─────────────┘     └──────────────┘
```

- **Frontend (`apps/web`)**: React 18, TypeScript, Vite, Vanilla CSS design tokens.
- **Backend API (`apps/api`)**: Node.js, Express, TypeScript, Prisma ORM, Argon2id & TOTP authentication.
- **Python Verification & Extraction Engine (`services/engine`)**: Python 3.12, FastAPI, PyPDF/OCR, closed DSL rule compiler & interpreter, deterministic compliance evaluation.
- **Background Worker (`apps/worker`)**: BullMQ backed by Redis for asynchronous document ingestion and rule execution.
- **Database & Storage**: PostgreSQL & S3-compatible object storage via Supabase.

---

## 🚀 Quick Start & Development

### Prerequisites

- Node.js (v20+) & [pnpm](https://pnpm.io/) (`corepack enable pnpm`)
- Python 3.12+ & `venv` / `uv`
- [Docker & Docker Compose](https://www.docker.com/)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### 1. Environment Setup

Copy `.env.example` to `.env` and fill in necessary configuration:
```bash
cp .env.example .env
```

### 2. Install Dependencies

```bash
pnpm install
```

For the Python engine:
```bash
cd services/engine
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cd ../..
```

### 3. Local Infrastructure & Database

```bash
# Start local Supabase services
supabase start

# Run database migrations
pnpm db:migrate

# Seed demo data
pnpm seed
```

### 4. Running the Development Stack

#### Option A: Docker Compose (All services)
```bash
docker compose up --build
```
- Web: [http://localhost:8080](http://localhost:8080)
- API: [http://localhost:3000](http://localhost:3000)
- Engine: [http://localhost:8000](http://localhost:8000)

#### Option B: Standalone Hot Reload
```bash
# Terminal 1: Web + API
pnpm dev

# Terminal 2: Python Engine
cd services/engine
uvicorn engine.main:app --reload --port 8000
```

---

## 🧪 Testing

```bash
# Run unit tests across all packages
pnpm test

# Run API integration tests (requires Supabase DB running)
pnpm --filter api test:int

# Run Python Engine tests
cd services/engine && pytest

# Run end-to-end tests (Playwright)
pnpm e2e
```

---

## 📖 Documentation

- [Build Specification](docs/BUILD_SPEC.md) - Complete design requirements and rules
- [Architecture Decisions (ADRs)](docs/DECISIONS.md) - Key architectural choices and rationale
- [Progress Tracker](docs/PROGRESS.md) - Implementation status and milestones
- [Deployment Guide](docs/deployment.md) - Production deployment guidelines

---

## ⚖️ License

Private & Proprietary. All rights reserved.
