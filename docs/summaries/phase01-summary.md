# Phase 01 — Repo Scaffold & Foundations

**Date:** 2026-08-15 · **Phase 1 of 14**

---

## Goal

Turn an empty directory into a runnable, tested, CI-checked foundation for the
marketplace: an npm-workspaces monorepo with an Express + TypeScript modular
monolith, typed config, structured logging, central error handling, an i18n
scaffold (hi + en), a real `/health` endpoint that pings Postgres and Redis,
Prisma migrations that enable PostGIS on a fresh database, a seeded `cities`
table with Jabalpur as city 1, and Docker Compose infrastructure — with no
domain logic and no brand name anywhere.

---

## What was built

### Repository layout

```
.
├── apps/
│   ├── api/            Express + TypeScript modular monolith
│   ├── admin/          README only (Phase 11)
│   └── mobile/         README only (Phases 12–13)
├── packages/shared/    shared types + constants
├── docs/
│   ├── API.md
│   └── summaries/phase01-summary.md
├── .github/workflows/ci.yml
├── docker-compose.yml
├── eslint.config.mjs · .prettierrc.json · .prettierignore
├── tsconfig.base.json · .nvmrc · .gitignore
├── package.json        npm workspaces root
└── README.md
```

### `packages/shared`

`src/index.ts` — `DEFAULT_APP_NAME`, `AppName`, `SUPPORTED_LOCALES` / `Locale` /
`DEFAULT_LOCALE`, `Paise` / `Money` / `PAISE_PER_RUPEE`, `ApiErrorBody` /
`ApiFieldError`, `HealthResponse` / `CheckStatus`, `City` / `CityId`,
`IsoTimestamp`. Built with `tsc`; a `prepare` script means `npm install` alone
leaves it consumable.

### `apps/api/src/core`

| File | What it does |
|---|---|
| `config.ts` | Zod-validated `process.env` → frozen typed config. Pure `parseConfig(env)` plus a memoised `loadConfig()`. Loads `apps/api/.env` via dotenv without ever overriding a real env var. `ConfigValidationError` lists **every** bad field at once and points at `.env.example`. |
| `logger.ts` | pino factory. JSON everywhere, `pino-pretty` only when `NODE_ENV=development`. `base` carries `app`/`env` from config — no brand literal. Redacts `authorization`, `cookie`, `*.password`, `*.otp`, `*.token`. |
| `errors.ts` | `AppError(statusCode, code, message, { details, messageKey, cause })` + `isAppError`, with `badRequest`/`unauthorized`/`forbidden`/`notFound`/`conflict`/`internal` helpers. |
| `i18n.ts` | `resolveLocale` (q-value aware, region subtags stripped, `*` → default), `translate`, `createTranslator`. Falls back locale → default locale → the key itself. `{{var}}` interpolation. |
| `locales/hi.json`, `locales/en.json` | `health.ok`, `health.degraded`, `errors.internal`, `errors.notFound`, `errors.validation`, `errors.unavailable`, `common.greeting`. |
| `prisma.ts` | `PrismaClient` factory; `warn`/`error` events piped into pino. |
| `redis.ts` | ioredis factory with connect/ready/end/error logging and a capped retry strategy (gives up after 10 attempts so a dead Redis cannot pin the process open). |
| `context.ts` | `AppContext` (config, logger, prisma, redis, version), `createContext`, `getContext(req)`, `disposeContext`. |
| `version.ts` | Reads the API `package.json` version at startup. |
| `shutdown.ts` | SIGTERM/SIGINT/`unhandledRejection`/`uncaughtException` → drain HTTP, disconnect Prisma + Redis, forced exit after `SHUTDOWN_TIMEOUT_MS`. Re-entrancy guarded. |
| `middleware/request-id.ts` | Accepts `X-Request-Id` matching `[A-Za-z0-9._:-]{1,128}`, else mints a UUID v4. Echoes it and binds `req.log = logger.child({ requestId })`. |
| `middleware/locale.ts` | Sets `req.locale`, `req.t`, and the `Content-Language` response header. |
| `middleware/request-logger.ts` | One structured line per completed request with method/path/status/durationMs. |
| `middleware/not-found.ts` | Unmatched route → `AppError` 404 through the same envelope. |
| `middleware/error-handler.ts` | `ZodError` → 400 + per-field details · `AppError` → its own status/code, localised when it carries a `messageKey` · anything else → 500 with a generic localised message. Every response carries `requestId`; stacks only when `NODE_ENV !== production`. |

`src/types/express.d.ts` augments `Express.Request` with `requestId`, `log`,
`locale`, `t`.

### Modules

`src/modules/health/` is the only module with behaviour: `routes.ts` +
`service.ts` (+ two test files).

