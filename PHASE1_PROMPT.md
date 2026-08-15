# PHASE 1 PROMPT — Repo Scaffold & Foundations

You are building **Phase 1 of 14** of a verified hyperlocal skilled-services marketplace (internal codename: `fixbridge`). Nothing exists yet — you are starting from an empty directory.

---

## Context (read carefully before writing any code)

**Product in one paragraph:** A two-sided marketplace connecting customers with verified skilled technicians (electricians, plumbers, motor rewinding, genset techs, mechanics, AC/appliance repair). Customer shares location → sees nearby verified technicians ranked by distance/rating/badge → books a slot → OTP handshake at job start/end → itemized digital quotation approved in-app → UPI or logged cash payment → two-way ratings. Launch city: Jabalpur, M.P. → then India.

**How we work across phases:**
- This project is built in 14 sequential phases. Each phase arrives as a single prompt like this one.
- **Scope discipline:** implement ONLY what this prompt asks. If you notice something a future phase needs, note it in the phase summary — do NOT build it now.
- **Never build big-scale infrastructure for pilot traffic.** Modular monolith, one Postgres, one Redis. No Kafka, no microservices, no Kubernetes.
- Every phase must leave the repo runnable: `docker compose up` + `npm run start:dev` must work, migrations must run cleanly on a fresh database.
- Tests are part of the phase, not optional.

**Frozen technical decisions (do not revisit):**

| Decision | Choice |
|---|---|
| Backend | Express + TypeScript, modular monolith. One folder per domain module, each with `routes.ts`, `service.ts`, `repository.ts`, `types.ts`, `*.test.ts`. Zod for request validation. No NestJS, no decorators. |
| ORM | **Prisma** (decided for this project). PostGIS columns handled via raw SQL migrations + `$queryRaw` where needed (future phases). |
| Primary DB | PostgreSQL 16 + PostGIS (one database) |
| Cache/locks | Redis |
| Events | Transactional outbox pattern in Postgres + in-process dispatcher (future phase builds it; do not build now) |
| Money | Integers (paise), always |
| Identity | Phone number is identity; OTP login + JWT (Phase 2 — not now) |
| Multi-city | `city_id` on relevant tables from day one |
| i18n | All user-facing strings via i18n keys (hi + en) from day one |
| Brand | **Brand name is NOT decided.** Never hardcode any brand name anywhere. Use a single `APP_NAME` config constant (default: `"fixbridge"`) read from env. This applies to package names, logs, API responses, docs, everything. |

---

## Phase 1 scope — what to build NOW

### 1. Monorepo layout
```
fixbridge/
├── apps/
│   ├── api/          # Express + TypeScript backend (the real work this phase)
│   ├── admin/        # placeholder dir with README only (Phase 11)
│   └── mobile/       # placeholder dir with README only (Phases 12–13)
├── packages/
│   └── shared/       # shared types/constants (minimal now: APP_NAME type, common types placeholder)
├── docs/
│   ├── API.md        # endpoint list, updated every phase (starts with /health)
│   └── summaries/    # phase summaries live here
├── docker-compose.yml
├── package.json      # npm workspaces root
└── README.md
```
Use **npm workspaces** (not pnpm/yarn/turborepo — keep tooling minimal).

### 2. `apps/api` skeleton
- Express 4 + TypeScript (strict mode), structured as domain modules. Create **stub folders** for: `auth`, `customers`, `providers`, `verification`, `search`, `bookings`, `quotations`, `payments`, `reviews`, `notifications`, `admin`. Each stub contains `routes.ts` (empty router exported), `service.ts`, `repository.ts`, `types.ts` — with a one-line comment saying which phase fills it. No business logic yet.
- A `core/` (or `lib/`) area with:
  - **Config/env management:** typed config loader (Zod-validated `process.env`), `.env.example` committed, `.env` gitignored. Includes `APP_NAME`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `NODE_ENV`, `LOG_LEVEL`.
  - **Structured logging:** pino (JSON logs, pretty in dev). Request-ID middleware (accept `X-Request-Id` or generate UUID) attached to every log line.
  - **Global error handling:** central error middleware; a small `AppError` class (statusCode, code, message, optional details); Zod validation errors → 400 with field details; unknown errors → 500 with request-id, no stack leak in production.
  - **i18n scaffold:** tiny i18n utility + `locales/hi.json` and `locales/en.json` with 2–3 sample keys (e.g., `errors.internal`, `health.ok`). Language from `Accept-Language` header, default `hi`.
