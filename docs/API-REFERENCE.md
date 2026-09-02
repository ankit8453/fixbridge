# FixBridge API reference — every endpoint

> Compiled by reading `apps/api/src/modules/**` route files, Zod schemas and response
> types directly. This is what the API _does_, not what it was designed to do.
> Written as the working reference for the Flutter build.

**Base:** `API_PREFIX = /api/v1` · **Webhooks:** `/api/v1/webhooks` · Mounting:
[apps/api/src/modules/index.ts](apps/api/src/modules/index.ts)

---

## 0. Cross-cutting contracts

### 0.1 Error envelope

Every non-2xx response, without exception:

```ts
export interface ApiFieldError {
  field: string;
  message: string;
  code: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string; // localised via Accept-Language when the error carries a messageKey
    requestId: string; // always present; 'unknown' if request-id middleware never ran
    details?: unknown; // ApiFieldError[] for VALIDATION_ERROR
    stack?: string; // only when NODE_ENV !== 'production' AND status >= 500
  };
}
```

Mapping rules:

- `ZodError` → **400** `VALIDATION_ERROR`, `details` = `ApiFieldError[]`. `field` is the
  dotted Zod path, or `"(root)"`.
- `AppError` → its own `statusCode`/`code`; message localised from `messageKey`;
  headers applied (`Retry-After`, `WWW-Authenticate`).
- Any `Error` carrying `status`/`statusCode` in 400–499 (e.g. malformed JSON) → that
  status, code `BAD_REQUEST`.
- Everything else → **500** `INTERNAL_ERROR`.

### 0.2 Error codes a client will actually hit

| Code                                                                                                           | Status | Meaning                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`                                                                                             | 400    | Zod. `details[]` per field                                                               |
| `BAD_REQUEST`                                                                                                  | 400    | `AppError.badRequest`, malformed JSON                                                    |
| `AUTH_TOKEN_MISSING`                                                                                           | 401    | No/malformed `Authorization`. `WWW-Authenticate: Bearer`                                 |
| `AUTH_TOKEN_EXPIRED`                                                                                           | 401    | **Refresh silently**                                                                     |
| `AUTH_TOKEN_INVALID`                                                                                           | 401    | **Force fresh sign-in**                                                                  |
| `AUTH_SESSION_REVOKED`                                                                                         | 401    | User on Redis denylist (blocked)                                                         |
| `OTP_INVALID`                                                                                                  | 401    | Wrong OTP _and_ "no OTP pending" — deliberately indistinguishable                        |
| `REFRESH_TOKEN_INVALID`                                                                                        | 401    | Not found / expired / device mismatch / **reuse detected**                               |
| `ACCOUNT_BLOCKED`                                                                                              | 403    | `users.status !== 'active'`                                                              |
| `FORBIDDEN`                                                                                                    | 403    | `requireRoles`. `details.requiredRoles` (never your own roles)                           |
| `NOT_FOUND`                                                                                                    | 404    | generic                                                                                  |
| `BOOKING_NOT_FOUND` / `PROVIDER_NOT_FOUND` / `USER_NOT_FOUND` / `JOURNAL_NOT_FOUND` / `PAYOUT_BATCH_NOT_FOUND` | 404    |                                                                                          |
| `CONFLICT`                                                                                                     | 409    |                                                                                          |
| `RATE_LIMITED`                                                                                                 | 429    | `Retry-After` header. `details: { scope: 'cooldown'\|'phone'\|'ip', retryAfterSeconds }` |
| `WEBHOOK_SIGNATURE_INVALID`                                                                                    | 400    | Razorpay webhook                                                                         |
| `INTERNAL_ERROR`                                                                                               | 500    |                                                                                          |

### 0.3 i18n

- Client sends `Accept-Language`. Full q-value parsing; region subtags stripped
  (`en-IN` → `en`); `*` → default.
- Supported: `['hi', 'en']`. **`DEFAULT_LOCALE = 'hi'`** — launch city is Jabalpur.
- Server sets `Content-Language` on every response.
- Most successful responses include a localised `message` string alongside data.
- **Exception:** `GET /notifications` renders in the user's stored `preferredLanguage`,
  not `Accept-Language`, so the inbox matches the WhatsApp already received.
- `preferredLanguage` changes via `PATCH /api/v1/auth/me` and is **retroactive**.

### 0.4 Money

Always integer paise (`type Paise = number`, `PAISE_PER_RUPEE = 100`). Never floats.

Money fields ship as **both** a `…Paise: number` and a formatted `…Display` /
`…display: string` (`₹1,250`) from `formatPaise`.

`PayableComponent.labelKey` is an **i18n key, never display text**.

### 0.5 Pagination

`?page=` (default 1) and **`?page_size=`** (snake) in; `page`, **`pageSize`** (camel),
`total` out.

| Endpoint group              | `page_size` max | default                  |
| --------------------------- | --------------- | ------------------------ |
| reviews                     | 50              | 10                       |
| complaints queue            | 50              | 20                       |
| coupons, admin lists        | 100             | 20                       |
| notifications               | 100             | `NOTIFICATION_PAGE_SIZE` |
| search `/providers`         | 25              | 10                       |
| search `/resolve` (`limit`) | 20              | 8                        |

`GET /admin/verification/queue` accepts **both** `page_size` and `pageSize`
(`page_size` wins) — fixed as DEF-004.

**Not paginated at all** (full arrays): `GET /bookings`, `/complaints`,
`/customers/me/addresses`, `/verification/documents`, `/verification/cases`,
`/providers/:id/slots`, `/providers/me/slots`, `/bookings/:id/quotations`,
`/bookings/:id/payments`, `/bookings/:id/reviews`.

### 0.6 Real-time

**There is none.** No WebSocket, no SSE, no socket.io anywhere in `src/`. Everything
is polling. A client must poll:

- `GET /bookings/:bookingId` for lifecycle + OTP codes
- `GET /notifications/unread-count` for the bell badge
- `GET /bookings/:bookingId/payments` after checkout to see `captured`

Outbound WhatsApp/SMS via MSG91 exists but is not a client channel.

---

## 1. health

Mounted at `/health` — **outside `/api/v1`**. Public.

**200** when both deps answer, **503** when either fails.

```ts
export interface HealthResponse {
  status: 'ok' | 'degraded';
  app: AppName; // from APP_NAME config — never a hardcoded brand
  version: string;
  uptime: number;
  checks: { postgres: CheckStatus; redis: CheckStatus }; // 'ok' | 'fail'
  message: string;
}
```

---

## 2. auth — `/api/v1/auth`

### Step 1 — `POST /auth/otp/request` · public

```ts
{
  phone: string;
} // any human format; transformed to E.164. Valid 10-digit Indian mobile.
```

→ **200** `{ phone: string /* MASKED, "+9198765*****" */, expiresInSeconds: number, message: string }`

**The OTP is never in the response, never logged, never written to Postgres** — only
its HMAC lives in Redis.

Three independent limits, checked in order:

1. **Resend cooldown** — `OTP_RESEND_COOLDOWN_SECONDS` default 60s, atomic `SET NX`.
   Does not consume budget. → 429, `details.scope = 'cooldown'`
2. **Per phone** — `OTP_MAX_PER_PHONE` default 5 per window. → 429, `scope = 'phone'`
3. **Per IP** — `OTP_MAX_PER_IP` default 30. → 429, `scope = 'ip'`

### Step 2 — `POST /auth/otp/verify` · public

```ts
{
  phone: string; // same normalisation
  otp: string; // exactly 6 digits, /^\d{6}$/
  deviceId: string;
} // 8–128 chars, /^[A-Za-z0-9._:-]+$/
```

→ **200** `VerifyOtpResult = AuthSession & { isNewUser: boolean }` plus `message`:

```ts
{
  tokenType: 'Bearer';
  accessToken: string;        // HS256 JWT
  expiresIn: number;          // JWT_ACCESS_TTL_SECONDS, default 900
  refreshToken: string;       // OPAQUE random base64url, NOT a JWT. Only SHA-256 stored.
  refreshExpiresAt: string;   // REFRESH_TOKEN_TTL_DAYS, default 30
  user: {
    id: string;
    phone: string;            // ALWAYS MASKED
    name: string | null;
    roles: Role[];            // 'customer' | 'technician' | 'ops' | 'admin'
    status: 'active' | 'blocked';
    defaultCityId: number | null;
    preferredLanguage: 'hi' | 'en';
    createdAt: string;
  };
  isNewUser: boolean;         // account is created HERE on first success
  message: string;
}
```

Failures: **401 `OTP_INVALID`** for both wrong code and no-pending-OTP (anti-oracle).
After `OTP_MAX_VERIFY_ATTEMPTS` (default 5) the code is **cleared** → **429**.

### Step 3 — `POST /auth/refresh` · public

```ts
{
  refreshToken: string; // 20–512 chars
  deviceId: string;
} // MUST match the deviceId the token was bound to
```

→ **200** `AuthSession` (no `isNewUser`, no `message`).

**Rotation semantics — critical:**

- Every refresh rotates. Single use.
- An **already-rotated** token = `reuse_detected` → **every token for that
  (user, device) is revoked**, 401 `REFRESH_TOKEN_INVALID`. A naive retry-on-timeout
  will log the user out. **Serialise refreshes.**
- `deviceId` mismatch → 401 (same code).
- Verdicts `valid | not_found | expired | device_mismatch | reuse_detected` all
  surface as the same 401.

### `POST /auth/logout` · public

`{ refreshToken: string }` → **200** `{ message }`. **Idempotent** — unknown tokens
still return 200, so it cannot probe token existence.

### `GET /auth/me` · authenticate

→ `{ user: AuthUser, deviceId: string }`. Loads live user, re-asserts `status === 'active'`.

### `PATCH /auth/me` · authenticate

`{ preferredLanguage: 'hi' | 'en' }` `.strict()` → `{ user, message }`.
**The only notification preference in v1** — no per-topic opt-outs.

### `GET /auth/admin-only` · admin

Demo route; JSDoc says delete it. Not for clients.

### How `deviceId` works

Client-generated, **stable per install**. Constrained (8–128, `[A-Za-z0-9._:-]`) so
it cannot smuggle data into the DB or JWT. Baked into access-token claims
(`{ sub, roles, deviceId, staff? }`) and stored on the refresh-token row with
`deviceInfo` (User-Agent, ≤512 chars). Refresh tokens are bound to it.

### Access-token verification

Stateless — no DB round trip per request. HS256 pinned (`alg: none` impossible),
`issuer = APP_NAME`, unique `jti`. One Redis `EXISTS` against the block denylist.

### Admin session (web console only)

`POST /auth/admin/login` · public — `{ email, password, deviceId }` `.strict()`
→ **200** `AdminSession` with `admin: { id, email, name, role: 'admin'|'subadmin', roles }`.

Staff live in `admin_users`, not `users`. Token carries `staff: true`.
Role mapping: `admin → ['admin','ops']`, `subadmin → ['ops']`.

> `refreshAdminSession` / `revokeAdminSession` exist in `admin-session.ts` but **no
> HTTP routes expose them**. There is no `/auth/admin/refresh` or `/auth/admin/logout`.

---

## 3. categories — `GET /api/v1/categories` · public

Query `{ cityId?: number }` (falls back to `DEFAULT_CITY_ID`).

```ts
export interface CategoryTreeResponse {
  cityId: number;
  categories: CategoryNode[];
}