Eleven stub modules — `auth`, `customers`, `providers`, `verification`,
`search`, `bookings`, `quotations`, `payments`, `reviews`, `notifications`,
`admin` — each with `routes.ts` (empty `Router`), `service.ts`, `repository.ts`,
`types.ts`, every file opening with a one-line comment naming its phase. All are
mounted under `/api/v1/<module>` by `src/modules/index.ts`.

### Endpoints

| Method | Path | Status |
|---|---|---|
| `GET` | `/health` | Live. 200 when both checks pass, 503 when either fails. |
| — | `/api/v1/{auth,customers,providers,verification,search,bookings,quotations,payments,reviews,notifications,admin}` | Mounted, empty. |

### Migrations

| Migration | Contents |
|---|---|
| `20260815000000_enable_extensions` | Hand-written raw SQL: `CREATE EXTENSION IF NOT EXISTS postgis;` and `pg_trgm`. Runs first. |
| `20260815101931_create_cities` | Prisma-generated from `schema.prisma`: `cities(id serial PK, name varchar(120), state varchar(120), is_active bool default true, created_at timestamptz(3) default now())`, unique `(name, state)`, index on `is_active`. |

`prisma/seed.ts` upserts on the `(name, state)` natural key — idempotent.

### Infrastructure & tooling

- `docker-compose.yml` — `postgis/postgis:16-3.4` + `redis:7-alpine`, named
  volumes, healthchecks on both, ports and credentials env-overridable. No API
  container this phase.
- ESLint 9 flat config + Prettier, both passing across the whole repo.
- Vitest, 5 test files / 51 tests.
- `.github/workflows/ci.yml` — two jobs (details below).

---

## Key decisions & deviations

### Exact versions

| | Version |
|---|---|
| Node (local dev, verified) | **v20.12.2**; `.nvmrc` pins major **20** |
| npm | 9.8.1 |
| **Prisma CLI + `@prisma/client`** | **6.19.3** |
| TypeScript | 5.9.3 |
| Express | 4.22.2 |
| Vitest | 3.2.7 |
| Zod | 4.4.3 |
| pino / pino-pretty | 9.14.0 / 13.1.3 |
| ioredis | 5.11.1 |
| dotenv | 16.6.1 |
| tsx | 4.23.12 |
| supertest | 7.2.2 |
| ESLint / typescript-eslint / Prettier | 9.39.5 / 8.67.0 / 3.9.6 |
| PostGIS (from the image) | 3.4.3 · pg_trgm 1.6 |

All dependencies are **pinned exactly** (no `^`) so every machine and CI run
resolves identically; `package-lock.json` is committed.

### Decisions

1. **Repo root is this directory, not a nested `fixbridge/` folder.** The prompt's
   tree shows `fixbridge/` as the repo root; making it a subfolder would have put
   `PHASE1_PROMPT.md` outside the repo. Everything below the root matches the
   prompt exactly.
2. **Prisma 6, not 7.** Prisma 7.9.1 is current but is a major rewrite
   (mandatory generator `output`, config-file migration). Phase 1 is not the
   place to absorb that; 6.19.3 is stable and matches the frozen "Prisma"
   decision. Upgrade deliberately in a later phase.
3. **CommonJS, not ESM** (`module: CommonJS`, `moduleResolution: Node`). Avoids
   `.js`-suffixed import specifiers and ESM/CJS interop friction across Prisma,
   pino and supertest for zero benefit at this stage.
4. **Express 4.22.2** as frozen — Express 5.2.1 exists but the decision table says
   Express 4.
5. **Dependency-injected context over module singletons.** `AppContext` is built
   once at boot and hung off the Express app (`app.set('appContext')`); routers
   read it with `getContext(req)`. This keeps every `routes.ts` a *plain exported
   router* as the prompt asks, and means unit tests never transitively import
   Prisma/Redis or require a valid `.env`.
6. **Stub routers are mounted, not just created.** Eleven empty routers are wired
   under `/api/v1/*` so the monolith's routing is proved now and later phases only
   add handlers. Still zero business logic.
7. **`AppError` gained an optional `messageKey`.** The prompt required
   statusCode/code/message/details; without an i18n key the error middleware
   could not honour the "all user-facing strings via i18n keys" rule. The
   developer-facing `message` is still the fallback.
8. **One extra config key: `SHUTDOWN_TIMEOUT_MS`** (default 10000) so the graceful
   shutdown deadline is not a magic number.
9. **Health lives at `src/modules/health/`** — same module shape as the domain
   stubs, but not one of the eleven named stubs.
10. **`/health` returns 503 when degraded.** The prompt only specified the body;
    a health endpoint that returns 200 while Redis is down is useless to a load
    balancer. The body shape is unchanged, with `status: "degraded"`.
