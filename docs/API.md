# API reference

Updated every phase. Live so far: `auth` (Phase 2), `categories`, `customers`
and `providers` (Phase 3), `verification` (Phase 4), `search` (Phase 5),
`bookings` (Phase 6) and `quotations` (Phase 7). The remaining `/api/v1/*`
routers are mounted but empty until their phase.

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
development it is written to the API log (`devOtp`); real WhatsApp delivery
arrives in Phase 10.

Rate limited: **5 per phone / 15 min**, **30 per IP / 15 min**, and a
**60-second cooldown** between requests for the same phone.

> The per-IP cap is deliberately loose. Indian mobile carriers put large numbers
> of subscribers behind one public IP (CGNAT), so a tight cap locks out
> strangers. The per-phone cap does the real work, and the cooldown absorbs the
> common case — an impatient user tapping resend while the carrier sits on the
> first message.

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

| Status | Code               | When                                                                                  |
| ------ | ------------------ | ------------------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR` | `phone` is not a valid Indian mobile number                                           |
| `429`  | `RATE_LIMITED`     | Budget exhausted, or resent too soon. `details.scope` is `phone`, `ip` or `cooldown`. |

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

| Status | Code                   | When                                                                         |
| ------ | ---------------------- | ---------------------------------------------------------------------------- |
| `401`  | `AUTH_TOKEN_MISSING`   | No `Authorization: Bearer …` header                                          |
| `401`  | `AUTH_SESSION_REVOKED` | The account was blocked — the token stops working immediately, not at expiry |
| `401`  | `AUTH_TOKEN_EXPIRED`   | Signature is good but the token has expired — **refresh and retry**          |
| `401`  | `AUTH_TOKEN_INVALID`   | Malformed, tampered, wrong issuer, or wrong signature — **sign in again**    |
| `403`  | `ACCOUNT_BLOCKED`      | Account blocked since the token was issued                                   |

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

## Categories — `/api/v1/categories`

The service taxonomy: two levels, cluster → service. Names are **i18n keys**, not
stored display text, so the same rows render in Hindi or English.

### `GET /api/v1/categories`

Public and unauthenticated — an app shows the taxonomy before anyone signs in.

| Query param | Default        | Meaning                              |
| ----------- | -------------- | ------------------------------------ |
| `cityId`    | `1` (Jabalpur) | Only categories offered in that city |

```bash
curl 'http://localhost:3000/api/v1/categories?cityId=1' -H 'Accept-Language: en'
```

**`200 OK`**

```json
{
  "cityId": 1,
  "categories": [
    {
      "id": 1,
      "slug": "electrical",
      "name": "Electrical",
      "nameKey": "categories.electrical",
      "icon": "bolt",
      "sortOrder": 1,
      "children": [
        {
          "id": 6,
          "slug": "house-wiring",
          "name": "House wiring & repair",
          "nameKey": "categories.houseWiring",
          "icon": null,
          "sortOrder": 1,
          "children": []
        }
      ]
    }
  ]
}
```

The same call without `Accept-Language` returns `"बिजली का काम"` and
`"घर की वायरिंग और मरम्मत"`. `nameKey` is always included so a client can
re-localise offline.

Inactive categories are omitted, and deactivating a cluster hides its services
too. Only clusters appear at the top level; `children` is always present and is
empty for a service. An unknown `cityId` returns an empty list, not a 404.

**Launch taxonomy:** Electrical · Motors & Generators · Plumbing · Cooling &
Appliances · Mechanics — 5 clusters, 20 services.

---

## Customers — `/api/v1/customers`

Authenticated, role `customer`. Every route is `/me`-scoped and every query is
filtered by the caller's own id, so one user's rows are invisible to another.

### `GET /api/v1/customers/me`

**`200 OK`** — `profile` is `null` until the first write. That is not an error;
it is how a client knows to open the setup screen.

```json
{ "profile": null }
```

### `PATCH /api/v1/customers/me`

Creates the profile lazily on first call.

```bash
curl -X PATCH http://localhost:3000/api/v1/customers/me \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"displayName":"Asha Verma","email":"asha@example.com"}'
```

```json
{
  "profile": {
    "userId": "…",
    "displayName": "Asha Verma",
    "email": "asha@example.com",
    "createdAt": "2026-08-15T11:40:00.000Z",
    "updatedAt": "2026-08-15T11:40:00.000Z"
  },
  "message": "Your profile has been saved."
}
```

Send `"email": null` to clear it; omit the key to leave it alone.

### Addresses

Landmark-driven, because that is how a tier-2 address works. Maximum **5** per
user (`MAX_ADDRESSES_PER_USER`).

| Method   | Path                               | Notes                            |
| -------- | ---------------------------------- | -------------------------------- |
| `GET`    | `/me/addresses`                    | Default first, then oldest first |
| `POST`   | `/me/addresses`                    | `201`                            |
| `GET`    | `/me/addresses/:addressId`         |                                  |
| `PATCH`  | `/me/addresses/:addressId`         |                                  |
| `DELETE` | `/me/addresses/:addressId`         |                                  |
| `POST`   | `/me/addresses/:addressId/default` | Promote to default               |

**Create**

```bash
curl -X POST http://localhost:3000/api/v1/customers/me/addresses \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{
        "label": "home",
        "addressText": "212 Shastri Nagar, Wright Town",
        "landmark": "Behind Gupta Kirana"
      }'