export interface CategoryNode {
  id: number;
  slug: string;
  name: string; // localised via Accept-Language
  nameKey: string; // the i18n key, so clients can re-localise offline
  icon: string | null;
  sortOrder: number;
  providerCount: number; // listed+verified+active only; clusters sum their services.
  // CACHED 5 MINUTES — a browsing hint, not a live number.
  children: CategoryNode[];
}
```

---

## 4. customers — `/api/v1/customers`

Router-wide `authenticate` + `requireRoles('customer')`. Every query filtered by the
caller's own id.

| Method | Path                                         | Body                          | Response                           |
| ------ | -------------------------------------------- | ----------------------------- | ---------------------------------- |
| GET    | `/customers/me`                              | —                             | `{ profile }`                      |
| PATCH  | `/customers/me`                              | `updateCustomerProfileSchema` | `{ profile, message }`             |
| GET    | `/customers/me/addresses`                    | —                             | `{ addresses: AddressResponse[] }` |
| POST   | `/customers/me/addresses`                    | `createAddressSchema`         | **201** `{ address, message }`     |
| GET    | `/customers/me/addresses/:addressId`         | —                             | `{ address }`                      |
| PATCH  | `/customers/me/addresses/:addressId`         | `updateAddressSchema`         | `{ address, message }`             |
| DELETE | `/customers/me/addresses/:addressId`         | —                             | `{ message }`                      |
| POST   | `/customers/me/addresses/:addressId/default` | —                             | `{ address, message }`             |

```ts
// PATCH /customers/me — .strict()
{ displayName?: string;      // 1–120, trimmed
  email?: string | null }    // lowercased, ≤255. null CLEARS; omitting leaves untouched.

// POST /customers/me/addresses  (object .and(coordinates) — NOT .strict())
{ label?: 'home' | 'shop' | 'other';   // default 'other'
  labelText?: string;                  // 1–60
  addressText: string;                 // REQUIRED, 5–500
  landmark?: string;                   // 1–200
  cityId?: number;
  isDefault?: boolean;
  lat?: number;                        // -90..90   ┐ must arrive TOGETHER
  lng?: number }                       // -180..180 ┘ (a lone lat is a 400 on path ['lat'])
