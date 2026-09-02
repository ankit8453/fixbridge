# QA Test Report — fixbridge

|                      |                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build under test** | `250b62f` (Confirm every action with a toast, on both surfaces)                                                                             |
| **Date**             | 31 August 2026                                                                                                                              |
| **Environment**      | Local — Postgres 16 (Docker), Redis 7, MinIO, API `:3001`, Web `:3000`                                                                      |
| **Method**           | Black-box. Real HTTP against the running API, real browser rendering, database invariants read directly. No test imported application code. |
| **Coverage**         | 113 checks: 28 API · 22 booking lifecycle · 17 ops console · 29 UI routes · 17 data-integrity invariants                                    |

---

## Status — all defects fixed (31 Aug 2026)

Every defect below has been fixed and verified. The full API suite now passes
**1,078 of 1,078** — the first fully green run, since DEF-003 turned out to be the
root cause of the three failures carried for weeks as "pre-existing".

| Defect                                  | Status    | Verified by                                                                                                                     |
| --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| DEF-003 · coupon routes unauthenticated | **Fixed** | Anonymous read now 401; create/pause/resume now 201/200/200 (were 500). Two regression tests walk every admin route anonymously |
| DEF-001 · Redis never reconnects        | **Fixed** | Retry backs off to a 5-second cap and never gives up. Three unit tests pin the policy                                           |
| DEF-002 · malformed JSON returns 500    | **Fixed** | Now 400 `BAD_REQUEST`. Regression test added                                                                                    |
| DEF-004 · queue pagination mismatch     | **Fixed** | Both `page_size` and `pageSize` accepted                                                                                        |

Two further defects were found _while_ fixing these, and are also fixed:

- **`marketing_discount` had the wrong balance sign.** The `account_balances` view
  signs balances so that positive means "holds value", naming the debit-natured
  account types explicitly. The expense account added in an earlier session was
  never added to that list, so a platform-funded coupon read as a **gain** of
  ₹109.80 rather than a spend. Fixed by replacing the view; no data rewritten.
- **Production could boot with development OTP limits.** Recommendation 5 asked
  somebody to remember to check this before launch. The boot now refuses instead:
  `OTP_MAX_PER_PHONE` above 10 in production is a startup error that names the
  field and the ceiling.

The report as originally filed follows, unchanged.

---

## Verdict (as filed)

**Not ready for production.** One critical security defect must be fixed before any public deployment; three lower-severity defects should be fixed before launch.

The product's core trust mechanisms — the ones the marketing site makes promises about — are **sound and verified working**: the agreed price is genuinely locked, the OTP handshake genuinely gates work, phone numbers are genuinely withheld until acceptance, and money arithmetic is exact. Those held up under deliberate attempts to break them.

| Severity     | Count | Must fix before       |
| ------------ | ----- | --------------------- |
| **Critical** | 1     | Any public deployment |
| **High**     | 1     | Launch                |
| **Medium**   | 1     | Launch                |
| **Low**      | 1     | Convenient            |

---

## Defects

### DEF-003 · CRITICAL · Coupon admin routes are completely unauthenticated

Anyone on the internet can read every discount code.

```
curl http://localhost:3001/api/v1/admin/coupons?page=1&page_size=5
→ 200, full coupon list: codes, values, limits, redemption counts
```

No token, no session, no cookie.

**Root cause** — `apps/api/src/modules/index.ts` lines 87–88:

```js
app.use(`${API_PREFIX}/admin/coupons`, couponsOpsRouter); // matched first
app.use(`${API_PREFIX}/admin`, adminRouter); // never reached
```

`adminRouter` is what calls `authenticate`. The coupon router is mounted as a **sibling before it**, so Express matches `/admin/coupons` there and the auth middleware never runs. `couponsOpsRouter` calls `requireRoles('admin')` on its mutations but never calls `authenticate` itself.

The source comment asserts the opposite of what the wiring does:

> _"Mounted under `/api/v1/admin`, so the admin router's `requireRoles('ops','admin')` … already apply."_

**Impact**

1. Live discount codes leak to anyone. Coupons are platform-funded, so this is direct cash loss.
2. Every coupon mutation returns **500**, because `requireRoles` runs with `req.user` undefined and throws `AppError.internal("requireRoles used without authenticate")`. Coupon create/pause/resume are broken in the console.
3. **This is the root cause of the three long-standing failing tests** (`admin-only route`, coupon ledger, notifications quote-total) that have been carried as "pre-existing" for several sessions.