```

**`201 Created`**

```json
{
  "address": {
    "id": "…",
    "label": "home",
    "labelText": null,
    "addressText": "212 Shastri Nagar, Wright Town",
    "landmark": "Behind Gupta Kirana",
    "cityId": 1,
    "location": { "lat": 23.201434, "lng": 79.913882 },
    "isDefault": true,
    "createdAt": "…",
    "updatedAt": "…"
  },
  "message": "Address saved."
}
```

**Coordinates.** `lat`/`lng` are optional. Send them when the client has GPS;
otherwise the address text and landmark are geocoded and a point is stored
anyway — an address without coordinates does not exist in this system. They must
be sent **together**; one alone is a `400`.

On `PATCH`, changing `addressText` or `landmark` **re-geocodes** unless you send
fresh coordinates, so the pin cannot drift away from the text.

**Defaults.** The first address saved becomes the default automatically. Exactly
one default per user is enforced by a database index, and deleting the default
promotes the oldest remaining address.

| Status | Code                    | When                                       |
| ------ | ----------------------- | ------------------------------------------ |
| `400`  | `VALIDATION_ERROR`      | Bad body, or only one of `lat`/`lng`       |
| `400`  | `BAD_REQUEST`           | Coordinates are not a real point           |
| `403`  | `FORBIDDEN`             | Caller lacks the `customer` role           |
| `404`  | `ADDRESS_NOT_FOUND`     | Unknown id — **or someone else's address** |
| `409`  | `ADDRESS_LIMIT_REACHED` | Already at the cap                         |

> Another user's address returns `404`, never `403`. Confirming that a row exists
> is already a leak.

---

## Providers — `/api/v1/providers`

Technicians managing their own profile. All routes require the `technician`
role, except `register`, which is how you get it.

### `POST /api/v1/providers/me/register`

Any authenticated user. Grants the `technician` role and opens an empty profile.
Idempotent — a second call returns `200` with `alreadyRegistered: true`.

```bash
curl -X POST http://localhost:3000/api/v1/providers/me/register \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"displayName":"Ramesh Vishwakarma"}'
```

> Roles are baked into the access token, so **sign in again (or refresh) after
> registering** — the old token does not carry `technician`.

Registering does not make anyone bookable. Completeness gates listing; Phase 4
verification gates trust.

### `GET /api/v1/providers/me`

Returns the whole profile plus the completeness breakdown that drives the
onboarding checklist.

```json
{
  "profile": {
    "userId": "…",
    "displayName": "Ramesh Vishwakarma",
    "bio": null,
    "yearsExperience": 12,
    "cityId": 1,
    "baseLocation": { "lat": 23.1618, "lng": 79.9492 },
    "serviceRadiusKm": 8,
    "assistedOnboarding": false,
    "isListed": true,
    "completeness": {
      "score": 100,
      "threshold": 80,
      "isListed": true,
      "missing": [],
      "missingRequired": [],
      "breakdown": [
        { "item": "baseLocation", "weight": 20, "required": true, "satisfied": true },
        { "item": "skills", "weight": 20, "required": true, "satisfied": true },
        { "item": "priceCard", "weight": 20, "required": true, "satisfied": true },
        { "item": "availability", "weight": 20, "required": true, "satisfied": true },
        { "item": "displayName", "weight": 10, "required": true, "satisfied": true },
        { "item": "yearsExperience", "weight": 5, "required": false, "satisfied": true },
        { "item": "photoDocument", "weight": 5, "required": false, "satisfied": true }
      ]
    },
    "skills": [
      {
        "categoryId": 6,
        "categorySlug": "house-wiring",
        "categoryName": "House wiring & repair",
        "experienceNote": null
      }
    ],
    "priceCards": [
      {
        "id": "…",
        "categoryId": 6,
        "categoryName": "House wiring & repair",
        "title": "House wiring per point",
        "priceType": "fixed",
        "amountPaise": 18000,
        "isActive": true
      }
    ],
    "availability": [
      { "id": "…", "dayOfWeek": 1, "startTime": "09:00", "endTime": "19:00", "isActive": true }
    ],
    "documents": [
      { "id": "…", "docType": "photo", "storageKey": "…", "status": "pending", "createdAt": "…" }
    ],
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

**Every mutating endpoint below returns this same `profile` object**, rescored,
so a client never has to re-fetch to find out whether it just went live.

### Completeness and listing

`is_listed` decides whether a technician appears in search (Phase 5). It is
recomputed on **every** write that touches the profile or its children.

Two independent mechanisms, and both must pass:

```
isListed = user is active
           AND missingRequired is empty        ← the hard gate
           AND score >= PROVIDER_LISTING_THRESHOLD
```

| Checklist item             | Weight | Required |
| -------------------------- | ------ | -------- |
| `baseLocation`             | 20     | ✅       |
| `skills` (≥1)              | 20     | ✅       |
| `priceCard` (≥1 active)    | 20     | ✅       |
| `availability` (≥1 active) | 20     | ✅       |
| `displayName`              | 10     | ✅       |
| `yearsExperience`          | 5      | —        |
| `photoDocument`            | 5      | —        |

**The five required items are a hard gate.** Missing any one delists the profile
outright, whatever the score says. Without a name there is nothing to show in
search; without a location nobody can find them; without a skill nobody knows
what they do; without a price nobody knows the cost; without availability nobody
can book.

**`score` is a progress indicator, not permission.** Count down
`missingRequired` to tell a technician what stands between them and going live;
use `score` for the progress bar.

At the default threshold of 80 the score does not bind on its own — satisfying
every required item already scores 90. That is intended: the gate is the floor,
and the threshold is the knob for demanding more later. Raise it past 90 and the
optional items stop being optional in practice.

Blocking a user delists them regardless of everything above.

### `PATCH /api/v1/providers/me`

```bash
curl -X PATCH http://localhost:3000/api/v1/providers/me \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{
        "displayName": "Ramesh Vishwakarma",
        "yearsExperience": 12,
        "serviceRadiusKm": 8,
        "baseLocation": { "lat": 23.1618, "lng": 79.9492 }
      }'
```

`serviceRadiusKm` is 1–25. `bio` and `yearsExperience` accept `null` to clear.

### Skills

Leaf categories only — a technician does "motor rewinding", not "Electrical".

| Method   | Path                                             |
| -------- | ------------------------------------------------ |
| `POST`   | `/me/skills` — `{ categoryId, experienceNote? }` |
| `DELETE` | `/me/skills/:categoryId`                         |

| Status | Code                     | When                             |
| ------ | ------------------------ | -------------------------------- |
| `400`  | `CATEGORY_NOT_A_SERVICE` | You passed a cluster             |
| `400`  | `CATEGORY_WRONG_CITY`    | Category belongs to another city |
| `404`  | `CATEGORY_NOT_FOUND`     | Unknown or inactive              |

### Price cards

Money is **integer paise**, always.

| Method   | Path                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| `POST`   | `/me/price-cards` — `{ categoryId, title, priceType, amountPaise?, isActive? }` |
| `PATCH`  | `/me/price-cards/:id`                                                           |
| `DELETE` | `/me/price-cards/:id`                                                           |

| `priceType`        | `amountPaise`                                              |
| ------------------ | ---------------------------------------------------------- |
| `fixed`            | **required**                                               |
| `starting_from`    | **required**                                               |
| `inspection_based` | **must be omitted** — the price is not knowable in advance |

Mismatches are a `400` with a field-level detail; a database CHECK backs the same
rule up.

### Availability

Recurring weekly windows. Phase 6 expands these into bookable slots.

| Method   | Path                                                                |
| -------- | ------------------------------------------------------------------- |
| `POST`   | `/me/availability` — `{ dayOfWeek, startTime, endTime, isActive? }` |
| `PATCH`  | `/me/availability/:id`                                              |
| `DELETE` | `/me/availability/:id`                                              |

- `dayOfWeek`: `0` = Sunday … `6` = Saturday.
- `startTime` / `endTime`: `"HH:MM"`, 24-hour.
- Multiple windows per day are fine, and back-to-back windows (`09:00–13:00`
  then `13:00–17:00`) are **not** an overlap.

```bash
curl -X POST http://localhost:3000/api/v1/providers/me/availability \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"dayOfWeek":1,"startTime":"18:00","endTime":"22:00"}'
```

| Status | Code                   | When                                                            |
| ------ | ---------------------- | --------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR`     | `startTime`/`endTime` not `HH:MM`, `dayOfWeek` outside 0–6      |
| `400`  | `BAD_REQUEST`          | `endTime` at or before `startTime`                              |
| `409`  | `AVAILABILITY_OVERLAP` | Clashes with an active window; `details.conflictsWith` names it |

> **v1 limitation: no overnight windows.** `22:00–02:00` is rejected. Enter it as
> two windows on two days. Enforced in code and by a database CHECK.

### Documents

**Metadata only.** File upload and review arrive in Phase 4; this records that a
document is meant to exist and where it will live.

| Method   | Path                                        |
| -------- | ------------------------------------------- |
| `POST`   | `/me/documents` — `{ docType, storageKey }` |
| `DELETE` | `/me/documents/:id`                         |

`docType`: `id_proof` · `certificate` · `photo` · `other`. `status` is always
`pending` in Phase 3. A `photo` document is one of the completeness items.

---

## Search — `/api/v1/search`

**Public. No authentication.** A customer chooses a technician before they sign
in. Rate limited to **30 requests per minute per IP** on both routes.

Design rationale, the ranking formula and the query plan are in
[search.md](search.md).

### `GET /api/v1/search/providers`

> **Only trustworthy supply is ever returned:** `is_listed = true` (profile
> complete) **and** `badge >= VERIFIED` **and** the account is active. No
> parameter relaxes those gates.

| Query param                      | Required | Meaning                                                             |
| -------------------------------- | -------- | ------------------------------------------------------------------- |
| `lat`, `lng`                     | ✅       | The customer's location                                             |
| `city_id`                        | —        | Defaults to `1` (Jabalpur)                                          |
| `category_id`                    | —        | Leaf = that service; **cluster = every service beneath it**         |
| `date`, `start_time`, `end_time` | —        | All three together or none                                          |
| `max_distance_km`                | —        | Customer cap, ≤ 25, applied **on top of** the provider's own radius |
| `sort`                           | —        | `rank` (default) · `distance` · `price_low`                         |
| `page`, `page_size`              | —        | Default `1` / `10`, max page size 25                                |

```bash
curl 'http://localhost:3000/api/v1/search/providers?lat=23.1618&lng=79.9492&page_size=2' \
  -H 'Accept-Language: en'
```

**`200 OK`**

```json
{
  "results": [
    {
      "providerId": "195e4019-d1a9-4ea6-bac9-3b4945bdc1c6",
      "displayName": "Ramesh Vishwakarma",
      "badge": "VERIFIED",
      "yearsExperience": 18,
      "distanceKm": 0,
      "skills": [
        { "categoryId": 2, "slug": "house-wiring", "name": "House wiring & repair" },
        { "categoryId": 5, "slug": "switchboard-mcb", "name": "Switchboard & MCB" }
      ],
      "startingPrice": { "amountPaise": 18000, "display": "₹180" },
      "nextAvailability": { "dayOfWeek": 1, "startTime": "09:00", "endTime": "19:00" },
      "locality": "nearby"
    }
  ],
  "page": 1,
  "pageSize": 2,
  "total": 12,
  "truncated": false,
  "sort": "rank",
  "query": { "cityId": 1, "categoryId": null, "maxDistanceKm": null, "availability": null }
}
```

**Never in a result card:** the provider's coordinates, their phone, or any
completeness internals. `distanceKm` is rounded to 0.1 km — precise enough to
choose by, too coarse to locate someone's home. `truncated` is true when more
matched than the ranking candidate cap (200).

**Radius is the provider's own.** Each technician declared `service_radius_km`;
a customer matches when they fall inside _that_ radius. `max_distance_km` only
narrows it further and can never widen it.

**Availability is checked against real open slots.** The `date` is read as an
IST calendar day, and a technician matches only if they have an `open` slot that
**fully covers** the requested window — a slot 18:00–19:00 does not satisfy a
19:00–21:00 request, and an hour somebody has already booked is not availability.
(Phase 5 matched weekly templates and documented the gap; Phase 6 closed it.)

| Status | Code               | When                                                                                             |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------ |
| `400`  | `VALIDATION_ERROR` | Missing `lat`/`lng`, partial availability trio, `end_time <= start_time`, `max_distance_km > 25` |
| `429`  | `RATE_LIMITED`     | Over 30 requests/minute from this IP                                                             |

### `GET /api/v1/search/resolve`

Free text — in Hindi, English or Hinglish — to category suggestions. The app
calls this as the customer types, then fires `/providers` with the chosen
`category_id`.

| Query param | Required | Meaning                              |
| ----------- | -------- | ------------------------------------ |
| `q`         | ✅       | What the customer typed, 1–120 chars |
| `city_id`   | —        | Defaults to `1`                      |
| `limit`     | —        | Default 8, max 20                    |

```bash
curl 'http://localhost:3000/api/v1/search/resolve?q=motor%20jal%20gayi' \
  -H 'Accept-Language: en'
```

**`200 OK`**

```json
{
  "query": "motor jal gayi",
  "normalizedQuery": "motor jal gayi",
  "suggestions": [
    {
      "categoryId": 8,
      "slug": "motor-rewinding",
      "name": "Motor rewinding",
      "nameKey": "categories.motorRewinding",
      "parentId": 7,
      "matchReason": "synonym_exact",
      "confidence": 1,
      "matchedTerm": "motor jal gayi"
    }
  ]
}
```

`matchReason` is `synonym_exact` · `synonym_prefix` · `synonym_fuzzy` ·
`category_name` — the app can render a fuzzy hit as "did you mean…".

All of these resolve to the same category: `motor jal gayi` · `मोटर जल गई` ·
`MOTOR JAL GAYI` · `moter jal gai` (misspelling, via trigram). Nonsense returns
an empty `suggestions` array with `200`, not an error.

---

## Verification — `/api/v1/verification` and `/api/v1/admin/verification`

The trust half of the product. Design rationale, the state machine and the
append-only guarantee live in [verification.md](verification.md); this is the
wire contract.

Four independent levels: **0** identity · **1** background · **2** skill ·
**3** references. Passing all four earns the badge `VERIFIED`.

> **Never send a full identity number.** Only the last 4 digits are accepted, and
> any field that looks like a complete one is rejected outright.

### Documents

The API never handles file bytes. Ask for a URL, upload straight to storage,
then confirm.

#### `POST /api/v1/verification/documents/upload-url`

Role `technician`.

```bash
curl -X POST http://localhost:3000/api/v1/verification/documents/upload-url \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"docType":"id_proof","contentType":"image/png","sizeBytes":10240}'
```

`docType`: `id_proof` · `certificate` · `photo` · `other`.
`contentType`: `image/jpeg` · `image/png` · `image/webp` · `application/pdf`.

**`201 Created`**

```json
{
  "document": {
    "id": "…",
    "docType": "id_proof",
    "status": "awaiting_upload",
    "contentType": "image/png",
    "sizeBytes": 10240,
    "uploadedAt": null,
    "createdAt": "…"
  },
  "upload": {
    "url": "http://localhost:9000/fixbridge-kyc/kyc/…?X-Amz-Signature=…",
    "requiredHeaders": { "Content-Type": "image/png", "Content-Length": "10240" },
    "expiresInSeconds": 300
  },
  "message": "Ready to upload."
}
```

> `sizeBytes` is **signed into the URL**, so storage rejects a body of any other
> size. Send `requiredHeaders` verbatim on the PUT or the signature will not
> match. A pre-signed PUT cannot express "at most N bytes" — see
> [verification.md](verification.md#documents-and-object-storage).

| Status | When                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| `400`  | Unsupported content type, or `sizeBytes` above `STORAGE_MAX_UPLOAD_BYTES` (10 MB) |
| `403`  | Caller is not a technician                                                        |

#### `POST /api/v1/verification/documents/:documentId/confirm`

Verifies the object really exists and records its **real** size.

**`200 OK`** → the document with `status: "uploaded"` and an `uploadedAt`.
Idempotent. `409 UPLOAD_NOT_FOUND` if nothing was uploaded.

#### `GET /api/v1/verification/documents`

Own documents only.

#### `GET /api/v1/verification/documents/:documentId/download-url`

**`200 OK`** → `{ "url": "…", "expiresInSeconds": 300 }`. Expires for real.

### Submitting a level

#### `POST /api/v1/verification/levels/:level/submit`

Role `technician`. The body is validated by that level's own schema.

| Level | Body                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------- |
| `0`   | `{ idType, idLast4, idProofDocumentId, selfieDocumentId }`                                           |
| `1`   | `{ consent: true }`                                                                                  |
| `2`   | `{ certificateDocumentId }` **or** `{ tradeTest: true, notes }` **or** `{ fieldAudit: true, notes }` |
| `3`   | `{ references: [{ name, phone, relationship }, { … }] }` — exactly 2, distinct                       |

`idType`: `aadhaar` · `pan` · `dl` · `voter`. `idLast4` is exactly 4 digits.
`relationship`: `past_employer` · `shop_owner` · `senior_technician` · `other`.

```bash
curl -X POST http://localhost:3000/api/v1/verification/levels/0/submit \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"idType":"aadhaar","idLast4":"4321",
       "idProofDocumentId":"…","selfieDocumentId":"…"}'
```

**`201 Created`** → the new case with its `submitted` event.

| Status | Code                        | When                                                                      |
| ------ | --------------------------- | ------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR`          | Body fails the level's schema                                             |
| `400`  | `BAD_REQUEST`               | Documents missing or not uploaded, or a field looks like a full ID number |
| `409`  | `VERIFICATION_ALREADY_OPEN` | That level already has a live case                                        |

Levels are independent — 0 and 2 can be open at once. Retrying a **failed** level
opens a new case; the old one stays closed forever.

### `GET /api/v1/verification/cases`

Own cases plus the badge summary.

```json
{
  "cases": [
    {
      "id": "…",
      "level": 0,
      "levelName": "identity",
      "status": "needs_info",
      "openedAt": "…",
      "closedAt": null,
      "events": [
        {
          "id": "…",
          "eventType": "submitted",
          "actorType": "provider",
          "notes": null,
          "payload": { "idType": "aadhaar", "idLast4": "4321" },
          "createdAt": "…"
        }
      ]
    }
  ],
  "summary": {
    "badge": "NONE",
    "badgeSince": null,
    "levelsPassed": [1, 2],
    "levelsRemaining": [0, 3]
  }
}
```

> **`notes` is always `null` in a provider's view.** Ops notes are internal.
> Reference phone numbers are masked here too (`+9198123*****`) — ops see them in
> full because they have to ring them.

`status`: `submitted` · `in_review` · `needs_info` · `passed` · `failed`.

### `GET /api/v1/verification/cases/:caseId`

One case. `404` for a case belonging to someone else — identical to a missing one.

### `POST /api/v1/verification/cases/:caseId/info`

Answers an ops request. Only valid from `needs_info`; moves the case back to
`in_review`.

```bash
curl -X POST http://localhost:3000/api/v1/verification/cases/$CASE/info \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"notes":"Re-uploaded in daylight.","documentIds":["…"]}'
```

`409 VERIFICATION_INVALID_TRANSITION` from any other state.

---

### Ops — `/api/v1/admin/verification`

Roles `ops` or `admin`. Technicians and customers get `403`.

#### `GET /api/v1/admin/verification/queue`

Paginated, **oldest first** — a queue sorted newest-first starves whoever has
waited longest.

| Query               | Default         | Meaning             |
| ------------------- | --------------- | ------------------- |
| `status`            | open cases only | Exact status filter |
| `level`             | all             | `0`–`3`             |
| `cityId`            | all             | Provider's city     |
| `page` / `pageSize` | `1` / `20`      | Max page size 100   |

```json
{
  "cases": [
    {
      "caseId": "…",
      "providerId": "…",
      "providerName": "Ramesh Vishwakarma",
      "cityId": 1,
      "level": 0,
      "status": "submitted",
      "openedAt": "…"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 37
}
```

#### `GET /api/v1/admin/verification/cases/:caseId`

Full detail: the case with **unredacted** events and notes, the provider, the
badge summary, and every uploaded document with a **5-minute signed URL**.

> **Opening this writes a `kyc_access_logs` row** naming the reviewer and the
> documents whose URLs were issued. Ops reads are reconstructable, not just ops
> decisions.

#### `POST /api/v1/admin/verification/cases/:caseId/review`

Moves `submitted → in_review`. Records who picked it up.

#### `POST /api/v1/admin/verification/cases/:caseId/decide`

```bash
curl -X POST http://localhost:3000/api/v1/admin/verification/cases/$CASE/decide \
  -H "Authorization: Bearer $OPS" -H 'Content-Type: application/json' \
  -d '{"decision":"request_info","notes":"The selfie is too dark to compare."}'
```

| `decision`     | Notes        | Result                                                   |
| -------------- | ------------ | -------------------------------------------------------- |
| `pass`         | optional     | Terminal. Badge recomputed.                              |
| `fail`         | **required** | Terminal. Badge recomputed — **downgrades immediately**. |
| `request_info` | **required** | → `needs_info`                                           |

**`200 OK`** returns the case and, for terminal decisions, the recomputed summary:

```json
{
  "case": { "…": "…" },
  "summary": { "badge": "NONE", "badgeSince": null, "levelsPassed": [0, 2, 3] },
  "message": "Decision saved."
}
```

| Status | Code                              | When                                |
| ------ | --------------------------------- | ----------------------------------- |
| `400`  | `VALIDATION_ERROR`                | `fail`/`request_info` without notes |
| `409`  | `VERIFICATION_INVALID_TRANSITION` | Case already decided                |

### Badges

`NONE` · `VERIFIED` · `SILVER` · `GOLD`. Only `VERIFIED` is attainable today —
`SILVER` and `GOLD` are Phase 9 trust bands.

A badge is **derived** from the levels currently passed, so a failed re-check
withdraws it with no separate revoke step. `badgeSince` marks when the current
badge was earned; it clears on loss and restarts if re-earned.

The badge also appears on `GET /api/v1/providers/me`:

```json
{ "verification": { "badge": "VERIFIED", "badgeSince": "…", "levelsPassed": [0, 1, 2, 3] } }
```

> **Badge and `isListed` are independent.** Completeness decides whether a
> technician can be _found_; verification decides whether they are _trusted_.
> Search requires both.

---

## Bookings and slots — `/api/v1/bookings`

Design rationale, the state diagram, the handshake sequence and the outbox
contract are in [bookings.md](bookings.md).

> **One technician, one job, one hour.** A Postgres exclusion constraint refuses
> any overlapping `held`/`booked` slot for the same provider. There is no request
> shape that can get around it.

### Availability

#### `GET /api/v1/providers/:providerId/slots`

**Public**, rate limited with the same per-IP budget as search — a customer picks
a time before they sign in, and this is the step right after a search.

| Query param | Required | Meaning                                            |
| ----------- | -------- | -------------------------------------------------- |
| `from`      | ✅       | ISO instant, inclusive                             |
| `to`        | ✅       | ISO instant, exclusive. Span ≤ `SLOT_HORIZON_DAYS` |

```bash
curl 'http://localhost:3000/api/v1/providers/195e4019-.../slots?from=2026-08-16T00:00:00Z&to=2026-08-18T00:00:00Z'
```

**`200 OK`**

```json
{
  "providerId": "195e4019-d1a9-4ea6-bac9-3b4945bdc1c6",
  "slots": [
    { "id": "0f2c…", "startsAt": "2026-08-16T03:30:00.000Z", "endsAt": "2026-08-16T04:30:00.000Z" }
  ]
}
```

**Only `open` slots are returned.** A booked hour simply disappears from the
list rather than appearing with a status — who booked what, and when a technician
took the afternoon off, is nobody else's business.

| Status | Code               | When                                            |
| ------ | ------------------ | ----------------------------------------------- |
| `400`  | `VALIDATION_ERROR` | Missing/invalid `from`/`to`, or window too wide |
| `429`  | `RATE_LIMITED`     | Over the per-IP search budget                   |

#### `POST /api/v1/providers/me/slots/:slotId/block` · `/unblock`

**Technician only.** Takes an hour off sale, or puts it back. Only `open ↔
blocked`; an hour somebody has booked cannot be blocked away from under them.

**`200 OK`** → `{ "slot": { "id", "startsAt", "endsAt" }, "message": "…" }`

| Status | Code                  | When                                              |
| ------ | --------------------- | ------------------------------------------------- |
| `403`  | `FORBIDDEN`           | Caller is not a technician                        |
| `409`  | `SLOT_NOT_TOGGLEABLE` | Not their slot, or not in a state that can toggle |

### The booking lifecycle

All routes below require authentication.

#### `POST /api/v1/bookings`

**Customer only.**

| Field         | Required | Meaning                                 |
| ------------- | -------- | --------------------------------------- |
| `slotId`      | ✅       | An `open` slot, in the future           |
| `categoryId`  | ✅       | Must be a service the technician offers |
| `addressId`   | ✅       | Must belong to the caller. Snapshotted  |
| `priceCardId` | —        | Recorded for Phase 7's quotation        |
| `problemNote` | —        | Up to 500 chars                         |

The three search gates are re-checked here: a technician who went unlisted,
lost their badge or was blocked between the search and the tap cannot be booked.

**`201 Created`** → `{ "booking": <BookingDetail>, "message": "…" }`. The slot
becomes `held`.

| Status | Code                   | When                                            |
| ------ | ---------------------- | ----------------------------------------------- |
| `400`  | `VALIDATION_ERROR`     | Bad body, or the slot has already started       |
| `404`  | `ADDRESS_NOT_FOUND`    | The address is not the caller's                 |
| `409`  | `SLOT_UNAVAILABLE`     | Taken — including losing a race by microseconds |
| `409`  | `PROVIDER_UNAVAILABLE` | Unlisted, unverified or blocked technician      |

#### `GET /api/v1/bookings?side=customer|provider`

Both sides list "my bookings" from the same path. A technician who is also a
customer gets whichever side they ask for. Defaults to `customer`.

#### `GET /api/v1/bookings/:bookingId`

Either party. A stranger gets `404`, not `403` — they should not learn that the
booking exists.

**`BookingDetail`**

```json
{
  "id": "8b1e…",
  "status": "IN_PROGRESS",
  "categoryId": 2,
  "startsAt": "2026-08-16T03:30:00.000Z",
  "endsAt": "2026-08-16T04:30:00.000Z",
  "problemNote": "Geyser is not heating",
  "visitFeePaise": 4900,
  "address": { "addressText": "…", "landmark": "…", "cityId": 1, "lat": 23.16, "lng": 79.94 },
  "counterpart": { "name": "Ramesh Vishwakarma", "phone": "+919000000001", "phoneRevealed": true },
  "startOtp": "4821",
  "endOtp": "9037",
  "quotations": [],
  "pendingQuotation": null,
  "approvedQuotation": null,
  "payablePaise": null,
  "payable": null,
  "events": [
    {
      "id": "…",
      "eventType": "requested",
      "actorType": "customer",
      "payload": {},
      "createdAt": "…"
    }
  ],
  "createdAt": "…"
}
```

| Field                     | Visibility                                                                |
| ------------------------- | ------------------------------------------------------------------------- |
| `counterpart.phone`       | Masked outside `ACCEPTED`…`WORK_DONE`; full inside                        |
| `address`                 | Always to the customer; to the technician only once accepted              |
| `startOtp`                | **Customer only**, from `ACCEPTED`                                        |
| `endOtp`                  | **Customer only**, and only at `IN_PROGRESS`                              |
| `visitFeePaise`           | Resolved from `fee_config` at creation. Charged or waived at the end      |
| `quotations`              | Both parties, every version, fully itemised                               |
| `payablePaise`, `payable` | Frozen at a billable ending; null before, and on endings that owe nothing |

#### Provider actions

| Route                       | Body                | Result                                    |
| --------------------------- | ------------------- | ----------------------------------------- |
| `POST /:bookingId/accept`   | —                   | `ACCEPTED`, slot → `booked`, codes issued |
| `POST /:bookingId/reject`   | `{ reason, note? }` | `REJECTED`, slot → `open`                 |
| `POST /:bookingId/en-route` | —                   | `EN_ROUTE`                                |
| `POST /:bookingId/start`    | `{ otp }`           | `ARRIVED` **then** `IN_PROGRESS`          |
| `POST /:bookingId/complete` | `{ otp }`           | `WORK_DONE`                               |

`reason` for reject is one of `too_far` · `busy` · `wrong_skill` · `other`
(`other` requires a `note`).

`start` appends **two** events, because the history should show that arrival was
proven rather than only that work began.

> **`complete` requires an agreed price** — an approved quotation, or a `fixed`
> price card. See [Quotations](#quotations--apiv1quotations) below.

#### `POST /:bookingId/cancel`

Either party, with `{ reason, note? }` drawn from their own list:

| Side       | Reasons                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| Customer   | `changed_mind` · `found_other` · `emergency` · `provider_delay` · `other` |
| Technician | `emergency` · `vehicle_issue` · `wrong_skill` · `other`                   |

The lists differ because the codes mean different things: a customer's
`found_other` is market feedback, a technician's `vehicle_issue` is a reliability
signal Phase 9 will weigh. Sending the other side's code is a `400`.

**Nothing cancels from `ARRIVED` onwards.** Once a technician is at the door, "I
changed my mind" is a dispute, not a cancellation.

#### Booking errors

| Status | Code                         | When                                                  |
| ------ | ---------------------------- | ----------------------------------------------------- |
| `401`  | `BOOKING_OTP_INVALID`        | Wrong handshake code. `details.remaining` counts down |
| `403`  | `BOOKING_WRONG_ACTOR`        | The other party may do this, but you may not          |
| `404`  | `BOOKING_NOT_FOUND`          | Unknown, or not yours                                 |
| `409`  | `BOOKING_INVALID_TRANSITION` | Not possible from the current status                  |
| `409`  | `BOOKING_OTP_MISSING`        | No code is active for this booking yet                |
| `423`  | `BOOKING_OTP_LOCKED`         | Five wrong codes. Ops must unlock                     |

### `POST /api/v1/bookings/:bookingId/decline-work`

**Customer only**, from `IN_PROGRESS`. "I heard the price and I don't want the
work." Ends the job at `CLOSED_QUOTE_DECLINED` with the visit fee payable.

Body: `{ "note": "…" }` (optional, ≤500 chars).

Deliberately separate from rejecting a quotation: a rejection invites a revision,
this ends the job. Refused while a quotation is still awaiting a decision — the
history must be able to say whether the customer refused _this price_ or simply
stopped answering.

| Status | Code                         | When                               |
| ------ | ---------------------------- | ---------------------------------- |
| `403`  | `BOOKING_WRONG_ACTOR`        | The technician tried to declare it |
| `409`  | `QUOTATION_PENDING`          | Decide the open quotation first    |
| `409`  | `QUOTATION_ALREADY_APPROVED` | A price has already been agreed    |
| `409`  | `BOOKING_INVALID_TRANSITION` | The booking is not `IN_PROGRESS`   |

---

## Quotations — `/api/v1/quotations`

Design rationale, the lifecycle diagram, the money rules and the payable table
are in [bookings.md](bookings.md#quotations-and-pricing).

> **A job can only be completed at an agreed price.** Either an approved
> quotation, or a `fixed` price card agreed before anyone left the house. There
> is no request shape that finishes a job at a number the customer has not seen.

### The two paths

| Booking's price card                         | To finish the job         | Payable                           |
| -------------------------------------------- | ------------------------- | --------------------------------- |
| `fixed`                                      | nothing more needed       | card amount **+ visit fee**       |
| `starting_from`, `inspection_based`, or none | an **approved** quotation | quote total, **visit fee waived** |

### `POST /api/v1/bookings/:bookingId/quotations`

**Technician only**, and only while the booking is `IN_PROGRESS` — before that
they have not seen the fault, after it the job is over.

```json
{
  "labourPaise": 50000,
  "items": [
    { "kind": "part", "description": "Door gasket", "qty": 1, "unitPaise": 85000 },
    { "kind": "part", "description": "Sealant tube", "qty": 2, "unitPaise": 12000 }
  ],
  "note": "Gasket perished; door not sealing."
}
```

`kind` is `part` or `labour_extra`. A **pure-labour quote is legal** (empty
`items`); an empty quotation is not.

Limits: `qty` 1–999, `unitPaise` 1–5,000,000 (₹50,000), ≤50 items, and ≤₹2,00,000
per line and per quotation.

**`201 Created`** → `{ "quotation": <QuotationView>, "message": "…" }`

Sending a new one **supersedes** the previous `sent` version atomically and
increments `version`. Nothing is ever edited.

```json
{
  "id": "3f0a…",
  "bookingId": "8b1e…",
  "version": 2,
  "status": "sent",
  "labourPaise": 50000,
  "partsTotalPaise": 109000,
  "totalPaise": 159000,
  "totalDisplay": "₹1,590",
  "note": "Gasket perished; door not sealing.",
  "decisionNote": null,
  "items": [
    {
      "id": "…",
      "kind": "part",
      "description": "Door gasket",
      "qty": 1,
      "unitPaise": 85000,
      "lineTotalPaise": 85000
    }
  ],
  "decidedAt": null,
  "createdAt": "…"
}
```

| Status | Code                         | When                                                |
| ------ | ---------------------------- | --------------------------------------------------- |
| `400`  | `VALIDATION_ERROR`           | Bad shape, empty quote, or a figure past the caps   |
| `403`  | `QUOTATION_WRONG_ACTOR`      | Not the booking's technician                        |
| `404`  | `BOOKING_NOT_FOUND`          | Unknown, or not yours                               |
| `409`  | `QUOTATION_NOT_ALLOWED`      | The booking is not `IN_PROGRESS`                    |
| `409`  | `QUOTATION_ALREADY_APPROVED` | A price is already agreed — a revision is a new job |
| `409`  | `QUOTATION_CONFLICT`         | Overtaken by another send or an approval. Reload    |

### `GET /api/v1/bookings/:bookingId/quotations`

**Both parties.** Every version, every status, fully itemised — transparency is
the point, and hiding a superseded version would let a technician quietly revise
a number the customer already saw.

```json
{ "bookingId": "8b1e…", "quotations": [], "pending": null, "approved": null }
```

### Deciding

| Route                                  | Actor      | Body               | Result                       |
| -------------------------------------- | ---------- | ------------------ | ---------------------------- |
| `POST /api/v1/quotations/:id/approve`  | Customer   | —                  | `approved`. **Price locked** |
| `POST /api/v1/quotations/:id/reject`   | Customer   | `{ reason? }` ≤200 | `rejected`. Job continues    |
| `POST /api/v1/quotations/:id/withdraw` | Technician | —                  | `withdrawn`                  |

**A technician cannot approve their own quotation.** That is the single most
important actor rule in the module.

**Rejecting does not end the booking.** The technician may send v2, v3… The
customer ends it with `POST /bookings/:id/decline-work`.

**Approval is final.** No further quotations may be sent on that booking.

| Status | Code                    | When                                         |
| ------ | ----------------------- | -------------------------------------------- |
| `403`  | `QUOTATION_WRONG_ACTOR` | The other party may do this, but you may not |
| `404`  | `QUOTATION_NOT_FOUND`   | Unknown quotation                            |
| `409`  | `QUOTATION_NOT_PENDING` | Already decided, superseded or withdrawn     |
| `409`  | `QUOTATION_NOT_ALLOWED` | The booking is no longer `IN_PROGRESS`       |

### Completion errors

Returned by `POST /bookings/:id/complete` when the price is not settled.

| Status | Code                 | When                                                    |
| ------ | -------------------- | ------------------------------------------------------- |
| `409`  | `QUOTATION_PENDING`  | A quotation is still awaiting the customer              |
| `409`  | `QUOTATION_REQUIRED` | No approved quote, and the card is not a `fixed` amount |

### The frozen bill

On a billable ending the booking gains `payablePaise` and `payable`:

```json
{
  "payablePaise": 145000,
  "payable": {
    "payablePaise": 145000,
    "payableDisplay": "₹1,450",
    "visitFeeCharged": false,
    "basis": "approved_quotation",
    "components": [
      { "kind": "quotation", "labelKey": "payable.approvedQuotation", "amountPaise": 145000 },
      { "kind": "visit_fee", "labelKey": "payable.visitFee", "amountPaise": 0, "waived": true }
    ]
  }
}
```

`basis` is `approved_quotation` · `price_card` · `visit_fee_only`. A waived visit
fee appears as a zero line rather than being omitted, so the customer can see it
was not charged. **Phase 8 collects this number and never recomputes one.**

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

| Prefix                  | Phase | Will contain                |
| ----------------------- | ----- | --------------------------- |
| `/api/v1/payments`      | 8     | UPI collection, logged cash |
| `/api/v1/reviews`       | 9     | two-way ratings             |
| `/api/v1/notifications` | 10    | WhatsApp / push adapters    |
| `/api/v1/admin`         | 11    | admin console API           |