// Coordinates optional: a client with GPS sends them, everyone else is geocoded.

export interface AddressResponse {
  id: string;
  label: 'home' | 'shop' | 'other';
  labelText: string | null;
  addressText: string;
  landmark: string | null;
  cityId: number;
  location: GeoPoint;      // { lat, lng }
  isDefault: boolean;
  createdAt: string; updatedAt: string;
}
```

---

## 5. providers

Mount order in `index.ts` matters (most specific first): `/provider-photos` →
`/providers/me/slots` → `/providers/me/wallet` → `/providers/me/trust` →
`publicSlotRouter` → `publicReviewRouter` → `providersRouter`.

### 5.1 Public / any-authenticated

**`POST /providers/me/register`** · `authenticate` only (**not** role-gated)

> This is how a **customer becomes a technician**.

`{ displayName?: string; cityId?: number }` `.strict()`
→ **201** (or **200** if already registered) `{ profile, alreadyRegistered, message }`

**`GET /providers/:providerId`** · **public**, shared search rate limit

> Path is literally `'/:providerId([0-9a-fA-F-]{36})'` — the uuid pattern is in the
> **path**, so it cannot swallow `/providers/me`.

```ts
export interface PublicProviderProfile {
  providerId: string;
  displayName: string | null;
  badge: Badge; // 'NONE' | 'VERIFIED' | 'SILVER' | 'GOLD'
  bio: string | null;
  yearsExperience: number | null;
  city: { id: number; name: string } | null; // city granularity only — no coords
  rating: { average: number; count: number } | null;
  jobsCompleted: number;
  tagCounts: Record<string, number>;
  skills: { categoryId: number; nameKey: string; slug: string }[];
  priceCards: {
    id: string;
    categoryId: number;
    title: string;
    priceType: string;
    amountPaise: number | null;
    display: string | null;
  }[];
  memberSince: string;
}
```

**404 `PROVIDER_NOT_FOUND` for "does not exist", "not listed" and "suspended" alike**
— deliberately non-distinguishing.

**`POST /provider-photos/:photoId/report`** · authenticate (any role) — **customer-facing**

`{ reason: string }` 5–500 `.strict()` → **202** `{ message }`. The report count is
deliberately **not returned** — telling a reporter how close they are to a takedown
invites brigading.

### 5.2 Technician-only — partner app

`authenticate` + `requireRoles('technician')`.

| Method | Path                                   | Body                                        |
| ------ | -------------------------------------- | ------------------------------------------- |
| GET    | `/providers/me`                        | —                                           |
| PATCH  | `/providers/me`                        | `updateProviderProfileSchema`               |
| POST   | `/providers/me/skills`                 | `{ categoryId, experienceNote? }` → **201** |
| DELETE | `/providers/me/skills/:categoryId`     | —                                           |
| POST   | `/providers/me/photo/upload-url`       | `{ contentType, sizeBytes }` → **201**      |
| POST   | `/providers/me/photo/:photoId/confirm` | —                                           |
| GET    | `/providers/me/photo`                  | —                                           |
| POST   | `/providers/me/price-cards`            | `createPriceCardSchema` → **201**           |
| PATCH  | `/providers/me/price-cards/:id`        | `updatePriceCardSchema`                     |
| DELETE | `/providers/me/price-cards/:id`        | —                                           |
| POST   | `/providers/me/availability`           | `createAvailabilitySchema` → **201**        |
| PATCH  | `/providers/me/availability/:id`       | `updateAvailabilitySchema`                  |
| DELETE | `/providers/me/availability/:id`       | —                                           |

```ts
// POST /providers/me/price-cards — .strict()
{ categoryId: number;
  title: string;                        // 1–120
  priceType: 'fixed';                   // LITERAL — the only settable type
  amountPaise: number;                  // int, 1..100_000_000. REQUIRED.
  isActive?: boolean }
// `starting_from` and `inspection_based` still exist in the DB enum for historical
// rows and frozen booking snapshots, but nothing writes them any more.

// POST /providers/me/availability — .strict()
{ dayOfWeek: number;      // 0–6
  startTime: string;      // "HH:MM" 24h on the wire → minutes-from-midnight internally
  endTime: string;
  isActive?: boolean }
```

### 5.3 Photo moderation — ops

`/api/v1/admin/provider-photos` · `requireRoles('ops','admin')`

- `GET /reported` → `{ photos }`
- `POST /:photoId/decide` — `{ decision: 'remove'|'keep'; note? }` (note required to remove)

---

## 6. bookings — `/api/v1/bookings`

`router.use(authenticate)` at the top. Sub-routers mounted before `/:bookingId` routes:
`/:bookingId/quotations`, `/payments`, `/coupon`, `/reviews`, `/complaints`.

### 6.1 The state machine

```ts
BOOKING_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'WORK_DONE',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'CLOSED_QUOTE_DECLINED',
];

TERMINAL = [
  'REJECTED',
  'EXPIRED',
  'WORK_DONE',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'CLOSED_QUOTE_DECLINED',
];
BILLABLE = ['WORK_DONE', 'CLOSED_QUOTE_DECLINED']; // where payablePaise is frozen
```

| From        | Event                   | To                    | Actors            | Endpoint                                                        |
| ----------- | ----------------------- | --------------------- | ----------------- | --------------------------------------------------------------- |
| REQUESTED   | `accepted`              | ACCEPTED              | provider, **ops** | `POST /bookings/:id/accept` · `POST /admin/bookings/:id/accept` |
| REQUESTED   | `rejected`              | REJECTED              | provider          | `POST /bookings/:id/reject`                                     |
| REQUESTED   | `expired`               | EXPIRED               | **system**        | background job, `BOOKING_REQUEST_TTL_MINUTES` default **60**    |
| REQUESTED   | `cancelled_by_customer` | CANCELLED_BY_CUSTOMER | customer          | `POST /bookings/:id/cancel`                                     |
| ACCEPTED    | `en_route`              | EN_ROUTE              | provider          | `POST /bookings/:id/en-route`                                   |
| ACCEPTED    | `arrived`               | ARRIVED               | provider          | via start-OTP path                                              |
| ACCEPTED    | `cancelled_by_customer` | CANCELLED_BY_CUSTOMER | customer          | `/cancel`                                                       |
| ACCEPTED    | `cancelled_by_provider` | CANCELLED_BY_PROVIDER | provider          | `/cancel`                                                       |
| EN_ROUTE    | `arrived`               | ARRIVED               | provider          | via start-OTP path                                              |
| EN_ROUTE    | `cancelled_by_customer` | CANCELLED_BY_CUSTOMER | customer          | `/cancel`                                                       |
| EN_ROUTE    | `cancelled_by_provider` | CANCELLED_BY_PROVIDER | provider          | `/cancel`                                                       |
| ARRIVED     | `work_started`          | IN_PROGRESS           | provider, system  | `POST /bookings/:id/start`                                      |
| IN_PROGRESS | `work_done`             | WORK_DONE             | provider          | `POST /bookings/:id/complete`                                   |
| IN_PROGRESS | `work_declined`         | CLOSED_QUOTE_DECLINED | **customer**      | `POST /bookings/:id/decline-work`                               |

**Nothing cancels after ARRIVED.** Once a technician is at the door, "I changed my
mind" is a _dispute_, not a cancellation.

**Non-transitioning events** (evidence only, any non-terminal status):
`otp_failed`, `otp_locked`, `quote_sent`, `quote_withdrawn`, `quote_approved`,
`quote_rejected`.

The event log is the truth; `bookings.status` is a projection (`projectBookingStatus`
throws on a log it cannot replay).

### 6.2 Customer endpoints

**`POST /bookings`** · customer — `.strict()`

```ts
{ slotId: string;            // uuid
  categoryId: number;
  addressId: string;         // uuid
  priceCardId?: string;
  problemNote?: string }     // 1–500
