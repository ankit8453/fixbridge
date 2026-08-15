# Phase 02 — Identity & Auth

**Date:** 2026-08-15 · **Phase 2 of 14**

---

## Goal

Make phone number the identity of the platform: OTP login over Redis, stateless
15-minute access JWTs, opaque refresh tokens with rotation and theft detection,
four roles a user can hold in combination, and guards to protect routes — all
aggressively rate limited, fully localised, and with the development OTP bypass
made structurally impossible to enable in production.

Plus the Phase 1 review correction: re-label the domain stubs to the real plan.

---

## What was built

### Phase 1 correction (done first)

All 40 stub files across 10 modules re-labelled to the corrected plan:
Phase 3 = customers + providers + categories · 4 verification · 5 search ·
6 bookings · 7 quotations · 8 payments · 9 reviews · 10 notifications ·
11 admin. `docs/API.md`, `README.md` and `src/modules/index.ts` updated to match.

There is no `categories` module folder — the prompt folds categories into Phase 3
alongside providers, and creating an empty folder for it now would have been
inventing scope. It can be a folder or part of `providers/` when Phase 3 decides.

### Data model — migration `20260815105247_add_users_roles_refresh_tokens`

| Table / type         | Contents                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role` (enum)        | `customer`, `technician`, `ops`, `admin`                                                                                                                                                                                                                |
| `user_status` (enum) | `active`, `blocked`                                                                                                                                                                                                                                     |
| `users`              | `id` uuid PK, `phone` varchar(16) **unique** (E.164), `name` nullable, `status`, `default_city_id` nullable FK → `cities` (ON DELETE SET NULL), `created_at`, `updated_at`. Index on `status`.                                                          |
| `user_roles`         | Composite PK `(user_id, role)`, `granted_at`. FK cascades on user delete. Index on `role`.                                                                                                                                                              |
| `refresh_tokens`     | `id` uuid, `user_id` FK (cascade), `token_hash` char(64) **unique**, `device_id`, `device_info` nullable, `expires_at`, `revoked_at` nullable, `replaced_by_token_id` unique self-FK, `created_at`. Indexes on `(user_id, device_id)` and `expires_at`. |

There is no password column, and there never will be.

### `apps/api/src/modules/auth`

| File            | What it does                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phone.ts`      | E.164 normalisation (`9876543210`, `+91 98765-43210`, `09876543210`, `00919876543210` → `+919876543210`), validation, and `maskPhone` → `+9198765*****`.                                                 |
| `otp.ts`        | Crypto-random 6-digit generation, HMAC-SHA256 hashing salted by phone, constant-time verification, the Redis-backed `OtpStore`, and the fixed-OTP predicate.                                             |
| `tokens.ts`     | Access-JWT sign/verify (HS256, pinned algorithm, issuer check, unique `jti`), Bearer extraction, opaque refresh generation + SHA-256 hashing, and the **pure** `classifyRefreshToken` decision function. |
| `transport.ts`  | `OtpTransport` interface + the development logger implementation. `createOtpTransport` **throws** if asked for one in production.                                                                        |
| `types.ts`      | Zod schemas (`phoneField` transforms to E.164 at the edge, `deviceIdField`, `otpField`) and a compile-time assertion that the shared `Role` union and the Prisma `Role` enum stay identical.             |
| `repository.ts` | All Prisma access, including the rotation transaction and the device-wide revoke.                                                                                                                        |
| `service.ts`    | Orchestration: rate limits, OTP lifecycle, session issuing, refresh + reuse detection, logout, `/me`.                                                                                                    |
| `routes.ts`     | The six endpoints.                                                                                                                                                                                       |

### `apps/api/src/core` additions

- **`rate-limit.ts`** — fixed-window Redis limiter. The INCR + EXPIRE + TTL runs
  as one Lua script so two concurrent requests cannot both see "first hit" and
  leave the key without an expiry, which would lock a phone out permanently. The
  arithmetic is split into a pure `evaluateRateLimit` for unit testing.
