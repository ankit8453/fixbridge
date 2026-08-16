# Hyperlocal skilled-services marketplace

Internal codename: **`fixbridge`**. A two-sided marketplace connecting customers
with verified skilled technicians — electricians, plumbers, motor rewinding,
genset techs, mechanics, AC/appliance repair. Launch city: **Jabalpur, Madhya
Pradesh**, then the rest of India.

> **The brand name is not decided.** Nothing in this repo hardcodes one. The
> single source of truth is the `APP_NAME` environment variable; `fixbridge` is
> only a codename used for internal package/container names and as the default
> value of `APP_NAME`. Every user-facing string comes from `APP_NAME` or an i18n
> key — never a literal.

**Status:** Phase 7 of 14 complete — scaffold, health, identity/auth, profiles,
the verification engine, geo-search with Hinglish resolution, the booking engine
with slots and a physical start/end handshake, and itemised quotations that agree
the price in writing before the work proceeds.

---

## Quickstart

Requires **Node 20 LTS** (see [.nvmrc](.nvmrc)) and Docker.

```bash
git clone <repo> && cd <repo>

# 1. Infrastructure — Postgres 16 + PostGIS, Redis 7, MinIO
docker compose up -d

# 2. Dependencies (also builds packages/shared and generates the Prisma client)
npm install

# 3. Environment
cp apps/api/.env.example apps/api/.env      # Windows: copy apps\api\.env.example apps\api\.env

# 4. Schema + data
npm run migrate:deploy
npm run seed

# 5. Run
npm run start:dev

# 6. Verify
curl http://localhost:3000/health
```

Expected:

```json
{
  "status": "ok",
  "app": "fixbridge",
  "version": "0.1.0",
  "uptime": 4.603,
  "checks": { "postgres": "ok", "redis": "ok" },
  "message": "सेवा ठीक चल रही है।"
}
```

Hindi is the default locale. Add `-H 'Accept-Language: en'` for English.

### Signing in locally

`.env.example` ships `AUTH_FIXED_OTP=000000` for phones starting `+9199999`, so
you can complete a login without reading any code out of the logs. The seeded
admin (`+919999900001`, roles `admin` + `ops`) sits inside that prefix.

```bash
# Any phone works; this one is the seeded admin.
curl -X POST http://localhost:3000/api/v1/auth/otp/request \
  -H 'Content-Type: application/json' -d '{"phone":"+919999900001"}'

curl -X POST http://localhost:3000/api/v1/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+919999900001","otp":"000000","deviceId":"my-laptop-001"}'
# → { "accessToken": "...", "refreshToken": "...", "user": { "roles": ["admin","ops"] } }

curl http://localhost:3000/api/v1/auth/me -H "Authorization: Bearer $ACCESS_TOKEN"
```

For a phone **outside** that prefix the real OTP is generated and written to the
API log as `devOtp` — grab it from the terminal running `npm run start:dev`.

The fixed OTP is not a runtime toggle you could forget to switch off: the config
schema **refuses to parse** any environment that sets `AUTH_FIXED_OTP` together
with `NODE_ENV=production`, so the process cannot start.

Full endpoint reference: [docs/API.md](docs/API.md).

---

## Layout

```
.
├── apps/
│   ├── api/          Express + TypeScript modular monolith — the backend
│   ├── admin/        placeholder (Phase 11)
│   └── mobile/       placeholder (Phases 12–13)
├── packages/
│   └── shared/       types + constants shared by API and future clients
├── docs/
│   ├── API.md        endpoint reference, updated every phase
│   └── summaries/    one summary per phase
├── docker-compose.yml
└── package.json      npm workspaces root
```

Inside `apps/api/src`:

```
core/            config, logger, i18n, errors, rate limiting, geocoding,
                 object storage, Prisma/Redis clients, middleware (request-id,
                 locale, authenticate, requireRoles), shutdown
modules/         one folder per domain — routes.ts · service.ts · repository.ts · types.ts
  health/        GET /health
  auth/          OTP login, JWT + refresh rotation, role guards, block/denylist
  categories/    service taxonomy (cluster → service), i18n names
  customers/     customer profiles, saved addresses with PostGIS points
  providers/     technician profiles, skills, price cards, availability, completeness
  verification/  KYC ladder, append-only event log, document uploads, badges
  search/        geo radius search, ranking scorer, Hinglish text resolution
  bookings/      slots, booking state machine, handshake OTPs, expiry, stats
  quotations/    itemised versioned quotes, visit-fee config, payable computation
types/           Express request augmentation
```