```

→ **201** `{ booking: BookingDetail, message }`

**`GET /bookings?side=customer|provider`** · authenticate
`side` defaults to `'customer'` for any value other than `'provider'`.
→ `{ bookings: BookingDetail[], side }` — **not paginated**

**`GET /bookings/:bookingId`** → `{ booking: BookingDetail }`

**`POST /bookings/:bookingId/cancel`** · authenticate (**either side**)

```ts
{ reason: string;   // 1–40, validated against the CALLER'S OWN list
  note?: string }   // 1–500, .strict()
```

- Customer reasons: `changed_mind | found_other | emergency | provider_delay | other`
- Provider reasons: `emergency | vehicle_issue | wrong_skill | other`
- Wrong list → **400** `errors.bookings.invalidReason`
- Not a party → **404 `BOOKING_NOT_FOUND`**

**`POST /bookings/:bookingId/decline-work`** · customer — `{ note?: string }` `.strict()`

> "I heard the price and I don't want the work." **Separate from rejecting a
> quotation:** a rejection invites a revision, this **ends** the job.
> IN_PROGRESS → CLOSED_QUOTE_DECLINED. **The visit fee becomes payable.**

### 6.3 Technician endpoints — partner app

| Method | Path                     | Body                                                                                                           |
| ------ | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| POST   | `/bookings/:id/accept`   | —                                                                                                              |
| POST   | `/bookings/:id/reject`   | `{ reason: 'too_far'\|'busy'\|'wrong_skill'\|'other'; note? }` — **`note` required when `reason === 'other'`** |
| POST   | `/bookings/:id/en-route` | —                                                                                                              |
| POST   | `/bookings/:id/start`    | `{ otp: string }` `/^\d{4,8}$/`                                                                                |
| POST   | `/bookings/:id/complete` | `{ otp: string }`                                                                                              |

### 6.4 The OTP handshake

**Two codes per booking**, `BOOKING_OTP_LENGTH` default **4 digits** (spoken aloud in
person, often over job noise; the threat model requires physical presence).

- **Minted together at ACCEPTANCE.**
- Stored in **Redis only** — HMAC salted by `booking id + kind`. **Never in Postgres.**
- **Also stored in plaintext under a separate key** — a deliberate departure from the
  auth OTP, because the customer must be _shown_ their code; there is nobody to send it to.

| Field      | Who sees it       | When                                     |
| ---------- | ----------------- | ---------------------------------------- |
| `startOtp` | **customer only** | from ACCEPTED                            |
| `endOtp`   | **customer only** | **only when `status === 'IN_PROGRESS'`** |

Both are `null` for the technician, always. The technician **asks the customer to read
the code out**.

> The end code appears only once work is under way. Revealing it at acceptance would
> let it be handed over before anything had been done.

**Attempts:** `BOOKING_OTP_MAX_ATTEMPTS` default **5**. At the limit → **`locked`**,
persisting **7 days**.

> **Locked, not reset.** A login OTP can be re-requested; a handshake cannot. Only
> **ops** unlock it: `POST /admin/bookings/:bookingId/otp-unlock` with
> `{ note (3–500, mandatory); kind: 'start'|'end'|'both' }`.

Check outcomes: `ok | missing | wrong | locked`.

### 6.5 `BookingDetail`

```ts
export interface BookingDetail {
  id: string;
  status: BookingStatus;
  categoryId: number;
  startsAt: string;
  endsAt: string;
  problemNote: string | null;
  /** Resolved from `fee_config` at creation. Whether it is charged is decided at the end. */
  visitFeePaise: number;
  /** The rate the customer actually booked on, snapshotted at creation. */
  agreedLabour: {
    priceType: 'fixed' | 'starting_from' | 'inspection_based' | null;
    amountPaise: number | null;
  };
  quotations: QuotationView[];
  pendingQuotation: QuotationView | null;
  approvedQuotation: QuotationView | null;
  /** Frozen at the terminal transition. Null until then. */
  payablePaise: number | null;
  payable: PayableView | null;
  /** The address as it was when booked. Null to a provider before acceptance. */
  address: unknown;
  counterpart: {
    name: string | null;
    /** Masked until ACCEPTED. */
    phone: string | null;
    phoneRevealed: boolean;
    /** Technician's photo, customer side only, from ACCEPTED. Short-lived signed URL. */
    photoUrl: string | null;
  };
  /** Customer only, from ACCEPTED. */
  startOtp: string | null;
  /** Customer only, and only once work is under way. */
  endOtp: string | null;
  events: BookingEventView[];
  createdAt: string;
}