- **`middleware/authenticate.ts`** — Bearer parsing, distinct `AUTH_TOKEN_MISSING`
  / `AUTH_TOKEN_EXPIRED` / `AUTH_TOKEN_INVALID`, attaches `req.user`, plus
  `getAuthUser(req)` which throws rather than returning undefined.
- **`middleware/require-roles.ts`** — passes when the user holds at least one of
  the listed roles; 403 otherwise.
- **`errors.ts`** — `AppErrorOptions.headers`, plus `AppError.tooManyRequests`.
  This is how `Retry-After` and `WWW-Authenticate` reach the response.
- **`error-handler.ts`** — applies those headers.
- **`config.ts`** — 13 new keys and the production refinements (below).
- **`context.ts`** — carries the `otpTransport`.

### Endpoints

| Method | Path                       | Notes                                                 |
| ------ | -------------------------- | ----------------------------------------------------- |
| `POST` | `/api/v1/auth/otp/request` | 3/phone/15min, 5/IP/15min. OTP never in the response. |
| `POST` | `/api/v1/auth/otp/verify`  | Creates the account on first success (`customer`).    |
| `POST` | `/api/v1/auth/refresh`     | Rotation + reuse detection.                           |
| `POST` | `/api/v1/auth/logout`      | Idempotent.                                           |
| `GET`  | `/api/v1/auth/me`          | Protected. Phone masked.                              |
| `GET`  | `/api/v1/auth/admin-only`  | Demo `requireRoles` route — delete in Phase 11.       |

### i18n

11 new `errors.auth.*` keys plus `auth.otpSent` / `auth.loggedIn` /
`auth.loggedOut`, in both `hi` and `en`. `auth.otpSent` interpolates `{{minutes}}`.

### Seed

Adds the bootstrap admin from `SEED_ADMIN_PHONE` (default `+919999900001`) with
roles `[admin, ops]`. Roles are upserted individually rather than replaced, so a
rerun never strips a role an operator granted by hand.

---

## Key decisions & deviations

### Versions

|                                     | Version                                        |
| ----------------------------------- | ---------------------------------------------- |
| Node (verified locally)             | v20.12.2 · `.nvmrc` pins major `20`            |
| **Prisma CLI + client**             | **6.19.3** (unchanged)                         |
| **jsonwebtoken**                    | **9.0.3** (new) · `@types/jsonwebtoken` 9.0.10 |
| TypeScript / Express / Zod / Vitest | 5.9.3 / 4.22.2 / 4.4.3 / 3.2.7 (unchanged)     |

`jsonwebtoken` is the only new runtime dependency. Hand-rolling JWT signing is a
classic way to ship an `alg: none` hole; `jose` is ESM-first and would have
fought the CommonJS build.

### Decisions

1. **`user_roles` join table, not an array column.** The prompt allowed either.
   The join table gives every grant its own row, so Phase 11 can record who
   granted what and when without a migration, and `WHERE role = 'admin'` is a
   plain indexed lookup.
2. **OTPs are HMAC'd, not plain SHA-256.** A bare digest of a 6-digit code is a
   million-entry rainbow table — anyone who could read Redis could reverse every
   live OTP. The HMAC key is `JWT_SECRET` with an `otp:` domain-separation
   prefix, and the phone is mixed in as a salt. **Assumption worth confirming:**
   reusing `JWT_SECRET` for both purposes is safe with domain separation, but a
   dedicated `OTP_HASH_SECRET` would be cleaner if you would rather rotate them
   independently.
3. **Access tokens carry a unique `jti`.** Found during live verification: a
   refresh issued inside the same second as the original sign-in returned a
   **byte-identical** access token, because the claims and `iat` matched. A
   per-token `jti` fixes that and gives future phases something to denylist by.
4. **Refresh rejections are uniform.** Unknown, expired, revoked, wrong device and
   reuse all return the same `401 REFRESH_TOKEN_INVALID` with the same message.
   Distinguishing them tells an attacker which guess was closest.
