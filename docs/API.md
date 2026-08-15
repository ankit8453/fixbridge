# API reference

Updated every phase. Phase 1 ships one live endpoint; the `/api/v1/*` module
routers exist but are empty until their phase.

**Base URL (local):** `http://localhost:3000`
**API prefix for domain modules:** `/api/v1`

---

## Conventions

### Request headers

| Header            | Required | Meaning                                                                                                                      |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `X-Request-Id`    | no       | A trace id to correlate logs. Echoed back verbatim if it matches `[A-Za-z0-9._:-]{1,128}`; otherwise a UUID v4 is generated. |
| `Accept-Language` | no       | `hi` or `en`, q-values honoured, region subtags ignored (`en-IN` → `en`). Defaults to **`hi`**.                              |

### Response headers

| Header             | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `X-Request-Id`     | The id for this request — always present. Quote it in bug reports. |
| `Content-Language` | The locale the response body was rendered in.                      |

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

- `code` — stable, machine-readable, never localised.
- `message` — localised via `Accept-Language`; safe to show to a user.
- `details` — optional. For validation failures it is an array of
  `{ field, message, code }`.
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
        "message": "Too small: expected string to have >=10 characters",
        "code": "too_small"
      }
    ]
  }
}
```

### Money

All monetary values are **integers in paise**. Never floats, never rupees.

---

## Endpoints

### `GET /health`

Liveness + dependency readiness. Actually pings Postgres and Redis on every
call — never cached — with a 2 s timeout per check.

Unauthenticated. Not under `/api/v1`.

**Status codes**

| Code  | When                                                                             |
| ----- | -------------------------------------------------------------------------------- |
| `200` | Both dependency checks returned `ok`.                                            |
| `503` | Either check returned `fail`. Body is the same shape, with `status: "degraded"`. |

**Request**

```bash
curl -i http://localhost:3000/health
```

**Response — `200 OK`**

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

**Response — `503 Service Unavailable`** (Redis stopped)

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

**With an explicit locale and trace id**

```bash
curl -s http://localhost:3000/health \
  -H 'Accept-Language: en-IN,en;q=0.9' \
  -H 'X-Request-Id: trace-abc-123'
```

```json
{
  "status": "ok",
  "app": "fixbridge",
  "version": "0.1.0",
  "uptime": 14.579,
  "checks": { "postgres": "ok", "redis": "ok" },
  "message": "Service is running normally."
}
```

**Fields**

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

| Prefix                  | Phase | Will contain                                         |
| ----------------------- | ----- | ---------------------------------------------------- |
| `/api/v1/auth`          | 2     | OTP login, JWT issuing, role guards                  |
| `/api/v1/customers`     | 3     | customer profiles, saved addresses                   |
| `/api/v1/providers`     | 4     | technician onboarding, skills, service areas         |
| `/api/v1/verification`  | 5     | document checks, badges, trust score                 |
| `/api/v1/search`        | 6     | PostGIS nearby search, distance/rating/badge ranking |
| `/api/v1/bookings`      | 7     | slots, booking lifecycle, start/end OTP handshake    |
| `/api/v1/quotations`    | 8     | itemised quotations, in-app approval                 |
| `/api/v1/payments`      | 9     | UPI collection, logged cash                          |
| `/api/v1/reviews`       | 10    | two-way ratings                                      |
| `/api/v1/notifications` | 10    | SMS / WhatsApp / push adapters                       |
| `/api/v1/admin`         | 11    | admin console API                                    |

Phase numbers for 2, 11 and 12–13 are fixed; 3–10 are a provisional split — see
[phase01-summary.md](summaries/phase01-summary.md).