export interface BookingEventView {
  id: string;
  eventType: BookingEventType;
  actorType: BookingActor; // 'customer' | 'provider' | 'system' | 'ops'
  payload: unknown;
  createdAt: string;
}
```

### 6.6 Slots

**`GET /providers/:providerId/slots?from=&to=`** · public, shared search rate limit.
Both params required, `to` after `from`.
→ `{ providerId, slots: PublicSlot[] }` where `PublicSlot = { id, startsAt, endsAt }`

**Only `open` slots are returned.** Which hours are booked, and when a technician took
the afternoon off, is nobody else's business.

**`/providers/me/slots`** · technician

- `GET /` → `{ slots: OwnSlot[] }` (`OwnSlot extends PublicSlot` + `status`, `bookingId`)
- `POST /:slotId/block` · `POST /:slotId/unblock`

Deliberately a separate route rather than `?includeBlocked=true` — a flag gated on
caller identity is one forgotten check away from publishing everybody's day.

---

## 7. quotations

Two mount points: `/api/v1/quotations/:quotationId/*` and
`/api/v1/bookings/:bookingId/quotations`. Both `use(authenticate)`.

### 7.1 Customer side

**`POST /quotations/:quotationId/approve`** · customer, no body → `{ quotation, message }`

> The moment the price becomes binding. **A technician cannot approve their own number
> on the customer's behalf** — the single most important actor rule in this module.

**`POST /quotations/:quotationId/reject`** · customer — `{ reason?: string }` (1–200)

> "Not at that price." **Does NOT end the booking** — the technician may answer with a
> revision. The customer ends it with `POST /bookings/:id/decline-work`.

**`GET /bookings/:bookingId/quotations`** · both parties

```ts
export interface QuotationHistoryResponse {
  bookingId: string;
  quotations: QuotationView[];
  pending: QuotationView | null;
  approved: QuotationView | null;
}
```

### 7.2 Technician side

**`POST /bookings/:bookingId/quotations`** · technician → **201**

> A new **version**. Never an edit — enforced by immutability triggers.

```ts
// createQuotationSchema — .strict()
{
  labourPaise: number;              // int, 0..(MAX_UNIT_PAISE*4). Zero is fine when
                                    // everything is parts; the TOTAL must exceed zero.
  agreedLabourPaise?: number;       // the split, optional for older clients
  extraLabourPaise?: number;
  extraLabourReason?: string;       // 1–300
  items: { kind: 'part' | 'labour_extra';
           description: string;     // 1–120
           qty: number;             // int 1..MAX_QTY
           unitPaise: number }[];   // int 1..MAX_UNIT_PAISE
  note?: string;                    // 1–500
}
```

**`POST /quotations/:quotationId/withdraw`** · technician

### 7.3 The labour split

Labour is **two numbers**:

- **agreed** — _derived from the booking snapshot, never accepted from the client._
- **extra** — additional work found on site, which **needs a written reason the
  customer can read before approving**.

| Snapshot                     | Rule                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `fixed` "₹300"               | agreed labour is **exactly** ₹300. Client claiming otherwise → `LabourRuleError('agreed_mismatch')` |
| `starting_from` "₹300+"      | a **floor** — may exceed, never go below → `'below_floor'`                                          |
| `inspection_based` / no card | no anchor, `agreed = 0`; the whole figure travels as **extra**                                      |

Rejection reasons: `below_floor | agreed_mismatch | reason_required | reason_too_short
| negative_extra`. Reason ≥ `EXTRA_REASON_MIN_LENGTH = 10` chars, ≤ 300.

**Extra-labour cap:** `min(agreedLabourPaise, EXTRA_LABOUR_FLAT_CAP_PAISE = ₹5,000)`.
Above the cap the quote is **NOT refused** — it is flagged `needsReview: true` for ops.
Blocking would push a genuinely large job off-platform.

### 7.4 `QuotationView`

```ts
export interface QuotationView {
  id: string;
  bookingId: string;
  version: number;
  status: 'sent' | 'approved' | 'rejected' | 'superseded' | 'withdrawn';
  labourPaise: number;
  /** The labour the customer agreed to at booking time. */
  agreedLabourPaise: number | null;
  /** Labour beyond the agreed anchor; always travels with its reason. */
  extraLabourPaise: number | null;
  extraLabourReason: string | null;
  partsTotalPaise: number;
  totalPaise: number;
  totalDisplay: string;
  note: string | null;
  decisionNote: string | null;
  items: QuotationItemView[];
  decidedAt: string | null;
  createdAt: string;
}

export interface QuotationItemView {
  id: string;
  kind: 'part' | 'labour_extra';
  description: string;
  qty: number;
  unitPaise: number;
  lineTotalPaise: number;
}
```

**Both sides see the whole history, every version, fully itemised.**

### 7.5 The payable

> The visit fee is the price of the technician turning up, so it is **waived** whenever
> the job is priced and done under an approved quotation, and **charged** whenever the
> customer sends the technician away or the job is billed at a flat rate.

| Outcome                          | `basis`              | `payablePaise`         | `visitFeeCharged`                                                               |
| -------------------------------- | -------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `CLOSED_QUOTE_DECLINED`          | `visit_fee_only`     | `visitFeePaise`        | `true`                                                                          |
| `WORK_DONE` + approved quote     | `approved_quotation` | quote total            | **`false`** — visit fee listed at **0 with `waived: true`** rather than omitted |
| `WORK_DONE` + `fixed` price card | `price_card`         | `flat + visitFeePaise` | `true`                                                                          |

```ts
export interface PayableBreakdown {
  payablePaise: number;
  visitFeeCharged: boolean;
  components: {
    kind: 'quotation' | 'price_card' | 'visit_fee';
    labelKey: string; // i18n key — NEVER display text
    amountPaise: number;
    waived?: boolean;
  }[];
  basis: 'approved_quotation' | 'price_card' | 'visit_fee_only';
}

export interface PayableView extends PayableBreakdown {
  payableDisplay: string;
}
```

`assertBreakdownAddsUp` runs on every terminal transition.

---

## 8. payments

### 8.1 The Razorpay checkout handshake

**Step 1 — `POST /bookings/:bookingId/payments`** · customer

```ts
{ purpose?: 'final_bill' | 'visit_fee_upfront' }   // default 'final_bill', body optional
```

`visit_fee_upfront` requires `COLLECT_FEE_AT_BOOKING`, else **400**
`errors.payments.upfrontDisabled`.

→ **201** (new) or **200** (`reused: true`)

```ts
export interface StartPaymentResponse {
  payment: PaymentView;
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  /** The publishable key. The secret never leaves the server. */
  keyId: string;
  reused: boolean;
}
```

> Calling it twice returns the **same order**, deliberately — two live orders for one
> bill is how a customer pays twice.

**Step 2 — client opens the Razorpay SDK** with `keyId`, `orderId`, `amountPaise`,
`currency: 'INR'`.

**Step 3 — `POST /payments/:paymentId/checkout-callback`** · customer

```ts
// .strict(). RAZORPAY'S OWN FIELD NAMES (snake_case).
{
  razorpay_order_id: string; // 1–120
  razorpay_payment_id: string; // 1–120
  razorpay_signature: string;
} // 1–200
```

→ **200** `{ payment, message: t('payments.confirming') }`

> **The optimistic callback.** Verifies the signature and stamps a flag so the app can
> honestly say "confirming your payment". **NO MONEY MOVES HERE.**
> `checkoutVerifiedAt` is set; `status` is still `created`. The client must then
> **poll** `GET /bookings/:bookingId/payments` until `status === 'captured'`.

**Step 4 — the webhook is the truth.**

### 8.2 Other payment endpoints

- **`GET /bookings/:bookingId/payments`** · authenticate (both parties)
  → `{ bookingId, payments: PaymentView[] }`
- **`POST /bookings/:bookingId/payments/cash`** · technician — `{ note?: string }` → **201**
- **`GET /providers/me/wallet`** · technician → `{ wallet: WalletResponse }`

```ts
export interface PaymentView {
  id: string;
  bookingId: string | null;
  purpose: 'final_bill' | 'visit_fee_upfront';
  method: 'online' | 'cash';
  amountPaise: number;
  amountDisplay: string;
  status: 'created' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
  commissionBps: number;
  gatewayOrderId: string | null;
  /** The app said checkout succeeded. Nothing has moved on the strength of it. */
  checkoutVerifiedAt: string | null;
  capturedAt: string | null;
  createdAt: string;
}