5. **`authenticate` does no database round trip.** That is the point of a
   15-minute token. Live user state is checked where it matters — `/me` and
   refresh both load the user and reject a blocked account. Consequence, and it
   is a real one: **blocking a user does not kill their existing access token**;
   they lose access within 15 minutes when refresh fails. If you need instant
   revocation, say so and Phase 3 can add a Redis denylist keyed on `jti`.
6. **Roles are baked into the access token.** A role change therefore only takes
   effect on the next token. Documented in `docs/API.md`; the e2e test asserts it
   by re-signing in after granting `admin`.
7. **Rate limits are consumed phone-first, then IP.** Hammering one number does
   not also burn the shared IP budget for everyone behind that NAT.
8. **`TRUST_PROXY_HOPS` replaces `trust proxy: true`** (Phase 1 set it to `true`).
   With the per-IP limit now a security control, blindly trusting
   `X-Forwarded-For` would let any caller spoof their IP and walk straight past
   it. Default `0`; set it to the real hop count when a proxy is in front.
9. **Production also rejects the `.env.example` JWT secret.** Beyond the required
   fixed-OTP guard. Shipping the committed placeholder to production would hand
   over the token-signing key, and the check costs three lines.
10. **`createOtpTransport` throws in production.** Belt and braces alongside the
    config guard: the dev transport prints OTPs in plaintext, so it must not be
    constructible in production even if a config somehow got through.
11. **Root `test` / `test:unit` / `typecheck` now rebuild `packages/shared` first.**
    Editing a shared type used to leave the API typechecking against a stale
    `dist` — that bit during this phase.
12. **`/api/v1/auth/admin-only` lives in the auth module.** The role-guard e2e
    needs a guarded route, and the `admin` module belongs to Phase 11; adding
    routes there would have been the scope violation.

### A real bug the tests caught

The first e2e run failed on the "don't reveal whether the phone exists" assertion,
and it was the **code** that was wrong, not the test. A wrong code on a phone with
a pending OTP returned `OTP_INVALID`; a phone with no pending OTP returned
`OTP_EXPIRED`. That difference is an oracle for which numbers have a live OTP.
Both now return an identical `401 OTP_INVALID` with a message covering both cases
("not correct or has expired"), the `errors.auth.otpExpired` key was removed, and
two tests assert status, code, message and details all match exactly.

### Known warnings (unchanged from Phase 1)

- `eslint-visitor-keys@5.0.1` warns `EBADENGINE` on Node 20.12.2 (wants ≥20.19).
  Everything runs; use Node 20.19+.
- Prisma 6 warns that `package.json#prisma` moves to `prisma.config.ts` in
  Prisma 7. Kept deliberately so `prisma migrate reset` re-seeds.

### Repo housekeeping

`README.md` had 26 bytes of UTF-16 (`# fixbridge`) appended to it between phases —
almost certainly a PowerShell `>>` or `Out-File` redirect, which defaults to
UTF-16. The null bytes made git treat the whole file as binary, and it would have
failed `format:check` on a fresh Windows clone. The README has been rewritten as
clean UTF-8 and a short note about this is now in it.

---

## Assumptions & missing inputs

**Needed from Ankit:**

1. **Instant revocation — required or not?** Blocking a user currently takes up to
   15 minutes to bite (decision 5). If ops need "block this account **now**", that
   is a `jti` denylist in Redis and about half a day.
2. **Is `OTP_HASH_SECRET` wanted as a separate key?** Today OTP hashing derives
   from `JWT_SECRET` with domain separation (decision 2).
3. **Real SMS/WhatsApp provider** for Phase 10 — MSG91, Gupshup, Twilio? The
   `OtpTransport` interface is ready; only the implementation and credentials are
   missing. Until then no OTP can reach a real user outside the fixed-OTP prefix.
4. **DLT template registration.** Indian regulation requires SMS templates and
   sender IDs to be pre-registered on a DLT platform. That is a lead-time item —
   worth starting well before Phase 10, not during it.
5. **Are the rate limits right for real traffic?** 3 OTPs per phone per 15 minutes
   is deliberately aggressive. A customer who mistypes their number twice has one
   attempt left. Every limit is an env var, so this is a config call, not a code
   change.
