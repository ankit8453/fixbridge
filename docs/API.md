# API reference

Updated every phase. Live so far: `auth` (Phase 2), `categories`, `customers`
and `providers` (Phase 3), and `verification` (Phase 4). The remaining
`/api/v1/*` routers are mounted but empty until their phase.

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
> Phase 5 search will require both.

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

| Prefix                  | Phase | Will contain                                         |
| ----------------------- | ----- | ---------------------------------------------------- |
| `/api/v1/search`        | 5     | PostGIS nearby search, distance/rating/badge ranking |
| `/api/v1/bookings`      | 6     | slots, booking lifecycle, start/end OTP handshake    |
| `/api/v1/quotations`    | 7     | itemised quotations, in-app approval                 |
| `/api/v1/payments`      | 8     | UPI collection, logged cash                          |
| `/api/v1/reviews`       | 9     | two-way ratings                                      |
| `/api/v1/notifications` | 10    | WhatsApp / push adapters                             |
| `/api/v1/admin`         | 11    | admin console API                                    |