export interface WalletResponse {
  providerId: string;
  payablePaise: number;
  payableDisplay: string; // what we owe them
  duesPaise: number;
  duesDisplay: string; // what they owe us, commission on cash
  netPaise: number;
  netDisplay: string; // negative = they owe us more
  pendingPayoutPaise: number;
  payoutMinimumPaise: number;
  recentPayouts: PayoutView[];
  ledger: WalletLedgerLine[]; // their own accounts only, no ops memos
}
```

### 8.3 Ops payments — `/api/v1/admin/payments`

`adminOnly = requireRoles('admin')` on the four money-moving routes.
_The line between `ops` and `admin` is **reversibility**, not seniority._

| Method | Path                             | Guard     | Body                                      |
| ------ | -------------------------------- | --------- | ----------------------------------------- |
| POST   | `/:paymentId/refund`             | **admin** | `{ amountPaise?; reason? }` → **202**     |
| POST   | `/payout-batches`                | ops       | —                                         |
| POST   | `/payout-batches/:batchId/close` | ops       | —                                         |
| GET    | `/payout-batches/:batchId`       | ops       | —                                         |
| POST   | `/payouts/:payoutId/paid`        | **admin** | `{ utrRef: string }` (4–60, **required**) |
| POST   | `/payouts/:payoutId/failed`      | **admin** | `{ note: string }`                        |
| POST   | `/dues/settle`                   | **admin** | `{ providerId; amountPaise; memo? }`      |
| GET    | `/ledger/position`               | ops       | —                                         |

### 8.4 Webhook — `POST /api/v1/webhooks/razorpay` · public

Mounted **first**, with `express.raw({ type: '*/*', limit: '1mb' })` on `WEBHOOK_PREFIX`
**ahead of `express.json()`**.

> A gateway signs the exact body it sent. `express.json()` consumes the stream and hands
> back an object; re-serialising reorders keys and normalises whitespace, so the HMAC
> does not match and every webhook silently fails. This is the single most common way
> payment integrations break.

- Auth **is** the signature: `X-Razorpay-Signature` over the exact bytes.
- Empty body → 400 `BAD_REQUEST`. Bad signature → 400 `WEBHOOK_SIGNATURE_INVALID`.
- Idempotency key: `X-Razorpay-Event-Id`, falling back to
  `` `${eventType}:${paymentId ?? refundId ?? orderId ?? 'unknown'}` ``.
- → **200 either way**: `{ received: true, duplicate: boolean }`.
- The handler does as little as possible: **verify, record, acknowledge.**

---

## 9. coupons

### 9.1 Customer side

**`POST /bookings/:bookingId/coupon`** · customer

```ts
{
  code: string; // 3–40, /^[A-Za-z0-9_-]+$/, uppercased server-side
  paymentMethod: 'online' | 'cash';
} // REQUIRED, not inferred
```

> `paymentMethod` is explicit because at the moment a coupon is applied there is usually
> no `payments` row yet — the choice exists only in the customer's screen.

```ts
export interface AppliedCouponView {
  code: string;
  discountPaise: number;
  discountDisplay: string;
  /** The bill before the coupon. What the technician is paid on. */
  originalPayablePaise: number;
  originalPayableDisplay: string;
  payablePaise: number;
  payableDisplay: string;
}
```

**`DELETE /bookings/:bookingId/coupon`** → `{ removed: true, message }`

A coupon is **refused outright once the booking's payment exists**.

### 9.2 Ops — `/api/v1/admin/coupons`

> **This router guards itself.** It is mounted as a **sibling** of `/api/v1/admin`, not
> nested, so `adminRouter`'s `authenticate` never runs for it. (This was DEF-003 — every
> coupon endpoint was reachable with no token at all. Fixed.)

`opsRouter.use(authenticate, requireRoles('ops','admin'))`; mutations additionally
`requireRoles('admin')`.

| Method | Path                              | Guard                                |
| ------ | --------------------------------- | ------------------------------------ |
| GET    | `/admin/coupons`                  | ops                                  |
| GET    | `/admin/coupons/stats`            | ops — _declared before `/:couponId`_ |
| GET    | `/admin/coupons/:couponId`        | ops                                  |
| POST   | `/admin/coupons`                  | **admin**                            |
| PATCH  | `/admin/coupons/:couponId`        | **admin**                            |
| POST   | `/admin/coupons/:couponId/pause`  | **admin**                            |
| POST   | `/admin/coupons/:couponId/resume` | **admin**                            |

```ts
// createCouponSchema — .strict()
{ code: string;                    // 3–40
  description: string;             // 3–200
  discountType: 'percent' | 'flat';
  value: number;                   // whole percent, or paise for 'flat'
  maxDiscountPaise: number;        // REQUIRED — no "blank for unlimited".
                                   // An uncapped percentage on a large job is unbounded loss.
  minOrderPaise: number;           // default 0
  validFrom: string; validUntil: string;
  totalUsageLimit?: number;        // omitted = uncapped
  perCustomerLimit: number;        // default 1, max 100
  cityId?: number; categoryId?: number }
// `code` and `discountType` are NOT editable via PATCH.
// `expired` is derived from the date on read, never set by hand.
```

---

## 10. verification

### 10.1 Technician-facing — partner app

`authenticate + requireRoles('technician')`.

| Method | Path                                               | Body                                                                                                                                                   |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/verification/documents/upload-url`               | `{ docType: 'id_proof'\|'certificate'\|'photo'\|'other'; contentType: 'image/jpeg'\|'image/png'\|'image/webp'\|'application/pdf'; sizeBytes: number }` |
| POST   | `/verification/documents/:documentId/confirm`      | —                                                                                                                                                      |
| GET    | `/verification/documents`                          | —                                                                                                                                                      |
| GET    | `/verification/documents/:documentId/download-url` | —                                                                                                                                                      |
| POST   | `/verification/levels/:level/submit`               | validated by **that level's own schema**                                                                                                               |
| GET    | `/verification/cases`                              | —                                                                                                                                                      |
| GET    | `/verification/cases/:caseId`                      | —                                                                                                                                                      |
| POST   | `/verification/cases/:caseId/info`                 | `{ notes: string (1–2000); documentIds?: uuid[] }`                                                                                                     |

`:level` is coerced int **0–3**. `sizeBytes` is declared up front because it is
**signed into the pre-signed PUT URL** — storage then rejects a different size.

```ts
export interface VerificationEventResponse {
  id: string;
  eventType: VerificationEventType;
  actorType: VerificationActorType;
  notes: string | null; // REDACTED TO NULL FOR PROVIDERS — ops notes are internal
  payload: unknown;
  createdAt: string;
}
```