**Blast radius — verified contained to coupons.** Every other ops router returns 401 anonymously: `verification`, `payments`, `complaints`, `reviews`, `trust`, `provider-photos`, `admin/summary`.

**Fix:** add `opsRouter.use(authenticate, requireRoles('ops', 'admin'));` at the top of `couponsOpsRouter`, matching every other ops router. Keep the per-route `requireRoles('admin')` on mutations. Correct the comment. Add a regression test asserting `GET /api/v1/admin/coupons` returns 401 with no token.

---

### DEF-001 · HIGH · Redis never reconnects after a transient outage

**Reproduce:** stop Redis, start it again, confirm `redis-cli ping` returns PONG, then poll `/health`.

**Expected:** `checks.redis` returns to `ok`.
**Actual:** stays `"fail"` indefinitely. Only an API restart recovers. Postgres, by contrast, reconnects on its own.

**Root cause:** `retryStrategy` in `core/redis.ts` returns `null` after `MAX_RECONNECT_ATTEMPTS = 3` at 100 ms apart — about 300 ms. Any outage longer than that (a Docker start takes ~40 s) latches `useMock = true` for the process lifetime.

**Impact:** every Redis-backed feature silently falls back to a per-process in-memory mock — OTP storage, rate limits, distributed job locks, cache. On more than one API instance this is worse than an outage: two processes hold _different_ OTP maps, so a booking code issued by one is rejected by the other. Rate limits also reset to empty, removing brute-force protection on OTP verification.

**Fix:** retry on a capped backoff indefinitely — `Math.min(attempt * 200, 5000)` — rather than returning `null`. The `ready` handler already clears `useMock`, so reconnection alone restores real Redis. The fallback itself is good design; the defect is that it is a one-way door.

---

### DEF-002 · MEDIUM · Malformed JSON returns 500 instead of 400

```
PATCH /api/v1/customers/me   body: { this is not json
→ 500 INTERNAL_ERROR, "हमारी तरफ़ से कुछ गड़बड़ हुई है" ("something went wrong at our end")
```

The message blames the server for the client's mistake; 5xx rates are the usual alerting signal, and a client sending junk should not be able to inflate them. `express.json()` already throws a `SyntaxError` carrying `status: 400` — the error handler is not honouring it.

**Fix:** in the error handler, treat a body-parser `SyntaxError` (or any error carrying a 4xx `status`/`statusCode`) as that status.

_Note: the stack trace visible in dev responses is **not** a defect — `includeStack` is dev-only and explicitly documented. Confirm it stays false in production config._

---

### DEF-004 · LOW · `/admin/verification/queue` uses a different pagination parameter

```
?page=1&page_size=5  → 400 VALIDATION_ERROR  Unrecognized key: "page_size"
?page=1&pageSize=5   → 200
```

Every other admin list takes `page_size`. Because the schema is `.strict()`, a naming slip becomes a hard 400 rather than a default. A trap for the Flutter app and any new client.

**Fix:** accept `page_size`, optionally keeping `pageSize` as an alias.

---

## What passed — and was genuinely attacked

### Trust and money (the product's core promises)

| Verified                                                                         | Evidence                                                                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Agreed price is locked to the booking                                            | Sent `labourPaise: 1000` against an agreed ₹550 — server ignored the client figure and stored **55000** |
| A falsified agreed figure is refused                                             | Sent `agreedLabourPaise: 999999` → **400**                                                              |
| Extra labour without a reason is refused                                         | → **400 QUOTATION_LABOUR_INVALID**                                                                      |
| Extra labour with a reason is accepted, and the split is visible to the customer | → **201**, `extraLabourPaise` and reason both present in the customer's view                            |
| Job cannot complete while a quote awaits decision                                | → **4xx QUOTATION_PENDING**                                                                             |
| Technician cannot approve their own quotation                                    | → **4xx**                                                                                               |
| Quotation total = labour + parts                                                 | Exact to the paisa                                                                                      |

### The OTP handshake

