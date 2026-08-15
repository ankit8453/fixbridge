# PHASE 2 PROMPT — Identity & Auth

You are building **Phase 2 of 14** of the `fixbridge` marketplace. Phase 1 (repo scaffold, Express+TS modular monolith, Prisma 6 + Postgres 16/PostGIS, Redis, i18n, health endpoint) is complete and merged on `main`. Build strictly on top of what exists — read `docs/summaries/phase01-summary.md` and the existing `core/` utilities before writing code. Reuse the established patterns (Zod validation, AppError with messageKey, pino logging, request-id) — do not invent parallel ones.

---

## Correction from Phase 1 review (do this first)

Re-label the phase-number comments in the domain module stubs to match the actual plan:

- Phase 3 = **customers + providers + categories** (one phase)
- Phase 4 = verification · Phase 5 = search · Phase 6 = bookings · Phase 7 = quotations · Phase 8 = payments · Phase 9 = reviews · Phase 10 = notifications · Phase 11 = admin

---

## Context reminders (frozen decisions in force this phase)

- Phone number is the identity. India-first: store phones normalized as E.164 (`+91XXXXXXXXXX`); accept user input with or without `+91`.
- Roles: `customer`, `technician`, `ops`, `admin`. One user row can hold multiple roles (a technician can also be a customer) — model roles as an array/join, not a single enum column.
- JWT: short-lived access token (15 min) + refresh token rotation. Refresh tokens are opaque random strings stored hashed in Postgres with device binding; access tokens are stateless JWTs.
- OTPs live in Redis only (never Postgres), hashed, with TTL.
- All user-facing strings via i18n keys (hi + en).
- No brand name hardcoded — `APP_NAME` config only.
- `city_id` awareness: users table gets a nullable `default_city_id` FK to cities (Jabalpur = 1) for future use; no city logic beyond the column this phase.

---

## Phase 2 scope — what to build NOW

### 1. Data model (Prisma migration)
- `users`: id (uuid), phone (unique, E.164), name (nullable — collected later), roles (array or user_roles join table — your call, document it), default_city_id (nullable FK), status (`active` | `blocked`), created_at, updated_at.
- `refresh_tokens`: id, user_id FK, token_hash (sha256), device_id, device_info (user-agent string, nullable), expires_at, revoked_at (nullable), replaced_by_token_id (nullable — rotation chain), created_at. Index on (user_id, device_id).

### 2. OTP login flow (`auth` module)
- `POST /api/v1/auth/otp/request` — body: `{ phone }`. Normalizes phone, generates 6-digit OTP, stores **hashed** in Redis with 5-min TTL, key per phone. Sends via an `OtpTransport` interface with a single dev implementation: logs the OTP via pino at info level. Response never contains the OTP.
- **Rate limiting (aggressive, Redis-backed):**
  - Max 3 OTP requests per phone per 15 minutes
  - Max 5 OTP requests per IP per 15 minutes
  - Max 5 verify attempts per OTP, then the OTP is invalidated
  - On limit hit: 429 with i18n message and `Retry-After` header
- `POST /api/v1/auth/otp/verify` — body: `{ phone, otp, deviceId }` (deviceId = client-generated stable string). On success: create user if first login (default role `customer`), issue access JWT + refresh token, delete OTP from Redis. On failure: count attempt, generic error (don't reveal whether phone exists).
- **Dev/test convenience:** when `NODE_ENV !== 'production'` AND config flag `AUTH_FIXED_OTP` is set (e.g. `000000`), that OTP always verifies for phone numbers matching a configurable test prefix (e.g. `+9199999`). Must be structurally impossible to enable in production (config loader rejects it).

### 3. Tokens
- Access JWT: 15-min expiry, payload = `{ sub: userId, roles, deviceId }`, signed HS256 with `JWT_SECRET` from env (add to config + `.env.example`).
- `POST /api/v1/auth/refresh` — body: `{ refreshToken, deviceId }`. Validates hash + expiry + not revoked + deviceId matches. **Rotation:** issue new pair, mark old token revoked with `replaced_by_token_id`. **Reuse detection:** if a revoked token is presented again, revoke ALL tokens for that (user, device) and log a security warning.
- `POST /api/v1/auth/logout` — revokes the presented refresh token.

### 4. Middleware & guards
- `authenticate` middleware: parses Bearer token, attaches `req.user = { id, roles, deviceId }`, 401 on missing/invalid/expired (distinct i18n keys for expired vs invalid).
- `requireRoles(...roles)` guard: 403 if authenticated user lacks every required role.
- Wire a demo protected route: `GET /api/v1/auth/me` returns the current user (id, phone masked as `+91XXXXX*****`, name, roles).

### 5. Tests (Vitest, following Phase 1 conventions)
- Unit: phone normalization, OTP hashing/verification, rate-limiter logic, JWT sign/verify, refresh rotation + reuse-detection logic.
- e2e (integration, against compose services): request-OTP → read OTP from log/fixed-OTP path → verify → call `/me` with access token → refresh → old refresh token rejected → reused revoked token nukes the device's tokens → `requireRoles('admin')` route rejects a customer with 403.
- Rate-limit e2e: 4th OTP request for same phone within window → 429.

### 6. Docs
- Update `docs/API.md` with every new endpoint (request/response examples, error cases).
- Seed script: add one admin user (phone from env `SEED_ADMIN_PHONE`, default a test number) with roles `[admin, ops]` — idempotent.

---

## Explicitly OUT of scope this phase
Real SMS/WhatsApp sending (Phase 10) · customer/technician profiles (Phase 3) · password auth (never — OTP only) · OAuth/social login · admin UI (Phase 11) · session listing/management endpoints · account deletion (Phase 14 DPDP work) · permissions beyond the 4 roles.

---

## Done criteria
1. Full e2e path green: request-OTP → verify → protected route → refresh → role-guard rejection.
2. Rate limits enforced and tested; OTPs never appear in API responses or Postgres.
3. Refresh rotation with reuse detection proven by test.
4. Fixed-OTP path impossible in production config (test proves config loader rejects it).
5. `npm run lint/build/test` clean; migrations run on fresh DB; seeds idempotent; repo runnable as always.
6. `docs/API.md` updated.

## Final deliverable
`docs/summaries/phase02-summary.md` in the standard six-point format (Goal / What was built / Key decisions & deviations / Assumptions & missing inputs / Verification results / Next steps). Next phase preview for context: Phase 3 = customer profiles + saved addresses (PostGIS points, landmark field), technician profiles with availability templates, category tree, seed data.