### 10.2 Ops

- `GET /queue` — `{ status?; level?: 0–2 (**capped at 2** — references was retired);
cityId?; page; page_size / pageSize }`
- `GET /cases/:caseId` · `POST /cases/:caseId/review`
- `POST /cases/:caseId/decide` — `{ decision; notes? }`; **`notes` is required when
  decision is `fail` or `request_info`** — refusing someone must be explainable.

---

## 11. search — `/api/v1/search`

**Both routes are public.** _A customer chooses a technician before they sign in, and
forcing an account first is the fastest way to lose them._ Per-IP rate limit
(`SEARCH_RATE_LIMIT_PER_MINUTE`, default **30/min**) is **shared** with
`GET /providers/:id`, `/slots` and `/reviews`.

**`GET /search/providers`** — `.strict()`

```ts
{ lat: number;                  // REQUIRED, -90..90
  lng: number;                  // REQUIRED, -180..180
  city_id?: number;
  category_id?: number;
  date?: string;                // "YYYY-MM-DD", read as an IST calendar day
  start_time?: string;          // "HH:MM" 24h
  end_time?: string;
  max_distance_km?: number;     // 0.1..25
  sort?: 'rank' | 'distance' | 'price_low';   // default 'rank'
  page?: number;
  page_size?: number }          // 1..25, default 10
```

**The availability trio is all-or-nothing** — all three of `date`/`start_time`/`end_time`
or none, otherwise a 400 on path `['date']`.

> Only surfaces providers that are **listed (complete), VERIFIED, and active**. There is
> no parameter that relaxes those gates.

```ts
export interface SearchProvidersResponse {
  results: SearchResultCard[];
  page: number;
  pageSize: number;
  total: number; // may exceed what was ranked — see `truncated`
  truncated: boolean;
  sort: 'rank' | 'distance' | 'price_low';
  query: {
    cityId;
    categoryId;
    maxDistanceKm;
    availability: { dayOfWeek; startTime; endTime } | null;
  };
}

export interface SearchResultCard {
  providerId: string;
  displayName: string | null;
  badge: Badge;
  rating: { average: number; count: number } | null; // null until rated — never a fake default
  jobsCompleted: number;
  yearsExperience: number | null;
  distanceKm: number; // rounded to 0.1 km — too coarse to triangulate
  skills: { categoryId: number; slug: string; name: string }[];
  startingPrice: { amountPaise: number; display: string } | null;
  nextAvailability: { dayOfWeek: number; startTime: string; endTime: string } | null;
  locality: string | null; // human-readable area, NOT coordinates
}
```

**Deliberately absent:** exact coordinates, phone number, completeness internals.

**`GET /search/resolve`** — `{ q: string; city_id?: number; limit?: number (1–20, def 8) }`

> Free text — **in either script** — to category suggestions. Call **as the customer
> types**, then fire `/providers` with the chosen category.

```ts
export interface CategorySuggestion {
  categoryId: number;
  slug: string;
  name: string;
  nameKey: string;
  parentId: number | null; // null for a cluster
  matchReason: 'synonym_exact' | 'synonym_prefix' | 'synonym_fuzzy' | 'category_name';
  confidence: number; // 0..1
  matchedTerm: string | null;
}
```

---

## 12. reviews

### 12.1 Public — `GET /providers/:providerId/reviews` · public

`{ page (def 1), page_size (1–50, def 10) }`

```ts
export interface PublicReviewView {
  id: string;
  stars: number;
  tags: string[];
  text: string | null;
  authorName: string; // first name + initial only — full names would be a safety problem
  createdAt: string;
}
```

**Only published `customer_to_provider` reviews.** A test asserts no
`provider_to_customer` review can reach this response.

### 12.2 Booking-scoped — `/bookings/:bookingId/reviews` · authenticate

- `GET /` → both of a booking's reviews, to its own two parties
- `POST /` → **201**

```ts
{ stars: number;      // int 1–5
  tags: string[];     // max 5, validated against the CALLER'S direction
  text?: string }     // 1–500
```

> Which direction it is — and therefore which tags are legal — is **derived from who the
> caller is, never from the request body.**

- Customer→provider tags: `punctual | polite | fair_price | clean_work | expert`
- Provider→customer tags: `respectful | clear_problem | paid_promptly | difficult`
  (`difficult` is the one negative tag, deliberately **internal-only**)

### 12.3 Report — `POST /reviews/:reviewId/report` · authenticate

`{ reason: string }` 3–300 → **202**. Only a public customer→provider review can be reported.

### 12.4 Ops — `/api/v1/admin/reviews`

`GET /reports` (oldest first, only against still-`published` reviews) ·
`POST /:reviewId/hide` · `POST /:reviewId/unhide`

---

## 13. complaints

### 13.1 Customer/technician facing

- `GET /complaints` → complaints this person raised **and** against them. Not paginated.
- `GET /complaints/:complaintId`
- `POST /bookings/:bookingId/complaints` · **either party, from ARRIVED onwards**

```ts
{
  category: 'overcharge' | 'no_show' | 'quality' | 'behavior' | 'cash_dispute' | 'safety' | 'other';
  description: string;
} // 10–1000
```

> A **`safety`** complaint from a customer **suspends the technician before this
> responds** — handled synchronously.

### 13.2 Ops — `/api/v1/admin/complaints`

- `GET /` — **oldest first**. _A newest-first queue is one where the oldest is never read._
- `POST /:complaintId/take-up`
- `POST /:complaintId/resolve` — `{ note (5–1000); severity: 'minor'|'major'|'severe' }`.
  Both mandatory — `severe` suspends.
- `POST /:complaintId/dismiss` — `{ note }`. **Deliberately no severity.**

---

## 14. trust

### 14.1 `GET /providers/me/trust` · technician

Computed **live**, not from the last snapshot.

```ts
{ trust: {
    score: number | null;
    badge: Badge;
    settledJobs: number;
    components: { name; label; reason; raw; normalized: number | null;
                  weight; contribution; pending: boolean }[];
    nextBand: null | { band: 'SILVER'|'GOLD'; needsScore: number; needsJobs: number };
    suspendedUntil: string | null;
    suspensionReason: string | null;
    trend: { score; badge; trigger; at }[];  // last 10 snapshots
} }
```

> `nextBand` reports both a score gap **and** a volume gap, because a technician told
> "you need 70", who reaches 72 with four jobs and still sees no badge, has been misled
> by their own app.

### 14.2 Ops — `/api/v1/admin/trust`

`POST /suspend` — `{ providerId; days? (1–365); reason (3–300) }` ·
`POST /:providerId/reinstate` — `{ reason }` · `POST /:providerId/recompute`

---

## 15. notifications — `/api/v1/notifications`