6. **`SEED_ADMIN_PHONE` default is a test number** (`+919999900001`), chosen to sit
   inside the dev fixed-OTP prefix. Give me the real ops phone for staging.
7. **Brand name** — still undecided, still routed entirely through `APP_NAME`.
8. **Git remote** — still none, so CI has still never actually run.

**Assumed:**

- India-only phone numbers, 10 digits starting 6–9. `phone.ts` is hand-rolled
  rather than pulling in libphonenumber's ~1 MB of metadata for one country;
  revisit when a second country is real.
- `deviceId` is client-generated and stable per install; the API only constrains
  its shape (8–128 chars, `A-Za-z0-9._:-`).
- 30-day refresh lifetime, 15-minute access lifetime, both env-tunable.
- Expired refresh tokens are left in the table. At pilot volume that is nothing;
  a cleanup job can come later (the `expires_at` index is already there).

---

## Verification results

Run on Windows 11, Node v20.12.2, Docker 28.0.4.

| Check                                            | Result                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run lint`                                   | Clean                                                                                         |
| `npm run format:check`                           | `All matched files use Prettier code style!`                                                  |
| `npm run typecheck` / `npm run build`            | Clean                                                                                         |
| `npm run test:unit`                              | **127 passed** (8 files)                                                                      |
| `npm test`                                       | **167 passed** (10 files) — 127 unit + 40 integration                                         |
| Fresh DB: `down -v` → `up -d` → `migrate:deploy` | All **3** migrations applied cleanly to a virgin database                                     |
| `npm run seed` × 2                               | Idempotent — `cities`=1, `users`=1, `user_roles`=2 after both runs; admin holds `{ops,admin}` |
| Live server, built output (`node dist/index.js`) | Full flow driven end to end by hand                                                           |

### Test coverage of the done criteria

| Criterion                              | Where it is proven                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1. Full e2e path                       | `auth.integration.test.ts` — request → verify → `/me` → refresh → 403                                                             |
| 2. Rate limits enforced                | 4th request → 429; 5 wrong OTPs → 429; `Retry-After` asserted                                                                     |
| 2. OTPs never in responses or Postgres | Response body regex-checked; `information_schema` queried for any `%otp%` column (0 rows)                                         |
| 3. Rotation + reuse detection          | Rotation chain asserted in the DB; replay → 401 **and** the still-live sibling token dies too; `revokedAt: null` count drops to 0 |
| 4. Fixed OTP impossible in production  | 8 config tests assert the **loader** refuses to parse such an environment                                                         |

The e2e suite deliberately does **not** rely only on the fixed OTP: a separate
group drives a phone outside the test prefix through the genuine path — random
generation → HMAC → Redis → constant-time compare — using a capturing transport,
and asserts the stored value is an unrecoverable 64-hex digest, that the key
carries a TTL, that a code cannot be replayed, and that requesting a new code
resets the attempt counter.

### Working curl examples

```bash
# 1. Request an OTP (never returned; dev transport logs it as devOtp)
$ curl -X POST http://localhost:3000/api/v1/auth/otp/request \
    -H 'Content-Type: application/json' -H 'Accept-Language: en' \
    -d '{"phone":"99999 00077"}'
{"phone":"+9199999*****","expiresInSeconds":300,
 "message":"We have sent a 6-digit code to your phone. It is valid for 5 minutes."}

# 2. Verify (fixed OTP, dev only)
$ curl -X POST http://localhost:3000/api/v1/auth/otp/verify \
    -H 'Content-Type: application/json' \
    -d '{"phone":"+919999900077","otp":"000000","deviceId":"demo-device-0001"}'
{"tokenType":"Bearer","accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
 "expiresIn":900,"refreshToken":"L4r_4oeBZDJhrqMwb5tpdYqxEZCspxFPCQbS4TNHkv0",
 "refreshExpiresAt":"2026-09-14T11:04:11.319Z",
 "user":{"id":"5210c8e3-…","phone":"+9199999*****","name":null,
         "roles":["customer"],"status":"active","defaultCityId":null},
 "isNewUser":true,"message":"Signed in successfully."}