| Verified                                               | Evidence                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Start code withheld before acceptance                  | `startOtp: null`                                                                                            |
| **Technician cannot read the start code from the API** | `null` on the provider view even after acceptance — the code only reaches them from the customer, in person |
| Wrong code refused                                     | **4xx**                                                                                                     |
| Correct code starts the job                            | **200**                                                                                                     |

### State machine and authorization

Work cannot start before acceptance · a job cannot complete before it starts · a stranger cannot accept someone else's booking · a slot cannot be double-booked · customer tokens cannot reach technician or ops routes · technician tokens cannot reach ops routes · `alg:none` JWT forgery refused · another party's booking id returns 404, never data.

### Privacy

Phone masked before acceptance, revealed after · own phone masked in the session payload · **no raw identity numbers anywhere** — 176 verification events scanned, zero 12-digit runs outside phone fields, no `idLast4` longer than four characters.

### Data integrity — 17 invariants, all holding

All money is whole paise · every quotation total equals labour + parts · every labour split adds up · every extra charge has a reason · at most one live quotation per booking · **every ledger journal balances** · no technician committed twice at the same hour · no negative amounts · every listed technician has a priced service.

### Rate limiting

OTP requests throttled per phone and per IP; admin login throttled per email and per IP. Verified with 115 requests against a cap of 100: **84 accepted, 31 × 429**.

### UI — 29 routes across four surfaces, both locales

28 rendered clean. Marketing (9 routes, desktop + mobile), customer app (4), partner app (9 English + 3 Hindi), all with **zero JavaScript errors, no raw i18n keys, no horizontal scroll on a 390 px phone**.

---

## Investigated and dismissed (not defects)

Recorded so they are not re-raised.

| Observation                                    | Finding                                                                                                                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer token reached `/providers/me` (200)   | Test-data error — both fixtures held _both_ roles. Retested with a customer-only account: **403**                                                                                                                             |
| `/providers/not-a-uuid` returns 401 not 404    | By design — the public route's path pattern only matches a 36-char uuid, so a non-uuid falls through to authenticated routes. No leak, no crash                                                                               |
| Public profile 404 for a listed provider       | Fixture had `user.status = 'blocked'`. A fully eligible provider returns **200**. The uniform 404 across missing/unlisted/suspended is deliberate, so the endpoint cannot be used to discover that a technician was suspended |
| No 429 in a 12-request burst                   | Local `.env` raises `OTP_MAX_PER_PHONE` to 100 for development. Limiter verified working at 115 requests. **Confirm production uses the code default (5), not the dev override**                                              |
| Quotation below the agreed rate accepted (201) | Correct — the server ignores the client's figure and stores the agreed amount. The customer cannot be undercharged and the technician cannot manipulate it                                                                    |
| 40 audit rows with no actor                    | All predate the staff-actor fix (`b22bd00`, 26 Aug). A live audited action today records `actorAdminId` correctly — verified by suspending and reinstating a technician                                                       |
| 13 verification events with "12-digit runs"    | Phone numbers (`+91` plus 10 digits). Naive regex on my part; no identity leak                                                                                                                                                |
| 2 bookings "billed above the approved quote"   | Fixed-price bookings with no quotation. Payable = price card + visit fee, exactly correct, and the stored breakdown labels the basis as `price_card`                                                                          |
| Marketing `/` blank on first load              | Vite dev-server cold compile. Renders 3,943 chars at 1.5 s on every subsequent load, zero JS errors. Would not occur against a production build                                                                               |

---

## Recommendations

**Before any public deployment**

1. Fix **DEF-003**. It is a live financial data leak and a one-line fix.
2. Re-run the three long-failing tests afterwards — they should go green, since DEF-003 is their root cause.

**Before launch**

3. Fix **DEF-001** — multi-instance OTP divergence would be very hard to diagnose in production.
4. Fix **DEF-002**.
5. Audit `.env` for production: confirm `OTP_MAX_PER_PHONE` is not the dev value of 100, `includeStack` is false, and `BOOKING_OPS_ACCEPT_ENABLED` reflects the intended pilot state.

**Not blocking**

6. Fix **DEF-004** before the Flutter app is written against the API.

---

## Coverage gaps

Flagged, not tested in this pass:

- Payment capture against a real gateway (test keys only, no live transaction)
- The notification/outbox delivery path end to end
- File upload limits under adversarial input
- Two clients booking the same slot simultaneously (single-threaded double-booking was tested and correctly refused)