11. **CI runs two jobs, and integration tests are included.** `verify` (install,
    lint, format check, build, unit tests — no services) and `integration`
    (PostGIS + Redis service containers, `migrate deploy` on a virgin database,
    seed **twice** to prove idempotency, then the full suite). The prompt allowed
    either; running both proves done-criteria 1 and 4 on every push.
12. **`prepare` in `shared` + `postinstall` in `api`.** `npm install` alone builds
    the shared package and generates the Prisma client, so the documented
    quickstart works without extra steps.
13. **Seed does not set an explicit `id`.** Autoincrement yields id 1 on a fresh
    database (verified), and hardcoding `id: 1` would leave the sequence pointing
    at 1 and break the next insert.
14. **`vitest.config.mts`, not `.ts`** — silences Vite's "CJS build of Vite's Node
    API is deprecated" warning on every test run.
15. **Prisma query-level logging is off** (only `warn`/`error` piped to pino),
    which keeps the `$on` event types statically sound. A one-line change to
    enable.
16. **One test file beyond the four required** — `health/service.test.ts` unit-tests
    the report builder with doubles, so CI's no-services job still covers health
    logic.

### Known warnings (not errors)

- `eslint-visitor-keys@5.0.1` prints `EBADENGINE` on Node 20.12.2 (it wants
  ≥20.19.0). Everything installs and runs; **recommend developers use Node
  20.19+**. `.nvmrc` says `20`, which resolves to the latest 20.x.
- Prisma 6 warns that `package.json#prisma` is deprecated and moves to
  `prisma.config.ts` in Prisma 7. The `prisma.seed` entry is kept deliberately so
  `prisma migrate reset` re-seeds; migrate it as part of the Prisma 7 upgrade.

### Brand-name compliance

`grep -ri fixbridge` over the repo returns only: npm workspace/package names,
Docker container / DB / user names, the `DEFAULT_APP_NAME` constant that seeds
the `APP_NAME` default, `.env` values, doc examples and test fixtures. **No
user-facing string contains a literal name** — logs get it from pino's `base:
{ app: config.APP_NAME }` and `/health` from `context.config.APP_NAME`. Setting
`APP_NAME=anything` changes every one of them.

---

## Assumptions & missing inputs

**Needed from Ankit:**

1. **Brand name** — still undecided, as instructed. Everything routes through
   `APP_NAME`, so deciding it later is a one-line env change plus optional
   renames of internal package/container names.
2. **Phase numbering for 3–10.** Only Phase 2 (auth), 11 (admin) and 12–13
   (mobile) are stated in the prompt. The stub comments assume: 3 customers ·
   4 providers · 5 verification · 6 search · 7 bookings · 8 quotations ·
   9 payments · 10 reviews + notifications. **Correct me and I will re-label the
   stubs** — it is comment-only, zero code impact.
3. **Git remote.** The repo is initialised locally with an initial commit, but no
   remote is configured, so the CI workflow has **not yet been observed running**.
   Point it at a GitHub repo and the first push will exercise it.
4. **Does `cities` need geography?** It currently has no centroid, bounding box or
   service-radius column. Search (Phase 6) may want a city centroid for defaults.
   Adding it later is a trivial migration — flag it if you want it earlier.
5. **Service-category taxonomy** (electrician, plumber, motor rewinding, genset,
   mechanic, AC/appliance) — which phase owns that table? Not built, per scope.
6. **Hindi copy is my translation.** The strings in `locales/hi.json` are
   placeholder-quality and should get a native-speaker review before anything
   ships to real users in Jabalpur.

**Assumed:**

- API version prefix is `/api/v1`.
- All timestamps stored as `timestamptz` in UTC; IST is a presentation concern.
- Local Postgres credentials `fixbridge/fixbridge` are **development only** —
  staging/production need real secret management (no secrets are committed).
- Default port 3000; default locale `hi`.
- Node 20 LTS, per the prompt.

---

## Verification results

Every command below was run on this machine (Windows 11, Node v20.12.2, Docker
28.0.4) and passed.

| Check | Result |
|---|---|
| `npm install` | 338 packages; `shared` built and Prisma client generated by lifecycle hooks |
| `npm run lint` | Clean, no errors or warnings |
| `npm run format:check` | `All matched files use Prettier code style!` |
| `npm run build` | Clean `tsc` for both workspaces; locale JSON copied into `dist/`, test files excluded |
| `npm run typecheck` | Clean |
| `npm run test:unit` | **45 passed** (4 files) |
| `npm test` | **51 passed** (5 files) — 45 unit + 6 integration |
| `npm test` with infra down | **45 passed, 6 skipped** — prints `[skipped] /health integration test — dependencies unreachable: … Start the services with \`docker compose up -d\` and rerun.` |
| `docker compose up -d` | Both containers reach `healthy` |
| Fresh-DB migration (`docker compose down -v` → `up -d` → `migrate:deploy`) | Both migrations applied cleanly to a virgin database |
| Extensions after migration | `postgis 3.4.3`, `pg_trgm 1.6` present |
| `npm run seed` run twice | `city ready: #1 Jabalpur, Madhya Pradesh` both times; `SELECT count(*) FROM cities` = **1** |