# 3. Protected route
$ curl http://localhost:3000/api/v1/auth/me -H "Authorization: Bearer $ACCESS"
{"user":{"id":"5210c8e3-…","phone":"+9199999*****","roles":["customer"],…},
 "deviceId":"demo-device-0001"}

# 4. Role guard rejects a customer
$ curl http://localhost:3000/api/v1/auth/admin-only \
    -H "Authorization: Bearer $ACCESS" -H 'Accept-Language: en'
{"error":{"code":"FORBIDDEN","message":"You do not have permission to do this.",
 "requestId":"ec882474-…","details":{"requiredRoles":["admin"]}}}
# …and admits the seeded admin: {"ok":true,"roles":["admin","ops"]}

# 5. Refresh rotates BOTH tokens
$ curl -X POST http://localhost:3000/api/v1/auth/refresh \
    -H 'Content-Type: application/json' \
    -d '{"refreshToken":"L4r_4oe…","deviceId":"demo-device-0001"}'
# → 200, new accessToken AND new refreshToken

# 6. Replaying the retired token → 401, and the device is nuked
$ curl -X POST http://localhost:3000/api/v1/auth/refresh \
    -H 'Content-Type: application/json' -H 'Accept-Language: en' \
    -d '{"refreshToken":"L4r_4oe…","deviceId":"demo-device-0001"}'
{"error":{"code":"REFRESH_TOKEN_INVALID",
 "message":"Your session is no longer valid. Please sign in again.","requestId":"888bb631-…"}}
# the token issued in step 5 now also returns 401

# 7. Rate limit — 4th request in the window
$ curl -X POST http://localhost:3000/api/v1/auth/otp/request \
    -H 'Content-Type: application/json' -H 'Accept-Language: en' -d '{"phone":"8888800002"}'
# HTTP 429, Retry-After: 900
{"error":{"code":"RATE_LIMITED","message":"Too many attempts. Please wait a little and try again.",
 "requestId":"fb3928a2-…","details":{"scope":"phone","retryAfterSeconds":900}}}
```

The per-IP limit was also confirmed the hard way: a second manual run in the same
window was blocked with `details.scope: "ip"` and `retryAfterSeconds: 858`.

### Not verified

- **CI going green.** No git remote, so the workflow has still never run. Its
  steps all pass locally, and the integration job now also carries `JWT_SECRET`,
  `AUTH_FIXED_OTP` and `SEED_ADMIN_PHONE`.
- **Graceful shutdown under a real signal** — unchanged from Phase 1; Windows
  cannot deliver a meaningful `SIGTERM`.
- **Timing side channel on OTP verify.** The "no pending OTP" path skips the HMAC,
  so it returns marginally sooner than the "wrong code" path. Microseconds under
  network jitter — noted, not addressed.

---

## Next steps — Phase 3 (customer profiles, addresses, technician profiles, categories)

**Ready to build on:**

- `users.name` is nullable and `isNewUser` is already returned by `/otp/verify`,
  so the client knows to route a first-time user into profile setup.
- `users.default_city_id` FK exists and is unused — Phase 3 sets it.
- `authenticate` + `requireRoles('technician')` are ready to guard provider routes.
- The `providers` and `customers` stubs are mounted and empty.
- PostGIS and `pg_trgm` have been enabled since Phase 1, so address points and
  fuzzy category search need no extension work.

**Phase 3 will need to decide:**

- Whether `categories` gets its own module folder or lives inside `providers/`.
- How a user gains the `technician` role — self-service application, or ops grant?
  The `user_roles` table supports both; there is no endpoint for either yet.
- Address storage: `geography(Point, 4326)` via raw SQL, since Prisma has no
  native PostGIS type — the Phase 1 decision to handle these with raw migrations
  and `$queryRaw` starts paying off here.

**Carried forward, still deliberately not built:** the transactional outbox and
dispatcher, object storage for verification documents, Razorpay/UPI, messaging
adapters, OpenAPI generation, session-listing endpoints, account deletion (DPDP,
Phase 14), and general-purpose rate limiting beyond the OTP endpoints.