Every other domain module is a stub until its phase. `repository.ts` is the only
file in a module allowed to touch the database — and the only place raw SQL may
appear.

Four design notes worth reading before touching those areas:
[docs/geo-notes.md](docs/geo-notes.md) for PostGIS columns with Prisma,
[docs/verification.md](docs/verification.md) for the append-only KYC model,
[docs/search.md](docs/search.md) for the ranking formula and query plan, and
[docs/bookings.md](docs/bookings.md) for the double-booking constraint, the
booking state machine, the quotation lifecycle and the outbox contract.

### Phase plan

| Phase | Scope                                                                  |
| ----- | ---------------------------------------------------------------------- |
| 1 ✅  | Repo scaffold, config, logging, errors, i18n, `/health`, cities        |
| 2 ✅  | Identity & auth — OTP login, JWT, refresh rotation, roles              |
| 3 ✅  | Categories, customer addresses, technician profiles, completeness gate |
| 4 ✅  | Verification — KYC ladder, append-only events, MinIO uploads, badges   |
| 5 ✅  | Search — PostGIS radius, pluggable ranking, Hinglish synonym resolve   |
| 6 ✅  | Bookings — slots, lifecycle, start/end OTP handshake, outbox           |
| 7 ✅  | Quotations — itemised, versioned, in-app approval, frozen payable      |
| 8     | Payments — UPI collection, logged cash                                 |
| 9     | Reviews — two-way ratings                                              |
| 10    | Notifications — WhatsApp Business API / push adapters                  |
| 11    | Admin console                                                          |
| 12–13 | Mobile apps                                                            |
| 14    | Launch hardening                                                       |

---

## Scripts

Run from the repo root.

| Command                           | Does                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| `npm run start:dev`               | Builds `shared`, then runs the API with `tsx watch`            |
| `npm run build`                   | `tsc` for `shared` then `api` → `dist/`                        |
| `npm start`                       | Runs the built API from `dist/`                                |
| `npm test`                        | Full Vitest suite (integration tests skip if infra is down)    |
| `npm run test:unit`               | Unit tests only — excludes `*.integration.test.ts`             |
| `npm run lint` / `lint:fix`       | ESLint (flat config)                                           |
| `npm run format` / `format:check` | Prettier                                                       |
| `npm run typecheck`               | `tsc --noEmit` across workspaces                               |
| `npm run migrate`                 | `prisma migrate dev` — creates a migration from schema changes |
| `npm run migrate:deploy`          | `prisma migrate deploy` — applies existing migrations          |
| `npm run migrate:reset`           | Drops, re-migrates and re-seeds the database                   |
| `npm run migrate:status`          | Shows which migrations are applied                             |
| `npm run seed`                    | Idempotent seed — safe to run repeatedly                       |
| `npm run prisma:generate`         | Regenerates the Prisma client                                  |
| `npm run infra:up` / `infra:down` | `docker compose up -d` / `down`                                |
| `npm run infra:reset`             | Destroys volumes and recreates — a truly fresh database        |

`build`, `test`, `test:unit` and `typecheck` all rebuild `packages/shared` first,
so editing a shared type never leaves the API typechecking against a stale `dist`.

---

## Configuration

All configuration is environment variables, validated with Zod at startup —
a bad or missing value fails the boot with a message naming the field, never at
runtime. See [apps/api/.env.example](apps/api/.env.example).