### Working curl examples

```bash
$ curl -i http://localhost:3000/health
HTTP/1.1 200 OK
X-Request-Id: ed0dc8b7-10f6-4391-9794-3d7ba9623953
Content-Language: hi

{"status":"ok","app":"fixbridge","version":"0.1.0","uptime":4.603,
 "checks":{"postgres":"ok","redis":"ok"},"message":"सेवा ठीक चल रही है।"}
```

```bash
$ curl -s http://localhost:3000/health -H 'Accept-Language: en-IN,en;q=0.9'
{"status":"ok","app":"fixbridge","version":"0.1.0","uptime":14.579,
 "checks":{"postgres":"ok","redis":"ok"},"message":"Service is running normally."}
```

```bash
# Request-id passthrough
$ curl -s -D- -o/dev/null http://localhost:3000/health -H 'X-Request-Id: trace-abc-123'
X-Request-Id: trace-abc-123
```

```bash
# Degraded path — verified by `docker compose stop redis`
$ curl -s -o- -w '%{http_code}\n' http://localhost:3000/health -H 'Accept-Language: en'
{"status":"degraded","app":"fixbridge","version":"0.1.0","uptime":32.837,
 "checks":{"postgres":"ok","redis":"fail"},"message":"Service is running with degraded dependencies."}
503
# after `docker compose start redis` the same call returns 200 with both checks ok
```

```bash
# Error envelope — default locale (hi)
$ curl -s http://localhost:3000/api/v1/auth/login
{"error":{"code":"NOT_FOUND","message":"आप जो ढूँढ रहे हैं, वह हमें नहीं मिला।",
 "requestId":"269cc068-cf54-4974-bfb2-3bc94fb18355",
 "details":{"method":"GET","path":"/api/v1/auth/login"}}}

# …and in English
$ curl -s http://localhost:3000/nope -H 'Accept-Language: en'
{"error":{"code":"NOT_FOUND","message":"We could not find what you were looking for.",
 "requestId":"f3482340-216a-41ec-9f2f-5e90d27c0f34",
 "details":{"method":"GET","path":"/nope"}}}
```

### Not verified

- **Graceful shutdown under a real signal.** The handlers are implemented and
  wired, but Windows cannot deliver a meaningful `SIGTERM` to a Node process
  (`process.kill` maps to an abrupt terminate), so the signal path was reviewed
  rather than executed. It will exercise normally on Linux/Docker.
- **CI going green.** No git remote is configured yet, so the workflow has never
  actually run. Every step it performs was run locally and passed.

---

## Next steps — Phase 2 (Identity & Auth)

**Ready to build on:**

- `apps/api/src/modules/auth/` stubs already exist and are mounted at
  `/api/v1/auth`.
- Zod is wired and `ZodError` already becomes a 400 with per-field details —
  request schemas belong in `auth/types.ts`.
- `AppError.unauthorized` / `.forbidden` and the shared error envelope are ready;
  add `errors.otpInvalid`, `errors.otpExpired`, `errors.unauthorized` to both
  locale files rather than any literal string.
- Redis is connected and idle — the natural home for OTP codes with a TTL and for
  send-rate counters.
- pino already redacts `*.otp` and `authorization`, so OTPs and tokens will not
  reach the logs.
- `cities.id` exists for the `city_id` foreign key on the users table.

**Phase 2 will need to decide/add:**

- `users` table (phone as identity, unique + normalised E.164), `role` enum
  (customer / provider / admin), `city_id` FK, `is_active`, timestamps.
- JWT secret/lifetime config keys — add to `config.ts` and `.env.example`
  together, so a missing secret fails the boot rather than a request.
- An SMS provider for OTP delivery. Messaging adapters are explicitly out of
  scope until their phase, so Phase 2 probably wants a logged/stubbed sender
  behind an interface, plus a fixed OTP in non-production.
- Auth middleware (`requireAuth`, `requireRole`) — `core/middleware/` is where it
  belongs, alongside the existing stack.
- **Rate limiting is still out of scope** but OTP endpoints are exactly where it
  will matter; note the attack surface now and build it when its phase arrives.

**Carried forward, deliberately not built** (noted per scope discipline): the
transactional outbox table + in-process dispatcher, object storage for
verification documents, Razorpay/UPI integration, messaging adapters, OpenAPI
generation, rate limiting, and an API container in Compose.