- **Health endpoint:** `GET /health` → `{ status: "ok", app: <APP_NAME>, version, uptime, checks: { postgres: ok/fail, redis: ok/fail } }` — actually pings both.
- Redis client (ioredis) wired with connect/retry logging.
- Graceful shutdown (SIGTERM/SIGINT → close server, Prisma, Redis).

### 3. Database & migrations
- Prisma set up against Postgres 16.
- **First migration must enable PostGIS:** a raw SQL migration with `CREATE EXTENSION IF NOT EXISTS postgis;` (and `pg_trgm` for future search: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`).
- One real table this phase: `cities` (`id`, `name`, `state`, `is_active`, `created_at`). Seed **Jabalpur, Madhya Pradesh** as city 1.
- Seed script skeleton: `npm run seed` (idempotent — safe to run twice).

### 4. Docker Compose
- Services: `postgres` (image with PostGIS, e.g. `postgis/postgis:16-3.4`), `redis:7-alpine`. Volumes for persistence, healthchecks on both, ports mapped for local dev. API runs on host via `npm run start:dev` (no API container needed this phase).

### 5. Tooling
- ESLint + Prettier (flat config, TypeScript rules), `npm run lint`, `npm run format:check`.
- **Vitest** for tests. This phase's tests: config loader validation, error middleware behavior, i18n utility, and an integration test for `/health` (spins against the compose services; skip gracefully with a clear message if DB/Redis are unreachable).
- `npm run test`, `npm run build` (tsc), `npm run start:dev` (tsx watch or ts-node-dev).
- GitHub Actions CI stub: `.github/workflows/ci.yml` — on push/PR: install, lint, build, unit tests (integration tests can be excluded from CI this phase or run with service containers — your call, document it).
- `.gitignore`, `.nvmrc` (Node 20 LTS), root README with quickstart (clone → compose up → migrate → seed → start:dev → curl /health).

---

## Explicitly OUT of scope this phase (do not build)
Auth/OTP/JWT · any domain business logic · outbox table/dispatcher · object storage/MinIO · Razorpay · messaging adapters · admin UI · Flutter · OpenAPI/Swagger generation · rate limiting · anything from a later phase. Noting them in the summary is welcome; building them is a scope violation.

---

## Done criteria (all must pass)
1. Fresh clone → `docker compose up -d` → `npm install` → migrate → `npm run seed` → `npm run start:dev` → `curl localhost:PORT/health` returns ok with both checks green.
2. `npm run lint`, `npm run build`, `npm run test` all pass.
3. CI workflow is green on the initial commit.
4. Migrations run cleanly on a completely fresh database (verify by dropping the volume and re-running).
5. No brand name hardcoded anywhere — grep for it; only `APP_NAME` config is allowed.

## Final deliverable of the phase
Write `docs/summaries/phase01-summary.md` in exactly this six-point format:
- **Goal** — what this phase was supposed to achieve
- **What was built** — files, modules, endpoints, migrations
- **Key decisions & deviations** — anything decided or changed vs. this prompt, with reasons (include: exact Prisma version, Node version, any library choices you made)
- **Assumptions & missing inputs** — what was assumed, what is needed from Ankit
- **Verification results** — tests run, what passed, working curl examples
- **Next steps** — what Phase 2 (Identity & Auth: OTP login, JWT, roles) should pick up
