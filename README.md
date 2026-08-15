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

---

## Quickstart

Requires **Node 20 LTS** (see [.nvmrc](.nvmrc)) and Docker.

```bash
git clone <repo> && cd <repo>

# 1. Infrastructure — Postgres 16 + PostGIS, Redis 7
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
core/          config, logger, i18n, errors, Prisma/Redis clients, middleware, shutdown
modules/       one folder per domain — routes.ts · service.ts · repository.ts · types.ts
  health/      the only module with behaviour in Phase 1
types/         Express request augmentation
```

Every domain module is a stub until its phase. `repository.ts` is the only file
in a module allowed to touch the database.

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

---

## Configuration

All configuration is environment variables, validated with Zod at startup —
a bad or missing value fails the boot with a message naming the field, never at
runtime. See [apps/api/.env.example](apps/api/.env.example).

| Variable              | Default       | Notes                                   |
| --------------------- | ------------- | --------------------------------------- |
| `APP_NAME`            | `fixbridge`   | The only place a name lives.            |
| `NODE_ENV`            | `development` | `development` \| `test` \| `production` |
| `PORT`                | `3000`        |                                         |
| `LOG_LEVEL`           | `info`        | pino level, or `silent`                 |
| `DATABASE_URL`        | —             | **required**, `postgres:`/`postgresql:` |
| `REDIS_URL`           | —             | **required**, `redis:`/`rediss:`        |
| `SHUTDOWN_TIMEOUT_MS` | `10000`       | Grace period before a forced exit       |

`docker-compose.yml` also reads optional `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `POSTGRES_PORT` and `REDIS_PORT` from a root `.env`, each with a
sensible default — override `POSTGRES_PORT` if 5432 is already taken locally.

---

## Conventions that apply from day one

- **Money is integers in paise.** Never floats, never rupees.
- **Every user-facing string is an i18n key**, `hi` and `en`, in
  [apps/api/src/core/locales/](apps/api/src/core/locales/). Default locale is `hi`.
- **`city_id` on every city-scoped table** so multi-city never needs a backfill.
- **Phone number is identity** (arrives with auth in Phase 2).
- **One error envelope** for every endpoint — see [docs/API.md](docs/API.md).
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
