# API reference

Updated every phase. Phase 2 adds the auth module; the remaining `/api/v1/*`
routers are still empty until their phase.

**Base URL (local):** `http://localhost:3000`
**API prefix for domain modules:** `/api/v1`

---

## Conventions

### Request headers

| Header            | Required            | Meaning                                                                                                                      |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Authorization`   | on protected routes | `Bearer <accessToken>`                                                                                                       |
| `X-Request-Id`    | no                  | A trace id to correlate logs. Echoed back verbatim if it matches `[A-Za-z0-9._:-]{1,128}`; otherwise a UUID v4 is generated. |
| `Accept-Language` | no                  | `hi` or `en`, q-values honoured, region subtags ignored (`en-IN` → `en`). Defaults to **`hi`**.                              |

### Response headers

| Header             | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `X-Request-Id`     | The id for this request — always present. Quote it in bug reports. |
| `Content-Language` | The locale the response body was rendered in.                      |
| `Retry-After`      | Seconds to wait. Present on every `429`.                           |
| `WWW-Authenticate` | `Bearer`. Present on `401`.                                        |

### Error envelope

Every non-2xx response — from every endpoint, in every phase — has this shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "We could not find what you were looking for.",
    "requestId": "f3482340-216a-41ec-9f2f-5e90d27c0f34",
    "details": { "method": "GET", "path": "/nope" }
  }
}
```

- `code` — stable, machine-readable, never localised. Switch on this, not on `message`.
- `message` — localised via `Accept-Language`; safe to show to a user.
- `details` — optional. For validation failures it is an array of `{ field, message, code }`.
- `stack` — only ever present when `NODE_ENV !== production`.

Validation failure example (`400`):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some of the details you sent are not valid.",
    "requestId": "…",
    "details": [
      {
        "field": "phone",
        "message": "must be a valid 10-digit Indian mobile number",
        "code": "custom"
      }
    ]
  }
}
```

### Phones

Send a phone however the user typed it — `9876543210`, `+91 98765-43210`,
`09876543210`, `919876543210` all normalise to the same E.164 value. Responses
**always mask** it: `+9198765*****`. The full number never leaves the server.

### Money

All monetary values are **integers in paise**. Never floats, never rupees.

---

## Auth — `/api/v1/auth`

Phone number is identity. There is no password, and never will be.

The flow: request an OTP → verify it to get an access + refresh token pair → send
the access token as a Bearer token → rotate with `/refresh` when it expires.

### `POST /api/v1/auth/otp/request`

Generates a 6-digit OTP, stores only its HMAC in Redis with a 5-minute TTL, and
sends it via the configured transport. **The OTP is never in the response** — in
development it is written to the API log (`devOtp`); real SMS/WhatsApp delivery
arrives in Phase 10.

Rate limited: **3 per phone / 15 min** and **5 per IP / 15 min**.

```bash
curl -X POST http://localhost:3000/api/v1/auth/otp/request \
  -H 'Content-Type: application/json' \
  -H 'Accept-Language: en' \
  -d '{"phone":"99999 00077"}'