| Variable                           | Default         | Notes                                                                                              |
| ---------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `APP_NAME`                         | `fixbridge`     | The only place a name lives.                                                                       |
| `NODE_ENV`                         | `development`   | `development` \| `test` \| `production`                                                            |
| `PORT`                             | `3000`          |                                                                                                    |
| `LOG_LEVEL`                        | `info`          | pino level, or `silent`                                                                            |
| `DATABASE_URL`                     | —               | **required**, `postgres:`/`postgresql:`                                                            |
| `REDIS_URL`                        | —               | **required**, `redis:`/`rediss:`                                                                   |
| `SHUTDOWN_TIMEOUT_MS`              | `10000`         | Grace period before a forced exit                                                                  |
| `TRUST_PROXY_HOPS`                 | `0`             | Proxy hops to trust for `X-Forwarded-For`                                                          |
| `JWT_SECRET`                       | —               | **required**, at least 32 chars. Rejected in production if left at the `.env.example` placeholder. |
| `JWT_ACCESS_TTL_SECONDS`           | `900`           | Access token lifetime                                                                              |
| `REFRESH_TOKEN_TTL_DAYS`           | `30`            | Refresh token lifetime                                                                             |
| `OTP_TTL_SECONDS`                  | `300`           | How long a code stays valid                                                                        |
| `OTP_MAX_VERIFY_ATTEMPTS`          | `5`             | Wrong guesses before the code is destroyed                                                         |
| `OTP_RATE_WINDOW_SECONDS`          | `900`           | Rate-limit window                                                                                  |
| `OTP_MAX_PER_PHONE`                | `3`             | OTP requests per phone per window                                                                  |
| `OTP_MAX_PER_IP`                   | `5`             | OTP requests per IP per window                                                                     |
| `AUTH_FIXED_OTP`                   | unset           | Dev-only bypass. **Refused in production.**                                                        |
| `AUTH_FIXED_OTP_PHONE_PREFIX`      | `+9199999`      | Which phones the bypass applies to                                                                 |
| `SEED_ADMIN_PHONE`                 | `+919999900001` | Admin account created by `npm run seed`                                                            |
| `PROVIDER_LISTING_THRESHOLD`       | `80`            | Completeness score a technician needs to appear in search                                          |
| `MAX_ADDRESSES_PER_USER`           | `5`             | Saved addresses per customer                                                                       |
| `DEFAULT_CITY_ID`                  | `1`             | City used when a request omits `cityId`                                                            |
| `OTP_RESEND_COOLDOWN_SECONDS`      | `60`            | Minimum gap between OTP requests for one phone                                                     |
| `S3_ENDPOINT`                      | unset           | S3-compatible endpoint. MinIO locally; omit for real AWS S3.                                       |
| `S3_ACCESS_KEY_ID`                 | —               | **required**                                                                                       |
| `S3_SECRET_ACCESS_KEY`             | —               | **required**                                                                                       |
| `S3_BUCKET`                        | `fixbridge-kyc` | Private bucket for KYC documents. Never world-readable.                                            |
| `S3_FORCE_PATH_STYLE`              | `true`          | MinIO needs path-style; real S3 prefers virtual-host style                                         |
| `STORAGE_UPLOAD_URL_TTL_SECONDS`   | `300`           | Pre-signed PUT lifetime                                                                            |
| `STORAGE_DOWNLOAD_URL_TTL_SECONDS` | `300`           | Pre-signed GET lifetime                                                                            |
| `STORAGE_MAX_UPLOAD_BYTES`         | `10485760`      | 10 MB. Signed into the URL, so storage enforces it.                                                |
| `SEED_OPS_PHONE`                   | `+919999900002` | Ops-only reviewer account created by `npm run seed`                                                |
| `SLOT_HORIZON_DAYS`                | `14`            | How far ahead slots are materialised                                                               |
| `SLOT_INCREMENT_MINUTES`           | `60`            | Slot length. A shorter template window produces nothing.                                           |
| `BOOKING_REQUEST_TTL_MINUTES`      | `15`            | Unanswered requests expire and release their slot                                                  |
| `BOOKING_VISIT_FEE_PAISE`          | `4900`          | Snapshotted onto each booking. Stored, never charged — Phase 8.                                    |
| `BOOKING_OTP_LENGTH`               | `4`             | Handshake code length. Spoken aloud, in person.                                                    |
| `BOOKING_OTP_MAX_ATTEMPTS`         | `5`             | Then the booking locks, and stays locked                                                           |
| `OUTBOX_POLL_INTERVAL_MS`          | `2000`          | Dispatcher poll interval                                                                           |
| `OUTBOX_BATCH_SIZE`                | `50`            | Events claimed per pass                                                                            |
| `OUTBOX_MAX_ATTEMPTS`              | `8`             | Then the event is parked, not dropped                                                              |
| `OUTBOX_BACKOFF_BASE_SECONDS`      | `5`             | Retry N waits `base × 2^(N−1)`, capped                                                             |
| `OUTBOX_BACKOFF_MAX_SECONDS`       | `3600`          | Backoff ceiling                                                                                    |
| `JOBS_ENABLED`                     | `true`          | In-process background jobs. Off in tests.                                                          |
| `BOOKING_EXPIRY_JOB_INTERVAL_MS`   | `60000`         | How often stale requests are swept                                                                 |
| `SLOT_HORIZON_JOB_INTERVAL_MS`     | `21600000`      | How often the horizon is extended. Also runs once at boot.                                         |