`router.use(authenticate)`. **Every route is scoped to the caller's own inbox.**

| Method | Path                                  | Query / body                                                     |
| ------ | ------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/notifications`                      | `{ page; page_size?; unread_only: 'true'\|'false' }` `.strict()` |
| GET    | `/notifications/unread-count`         | → `{ unread: number }`                                           |
| POST   | `/notifications/read-all`             | → `{ marked, unread: 0 }`                                        |
| POST   | `/notifications/:notificationId/read` | → `{ id, read: true, unread }`                                   |

```ts
export interface NotificationView {
  id: string;
  topic: string; // 'booking.accepted', 'quotation.sent', …
  title: string;
  body: string;
  deepLink: string | null; // 'booking/{{bookingId}}' resolved
  criticality: 'critical' | 'standard';
  read: boolean;
  createdAt: string;
}
```

**Rendered in the user's stored `preferredLanguage`, NOT `Accept-Language`** — an inbox
that disagreed with the WhatsApp already on their phone would read as two different
notifications.

`POST /:notificationId/read` returns the **same result** whether the row was already
read, belongs to someone else, or does not exist — distinguishing them would let anybody
enumerate real notification ids. Idempotent.

**There is no push-token endpoint.** No FCM registration route exists.

---

## 16. admin — `/api/v1/admin`

`router.use(authenticate, requireRoles('ops','admin'))` — one guard at the top so a new
endpoint cannot be added un-guarded. Every mutation is audited; `AUDITED_ADMIN_ROUTES`
in `core/audit.ts` is compared against the real Express stack **in both directions** by CI.

| Method   | Path                                                                         | Guard     | Body / query                                                                      |
| -------- | ---------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| GET      | `/admin/summary`                                                             | ops       | —                                                                                 |
| GET      | `/admin/users`                                                               | ops       | `{ ...pagination, q?, role?, status? }`                                           |
| GET      | `/admin/users/:userId`                                                       | ops       |                                                                                   |
| POST     | `/admin/users/:userId/block`                                                 | ops       | `{ reason (3–500) }`                                                              |
| POST     | `/admin/users/:userId/unblock`                                               | ops       | `{ reason }`                                                                      |
| GET      | `/admin/providers`                                                           | ops       | `{ ...pagination, q?, city_id?, badge?, listed?, suspended?, pending_approval? }` |
| GET      | `/admin/providers/:providerId`                                               | ops       |                                                                                   |
| POST     | `/admin/providers/:providerId/approve-entry`                                 | ops       | `{ note }`                                                                        |
| GET      | `/admin/bookings`                                                            | ops       | `{ ...pagination, q?, status?, from?, to? }`                                      |
| GET      | `/admin/bookings/:bookingId/timeline`                                        | ops       | events, quotes, money, what each side was told                                    |
| POST     | `/admin/bookings/:bookingId/otp-unlock`                                      | ops       | `{ note; kind: 'start'\|'end'\|'both' }`                                          |
| POST     | `/admin/bookings/:bookingId/accept`                                          | ops       | accepts **for** the technician the customer chose — never a reassignment          |
| POST     | `/admin/bookings/:bookingId/cancel`                                          | ops       | `{ reason }`                                                                      |
| GET      | `/admin/ledger/journals`                                                     | ops       |                                                                                   |
| GET      | `/admin/ledger/journals/:journalId`                                          | ops       |                                                                                   |
| GET      | `/admin/ledger/position`                                                     | ops       |                                                                                   |
| GET/POST | `/admin/queues/outbox`, `/webhooks`, `/deliveries` + retry/discard/reprocess | ops       |                                                                                   |
| GET      | `/admin/cities`                                                              | ops       |                                                                                   |
| PATCH    | `/admin/cities/:cityId`                                                      | **admin** | policy about how the marketplace runs                                             |
| GET      | `/admin/audit-logs`                                                          | ops       |                                                                                   |
| GET      | `/admin/payout-batches`                                                      | ops       |                                                                                   |

**`GET /admin/audit-logs` scoping:** an `admin` sees everything; an `ops` user is
**forced server-side** to their own actions only. _A filter the client applies is not a
permission._ There is deliberately **no endpoint that writes an audit row** — one would
make the whole table deniable.

---

## 17. Stubs, gaps and oddities

Grepped `src/modules/**` for `TODO`, `FIXME`, `not implemented`, `stub`. **There are
none.** The only hit is a comment in `payments/gateway/fake.ts` saying the fake gateway
is _"a **real** implementation of the contract, **not** a set of stubs."_

The `index.ts` header comment ("The rest are empty routers…") is **stale** — every
listed module now has real handlers.

Two things exist in code but have **no HTTP route**:

1. `refreshAdminSession` / `revokeAdminSession` in `auth/admin-session.ts` — the admin
   console cannot refresh or explicitly log out via HTTP.
2. `GET /auth/admin-only` — an explicitly-labelled demo route whose JSDoc says delete it.

One **duplicate**: `GET /admin/ledger/position` and `GET /admin/payments/ledger/position`
both call `platformPosition` and both return `{ position }`.

---

## 18. Flutter customer-app checklist

**Customer-facing — build these:**

`POST /auth/otp/request` · `POST /auth/otp/verify` · `POST /auth/refresh` ·
`POST /auth/logout` · `GET /auth/me` · `PATCH /auth/me` · `GET /categories` ·
`GET /search/resolve` · `GET /search/providers` · `GET /providers/:id` ·
`GET /providers/:id/slots` · `GET /providers/:id/reviews` · all of `/customers/me/*` ·
`POST /bookings` · `GET /bookings` · `GET /bookings/:id` · `POST /bookings/:id/cancel` ·
`POST /bookings/:id/decline-work` · `GET /bookings/:id/quotations` ·
`POST /quotations/:id/approve` · `POST /quotations/:id/reject` ·
`POST /bookings/:id/coupon` · `DELETE /bookings/:id/coupon` ·
`POST /bookings/:id/payments` · `GET /bookings/:id/payments` ·
`POST /payments/:id/checkout-callback` · `POST /bookings/:id/reviews` ·
`GET /bookings/:id/reviews` · `POST /reviews/:id/report` ·
`POST /bookings/:id/complaints` · `GET /complaints` · `GET /complaints/:id` ·
`POST /provider-photos/:photoId/report` · all of `/notifications/*` · `GET /health`

**Technician-only — future partner app:** everything under `/providers/me/*`, all of
`/verification/*`, the booking transitions `accept`/`reject`/`en-route`/`start`/`complete`,
plus `POST /bookings/:id/quotations`, `POST /quotations/:id/withdraw`,
`POST /bookings/:id/payments/cash`.

**Dual-role note:** `POST /providers/me/register` is `authenticate`-only, so a customer
in the Flutter app can become a technician. `GET /bookings?side=provider` and the
cancel/reviews/complaints/quotation-list routes are role-agnostic.