```

**`200 OK`**

```json
{
  "phone": "+9199999*****",
  "expiresInSeconds": 300,
  "message": "We have sent a 6-digit code to your phone. It is valid for 5 minutes."
}
```

| Status | Code               | When                                                                      |
| ------ | ------------------ | ------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR` | `phone` is not a valid Indian mobile number                               |
| `429`  | `RATE_LIMITED`     | Per-phone or per-IP budget exhausted. `details.scope` is `phone` or `ip`. |

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many attempts. Please wait a little and try again.",
    "requestId": "fb3928a2-97df-41e4-811c-8b9292f04063",
    "details": { "scope": "phone", "retryAfterSeconds": 900 }
  }
}
```

### `POST /api/v1/auth/otp/verify`

Verifies the OTP and issues a session. **Creates the account on first success**
with the `customer` role — there is no separate signup endpoint.

`deviceId` is a stable, client-generated string (8–128 chars of
`A-Za-z0-9._:-`). The refresh token is bound to it.

```bash
curl -X POST http://localhost:3000/api/v1/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+919999900077","otp":"000000","deviceId":"demo-device-0001"}'
```

**`200 OK`**

```json
{
  "tokenType": "Bearer",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlcyI6WyJjdXN0b21lciJd…",
  "expiresIn": 900,
  "refreshToken": "L4r_4oeBZDJhrqMwb5tpdYqxEZCspxFPCQbS4TNHkv0",
  "refreshExpiresAt": "2026-09-14T11:04:11.319Z",
  "user": {
    "id": "5210c8e3-ff35-4287-bc8c-bd9c185b3dd2",
    "phone": "+9199999*****",
    "name": null,
    "roles": ["customer"],
    "status": "active",
    "defaultCityId": null,
    "createdAt": "2026-08-15T11:04:11.310Z"
  },
  "isNewUser": true,
  "message": "Signed in successfully."
}
```

`isNewUser` tells a client whether to send the user into profile setup.

| Status | Code               | When                                                              |
| ------ | ------------------ | ----------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR` | Bad phone, OTP not 6 digits, missing/invalid `deviceId`           |
| `401`  | `OTP_INVALID`      | Wrong code **or** no pending OTP — deliberately identical         |
| `403`  | `ACCOUNT_BLOCKED`  | The account exists but is blocked                                 |
| `429`  | `RATE_LIMITED`     | 5 wrong attempts; the OTP is invalidated and must be re-requested |

> **On purpose:** a wrong code and a phone with no pending OTP return the exact
> same status, code and message. Any difference would be an oracle for which
> numbers have a live OTP.

### `GET /api/v1/auth/me`

The current user. Requires a Bearer access token.

```bash
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**`200 OK`**

```json
{
  "user": {
    "id": "5210c8e3-ff35-4287-bc8c-bd9c185b3dd2",
    "phone": "+9199999*****",
    "name": null,
    "roles": ["customer"],
    "status": "active",
    "defaultCityId": null,
    "createdAt": "2026-08-15T11:04:11.310Z"
  },
  "deviceId": "demo-device-0001"
}
```

| Status | Code                 | When                                                                      |
| ------ | -------------------- | ------------------------------------------------------------------------- |
| `401`  | `AUTH_TOKEN_MISSING` | No `Authorization: Bearer …` header                                       |
| `401`  | `AUTH_TOKEN_EXPIRED` | Signature is good but the token has expired — **refresh and retry**       |
| `401`  | `AUTH_TOKEN_INVALID` | Malformed, tampered, wrong issuer, or wrong signature — **sign in again** |
| `403`  | `ACCOUNT_BLOCKED`    | Account blocked since the token was issued                                |

Expired and invalid are separate codes precisely so a client knows which of those
two things to do.

### `POST /api/v1/auth/refresh`

Exchanges a refresh token for a **new pair**. The presented token is retired and
linked to its successor, forming an auditable rotation chain.

**Reuse detection:** presenting an already-rotated token is treated as theft —
every token for that `(user, device)` is revoked immediately and a security
warning is logged. Both the thief and the real user are signed out of that device.

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"L4r_4oeBZDJhrqMwb5tpdYqxEZCspxFPCQbS4TNHkv0","deviceId":"demo-device-0001"}'
```

**`200 OK`** — same body as `/otp/verify`, minus `isNewUser`. Both the access and
refresh tokens change on every call.

| Status | Code                    | When                                                           |
| ------ | ----------------------- | -------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR`      | Missing or malformed `refreshToken` / `deviceId`               |
| `401`  | `REFRESH_TOKEN_INVALID` | Unknown, expired, revoked, wrong device, **or reuse detected** |
| `403`  | `ACCOUNT_BLOCKED`       | Account blocked                                                |

All the 401 causes share one code and message — distinguishing them would tell an
attacker which of their guesses was closest.

### `POST /api/v1/auth/logout`

Revokes the presented refresh token. **Idempotent** — an unknown or
already-revoked token still returns `200`, so logout cannot be used to probe
which tokens exist. The access token remains valid until it expires (≤15 min).

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"…"}'
```

**`200 OK`** → `{ "message": "Signed out successfully." }`

### `GET /api/v1/auth/admin-only`