> `TRUST_PROXY_HOPS` is a security control, not a formality. Trusting
> `X-Forwarded-For` when nothing sets it lets any caller spoof their IP and walk
> straight past the per-IP OTP limit. Leave it at `0` unless a proxy really is in
> front, then set it to the number of hops.

`docker-compose.yml` also reads optional `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `POSTGRES_PORT` and `REDIS_PORT` from a root `.env`, each with a
sensible default — override `POSTGRES_PORT` if 5432 is already taken locally.

---

## Conventions that apply from day one

- **Money is integers in paise.** Never floats, never rupees.
- **Every user-facing string is an i18n key**, `hi` and `en`, in
  [apps/api/src/core/locales/](apps/api/src/core/locales/). Default locale is `hi`.
- **Phone number is identity**, stored E.164 (`+91XXXXXXXXXX`), and **always
  masked in responses** (`+9198765*****`). OTP only — there is no password column.
- **`city_id` on every city-scoped table** so multi-city never needs a backfill.
- **One error envelope** for every endpoint — see [docs/API.md](docs/API.md).
- **Auth failures are deliberately uniform.** A wrong OTP and a phone with no
  pending OTP return byte-identical responses; so do all the refresh rejections.
  Any difference would be an enumeration oracle.
- **Ownership is enforced in the query, not after it.** `/me` routes filter by
  the caller's own id, so another user's row returns `404` rather than being
  found and then refused.
- **Category names are i18n keys**, never stored display text. A category row
  holds `categories.houseWiring`; the API renders it per `Accept-Language`.
- **PostGIS points go through raw SQL in repositories only** — Prisma cannot
  model `geography`. See [docs/geo-notes.md](docs/geo-notes.md).
- **Verification history is append-only.** `verification_events` refuses UPDATE
  outright and DELETE except through one flagged erasure path, both enforced by a
  database trigger. Case status is a projection of the log, never the reverse.
- **Identity numbers are never stored.** Only the last 4 digits are accepted, and
  a repository-wide scan runs in CI to keep it that way.
- **The API never handles uploaded file bytes** — clients PUT straight to object
  storage through short-lived pre-signed URLs, forced to download inert.
- **Search only surfaces trustworthy supply** — listed, verified and active, with
  no parameter that relaxes those gates. It never exposes a provider's
  coordinates, only a distance.
- **Ranking weights are config.** Reordering search results must never need a
  code change. See [docs/search.md](docs/search.md).
- **Double booking is impossible at the database level.** A Postgres exclusion
  constraint refuses any overlapping committed slot for the same technician.
  Application locks make the common race a friendly 409; the constraint is the
  guarantee. See [docs/bookings.md](docs/bookings.md).
- **Booking history is append-only too**, on the same terms as verification, and
  a booking's status is a projection of its event log.
- **A price is agreed in writing before work proceeds.** A job reaches
  `WORK_DONE` only at an approved quotation or a `fixed` price card, and a
  quotation is versioned rather than edited — the customer saw v1, so v1 survives
  forever. Database triggers enforce that, not convention.
- **The bill is frozen at the ending**, in the same transaction as the terminal
  status. Phase 8 collects `payable_paise`; it never recomputes one.
- **Domain events are written in the same transaction as the state change** — a
  transactional outbox, not a broker call. Delivery is at-least-once, so **every
  consumer must be idempotent**.
- **Modular monolith.** One Postgres, one Redis. No Kafka, no microservices, no
  Kubernetes — this is pilot traffic in one city.

## Scope discipline

The project is built in 14 sequential phases, each arriving as a single prompt.
A phase implements only what its prompt asks; anything a later phase needs is
noted in that phase's summary rather than built early. Phase summaries live in
[docs/summaries/](docs/summaries/).

---

## Testing

```bash
npm test          # everything
npm run test:unit # no infrastructure needed
```

Integration tests (`*.integration.test.ts`) run against the real compose
services. If Postgres or Redis is unreachable they **skip with a printed
reason** instead of failing, so a fresh clone with no Docker still gets a green
run.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs two jobs:

1. **verify** — install, lint, format check, build, unit tests. No services.
2. **integration** — Postgres (PostGIS) + Redis service containers, applies
   migrations to a fresh database, seeds twice to prove idempotency, then runs
   the full suite.

---

## A note on editing files here

Prettier enforces LF endings and UTF-8, and [.gitattributes](.gitattributes)
normalises line endings on checkout. Avoid appending to files with PowerShell's
`>>` or `Out-File` without `-Encoding utf8` — those default to UTF-16 and will
turn a text file into something git treats as binary. Use an editor, or
`Set-Content -Encoding utf8`.