Demo route proving the `requireRoles` guard. Delete it when real admin endpoints
land in Phase 11.

```bash
curl http://localhost:3000/api/v1/auth/admin-only \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Accept-Language: en'
```

**`403 Forbidden`** for a customer:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to do this.",
    "requestId": "ec882474-1b65-4f58-8dc5-50ef789674ef",
    "details": { "requiredRoles": ["admin"] }
  }
}
```

**`200 OK`** for an admin: `{ "ok": true, "roles": ["admin", "ops"] }`

### Roles

`customer` · `technician` · `ops` · `admin`. A user may hold several. Roles are
baked into the access token, so **a role change only takes effect on the next
token** — sign in again or refresh.

### Tokens at a glance

|                    | Access token                                           | Refresh token                             |
| ------------------ | ------------------------------------------------------ | ----------------------------------------- |
| Format             | JWT, HS256, unique `jti`                               | Opaque 43-char random string              |
| Lifetime           | 15 min (`JWT_ACCESS_TTL_SECONDS`)                      | 30 days (`REFRESH_TOKEN_TTL_DAYS`)        |
| Stored server-side | No — stateless                                         | Yes, SHA-256 hash only                    |
| Payload            | `sub`, `roles`, `deviceId`, `iss`, `iat`, `exp`, `jti` | n/a                                       |
| Revocable          | No, expires naturally                                  | Yes — rotation, logout, or theft response |

---

## `GET /health`

Liveness + dependency readiness. Actually pings Postgres and Redis on every
call — never cached — with a 2 s timeout per check.

Unauthenticated. Not under `/api/v1`.

| Code  | When                                                                 |
| ----- | -------------------------------------------------------------------- |
| `200` | Both dependency checks returned `ok`.                                |
| `503` | Either check returned `fail`. Same shape, with `status: "degraded"`. |

```bash
curl -i http://localhost:3000/health
```

```
X-Request-Id: ed0dc8b7-10f6-4391-9794-3d7ba9623953
Content-Language: hi
```

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

> `app` echoes the `APP_NAME` env var. It is not a brand name — change the env
> var and this field follows.

**`503 Service Unavailable`** (Redis stopped):

```json
{
  "status": "degraded",
  "app": "fixbridge",
  "version": "0.1.0",
  "uptime": 32.837,
  "checks": { "postgres": "ok", "redis": "fail" },
  "message": "Service is running with degraded dependencies."
}
```

| Field             | Type                 | Notes                             |
| ----------------- | -------------------- | --------------------------------- |
| `status`          | `"ok" \| "degraded"` | `degraded` when any check failed. |
| `app`             | string               | Value of `APP_NAME`.              |
| `version`         | string               | `apps/api/package.json` version.  |
| `uptime`          | number               | Process uptime in seconds, 3 dp.  |
| `checks.postgres` | `"ok" \| "fail"`     | Result of `SELECT 1`.             |
| `checks.redis`    | `"ok" \| "fail"`     | Result of `PING`.                 |
| `message`         | string               | Localised summary.                |

---

## Mounted but empty (later phases)

These prefixes resolve to registered routers with no handlers yet, so any path
under them returns the standard `404 NOT_FOUND` envelope. Listed here so the URL
space is reserved and visible.

| Prefix                  | Phase | Will contain                                               |
| ----------------------- | ----- | ---------------------------------------------------------- |
| `/api/v1/customers`     | 3     | customer profiles, saved addresses                         |
| `/api/v1/providers`     | 3     | technician profiles, category tree, availability templates |
| `/api/v1/verification`  | 4     | document checks, badges, trust score                       |
| `/api/v1/search`        | 5     | PostGIS nearby search, distance/rating/badge ranking       |
| `/api/v1/bookings`      | 6     | slots, booking lifecycle, start/end OTP handshake          |
| `/api/v1/quotations`    | 7     | itemised quotations, in-app approval                       |
| `/api/v1/payments`      | 8     | UPI collection, logged cash                                |
| `/api/v1/reviews`       | 9     | two-way ratings                                            |
| `/api/v1/notifications` | 10    | SMS / WhatsApp / push adapters                             |
| `/api/v1/admin`         | 11    | admin console API                                          |
