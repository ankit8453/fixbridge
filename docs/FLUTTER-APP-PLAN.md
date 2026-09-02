# Flutter customer app — build plan

|                      |                                                                            |
| -------------------- | -------------------------------------------------------------------------- |
| **Scope**            | Customer app only. The 5 pilot technicians keep the partner web dashboard. |
| **Visual direction** | Modern but light — motion, not media. No video, no heavy Lottie.           |
| **Target device**    | ₹8–15k Android, 4G that drops, screen read in daylight                     |
| **Backend**          | Unchanged. Every endpoint the app needs already exists and is tested.      |
| **API base**         | `/api/v1` · health at `/health` (outside the prefix)                       |

---

## 1. What the app is not allowed to forget

These come from the backend as it actually is, not as one might assume. Each
one has bitten a client before.

1. **There is no realtime.** No WebSocket, no SSE anywhere in `apps/api/src`.
   Booking status, the unread badge and payment capture are all **polled**.
2. **Refresh tokens rotate and are single-use.** Presenting a rotated token
   revokes every token for that device. Two concurrent 401s that each fire a
   refresh will log the user out. **Refreshes must be serialised.**
3. **`deviceId` is client-generated and stable per install.** It is baked into
   the access token and the refresh token is bound to it. Regenerating it on
   every launch breaks refresh permanently.
4. **Money is integer paise, always.** The server also sends a formatted
   `…Display`. Render the display string; never re-format the number.
5. **`labelKey` is an i18n key, not display text.** `PayableComponent.labelKey`
   must be looked up, not printed.
6. **The notification inbox renders in the user's stored `preferredLanguage`**,
   not `Accept-Language`. Everything else follows `Accept-Language`.
7. **`page_size` (snake) in, `pageSize` (camel) out.** Ten endpoints are not
   paginated at all and return whole arrays.
8. **The end OTP only exists while `status === 'IN_PROGRESS'`.** Caching the
   booking detail and showing a stale end code is a real failure mode.
9. **Nothing cancels after ARRIVED.** The cancel button must disappear, not
   fail.
10. **Checkout callback does not mean paid.** It sets `checkoutVerifiedAt`;
    `status` stays `created` until the webhook lands. Poll for `captured`.

---

## 2. Screen map — every screen against its endpoints

### 2.1 Onboarding

| Screen                      | Endpoints                | Notes                                                                                                                                                                                       |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language picker             | —                        | Local only until sign-in; then `PATCH /auth/me`. Hindi is the default (`DEFAULT_LOCALE = 'hi'`).                                                                                            |
| Phone entry                 | `POST /auth/otp/request` | Returns masked phone + `expiresInSeconds`. Three separate 429s: `details.scope` is `cooldown` (60s resend), `phone` (5/window), `ip` (30). Show the right message for each.                 |
| OTP entry                   | `POST /auth/otp/verify`  | 6 digits, `deviceId` required. `401 OTP_INVALID` covers both wrong-code and no-pending-code — do not try to distinguish them in copy. After 5 attempts the code is cleared and you get 429. |
| Name / city (new user only) | `PATCH /customers/me`    | Only when `isNewUser: true`. Skippable.                                                                                                                                                     |

**Browse-before-signup is supported.** `GET /categories`, `/search/resolve`,
`/search/providers`, `/providers/:id`, `/providers/:id/slots` and
`/providers/:id/reviews` are all public. The app should let a first-time user
search and open a profile, and only ask for a phone number at _Book_.

### 2.2 Home

`GET /categories?cityId=` → cluster/service tree with `providerCount` (cached
5 min server-side — a browsing hint, not a live number). Plus
`GET /bookings?side=customer` for the active-booking strip at the top.

### 2.3 Search

| Step              | Endpoint                                                                  |
| ----------------- | ------------------------------------------------------------------------- |
| As the user types | `GET /search/resolve?q=&limit=8` — debounce 250 ms, works in both scripts |
| Results           | `GET /search/providers?lat=&lng=&…`                                       |

`lat`/`lng` are **required**. Source order: the selected address → last known
GPS → city centroid. The availability trio (`date`, `start_time`, `end_time`)
is all-or-nothing — send all three or none, or it is a 400 on path `['date']`.
Sort: `rank` (default) | `distance` | `price_low`.

Results carry `distanceKm` rounded to 0.1 and a `locality` string — never
coordinates. The card renders badge, rating (`null` until rated — show
"New", never a fabricated 0.0), `jobsCompleted`, `startingPrice.display`.

### 2.4 Provider profile

`GET /providers/:id` + `GET /providers/:id/slots?from=&to=` +
`GET /providers/:id/reviews?page=&page_size=`.

404 is deliberately uniform for missing / unlisted / suspended. Copy must be
"This technician isn't available right now" — never "suspended".

Only `open` slots come back. There is no way to see which hours are booked,
by design.

### 2.5 Booking

`POST /bookings` with `{ slotId, categoryId, addressId, priceCardId?, problemNote? }`.

Address is chosen from `GET /customers/me/addresses`; new ones via
`POST /customers/me/addresses` (`lat`/`lng` optional but must travel together
— a lone `lat` is a validation error).

### 2.6 Booking detail — the app's centre of gravity

`GET /bookings/:id`, polled. This one screen changes shape eleven times.

| Status                                 | What the screen shows                                                    | Actions                                                       |
| -------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `REQUESTED`                            | Waiting for response + a countdown to `BOOKING_REQUEST_TTL_MINUTES` (60) | Cancel                                                        |
| `ACCEPTED`                             | **Start OTP**, counterpart name + revealed phone + photo                 | Call · Cancel                                                 |
| `EN_ROUTE`                             | On the way                                                               | Call · Cancel                                                 |
| `ARRIVED`                              | At your door                                                             | Call · **Raise complaint** (from ARRIVED onwards). No cancel. |
| `IN_PROGRESS`                          | **End OTP** appears. Quotation card if one is pending.                   | Approve / Reject quote · Decline work · Complaint             |
| `WORK_DONE`                            | Payable breakdown, pay button, review prompt                             | Pay · Review · Complaint                                      |
| `CLOSED_QUOTE_DECLINED`                | Visit fee only                                                           | Pay · Complaint                                               |
| `REJECTED` / `EXPIRED` / `CANCELLED_*` | Terminal, with reason                                                    | Book again                                                    |

Polling cadence — this is a battery and data decision, not a UI one:

- `REQUESTED`: every **10 s** (the customer is watching)
- `ACCEPTED` / `EN_ROUTE` / `ARRIVED` / `IN_PROGRESS`: every **20 s**
- Foreground only. Stop on `AppLifecycleState.paused`, refetch once on resume.
- Terminal statuses: stop entirely.

### 2.7 Quotations

`GET /bookings/:id/quotations` → full version history, both sides, itemised.

The approval sheet must show the labour split honestly, because that split is
the whole point of the feature:

```
Agreed labour        ₹550    (what you booked)
Extra labour         ₹200    ← with extraLabourReason quoted verbatim
Parts                ₹340    (itemised)
─────────────────────────
Total                ₹1,090
```

`POST /quotations/:id/approve` (no body) · `POST /quotations/:id/reject`
(`{ reason? }`). **Reject is not the same as decline-work** — reject invites a
revision, `POST /bookings/:id/decline-work` ends the job and makes the visit
fee payable. Two visually distinct actions, and decline-work needs a
confirmation sheet that says the visit fee will be charged.

### 2.8 Payment

Package: **`razorpay_flutter`** (395 likes, ~78k weekly downloads — the
healthiest of the options).

```
POST /bookings/:id/payments          → { orderId, keyId, amountPaise, currency, reused }
  ↓ Razorpay.open({ key: keyId, order_id: orderId, amount: amountPaise, currency })
  ↓ PaymentSuccessResponse → orderId, paymentId, signature
POST /payments/:paymentId/checkout-callback
     { razorpay_order_id, razorpay_payment_id, razorpay_signature }
  ↓ status is still `created`
GET  /bookings/:id/payments  — poll every 4 s, up to ~2 min, until `captured`
```

- Calling start twice returns the **same order** (`reused: true`). Safe to
  retry; never create a second order.
- `EXTERNAL_WALLET` and `PAYMENT_ERROR` handlers are mandatory — dropping them
  leaves the sheet hanging.
- If polling times out, the copy is "We're confirming your payment" with a
  refresh affordance — **never** "payment failed". The webhook is the truth
  and it may simply be late.
- Coupons: `POST /bookings/:id/coupon { code, paymentMethod }` before starting
  payment. `paymentMethod` is required, not inferred. A coupon is refused once
  a payment row exists — so the coupon field must disappear after start.

### 2.9 Reviews, complaints, notifications, account

| Screen          | Endpoints                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Leave review    | `POST /bookings/:id/reviews` — 1–5 stars, ≤5 tags from `punctual, polite, fair_price, clean_work, expert`, optional text ≤500 |
| Report a review | `POST /reviews/:reviewId/report { reason }`                                                                                   |
| Report a photo  | `POST /provider-photos/:photoId/report { reason }` — **currently missing from the web app; the Flutter app should have it**   |
| Raise complaint | `POST /bookings/:id/complaints { category, description }` — 7 categories, description 10–1000                                 |
| Complaint list  | `GET /complaints`, `GET /complaints/:id` — not paginated                                                                      |
| Inbox           | `GET /notifications`, `/unread-count`, `POST /:id/read`, `/read-all`                                                          |
| Account         | `GET /auth/me`, `PATCH /auth/me` (language), `GET                                                                             | PATCH /customers/me`, addresses CRUD |

`deepLink` on a notification is a resolved path like `booking/<uuid>` — route
it, don't display it.

---

## 3. Architecture

```
lib/
  core/
    api/          dio client, interceptors, error envelope, refresh mutex
    config/       API base, flavours
    theme/        tokens, typography, motion durations
    l10n/         .arb — hi (default) + en
  data/           models (freezed) + repositories, one per API module
  features/       auth, home, search, provider, booking, payment,
                  reviews, complaints, notifications, account
  shared/         widgets — cards, sheets, states, skeletons
```

**State:** Riverpod 2 with codegen. Rationale: the app is almost entirely
server state with polling, and `AsyncNotifier` + `ref.invalidate` maps onto
that with far less ceremony than BLoC events for CRUD screens.

**Routing:** `go_router`, so notification `deepLink` values route directly.

**Models:** `freezed` + `json_serializable`. Hand-writing ~40 response shapes
is where field-name typos live.

**Storage:** `flutter_secure_storage` for refresh token + `deviceId`.
`shared_preferences` for locale and last city. Nothing else persists — a
stale cached booking showing a wrong OTP is worse than a spinner.

### 3.1 The Dio interceptor — the piece most likely to be got wrong

```dart
// One refresh at a time, for everybody. The backend revokes every token for
// the device when it sees a rotated one presented twice, so two 401s racing
// into two refreshes is not a slow path — it is a logout.
Future<String>? _inflight;

Future<String> _refresh() => _inflight ??= _doRefresh().whenComplete(() {
  _inflight = null;
});
```

Error handling by code, from `error.code` in the envelope:

| Code                                                                  | Action                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------- |
| `AUTH_TOKEN_EXPIRED`                                                  | Refresh silently, replay the request once               |
| `AUTH_TOKEN_INVALID`, `AUTH_SESSION_REVOKED`, `REFRESH_TOKEN_INVALID` | Clear session, route to sign-in                         |
| `ACCOUNT_BLOCKED`                                                     | Blocked screen with support contact                     |
| `VALIDATION_ERROR`                                                    | Map `details[]` onto form fields by `field`             |
| `RATE_LIMITED`                                                        | Honour `Retry-After`; message chosen by `details.scope` |
| everything else                                                       | Show `error.message` — it is already localised          |

Headers on every request: `Authorization: Bearer`, `Accept-Language: hi|en`.

### 3.2 Patchy 4G

- Connect 10 s, receive 20 s.
- Retry **GET only**, twice, 1 s → 3 s. **Never retry POST** — `POST /bookings`
  and `POST /bookings/:id/payments` are not idempotent from the client's side.
- Every list screen has three real states: skeleton, empty (with a way
  forward), error (with Retry). No bare spinners.
- Offline banner from `connectivity_plus`, and queue nothing — a booking that
  silently fires twenty minutes later is worse than one that failed loudly.

---

## 4. Design system

Continuous with the web customer app so the two read as one product.

| Token     | Value     | Use                                      |
| --------- | --------- | ---------------------------------------- |
| `primary` | `#7e22ce` | Actions, active state — 6.82:1 on white  |
| `bright`  | `#a855f7` | **Decorative only** — 3.87:1, never text |
| `deep`    | `#6b21a8` | Pressed, headers                         |
| `soft`    | `#faf5ff` | Tinted surfaces                          |
| `accent`  | `#f0a04b` | Gold — badges, ratings                   |
| `ground`  | `#fdfcfd` | Page                                     |
| `ink`     | `#1c1721` | Body text                                |
| `inkSoft` | `#6b6472` | Secondary — 5.56:1                       |
| `line`    | `#ece7f0` | Dividers                                 |

Type: **Inter** for Latin, **Noto Sans Devanagari** for Hindi, bundled as
assets rather than fetched (a font that fails to download on 4G leaves a page
of boxes).

Motion budget — the "motion, not media" direction, concretely:

| Moment          | Technique                                                | Duration              |
| --------------- | -------------------------------------------------------- | --------------------- |
| Card → profile  | `Hero` on avatar + name                                  | 320 ms `easeOutCubic` |
| Status advance  | `AnimatedContainer` on the timeline rail, node scale-in  | 400 ms                |
| OTP reveal      | Staggered digit fade + slide, 40 ms apart                | 240 ms                |
| Payment success | Draw-on tick via `CustomPainter` + `AnimationController` | 500 ms                |
| List load       | Shimmer skeleton                                         | 1.2 s loop            |
| Bottom nav      | Icon morph + colour lerp                                 | 200 ms                |
| Sheets          | `showModalBottomSheet` with a drag handle                | default               |

All wrapped in `MediaQuery.disableAnimationsOf(context)` checks. No video, no
Lottie file over ~50 KB, no autoplaying anything. Illustration is drawn — SVG
via `flutter_svg` for empty states, `CustomPainter` for the status rail.

Haptics: `HapticFeedback.lightImpact()` on OTP digit entry and quote approval;
`mediumImpact` on payment success. Nothing else.

---

## 5. Build order

| Phase  | Content                                                                    | Why here                                    |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------- |
| **1**  | Project, theme, l10n, Dio + refresh mutex, error envelope, secure storage  | Nothing works without the interceptor       |
| **2**  | Auth: language → phone → OTP → session                                     | Gate for everything else                    |
| **3**  | Home, categories, search, resolve, provider profile, reviews               | The public half; testable without a booking |
| **4**  | Addresses, slots, `POST /bookings`                                         | First write path                            |
| **5**  | Booking detail, polling, status timeline, OTP display, cancel              | The core screen                             |
| **6**  | Quotations: history, split display, approve / reject / decline-work        | Highest correctness risk                    |
| **7**  | Coupons + Razorpay + capture polling                                       | Needs a live-ish gateway                    |
| **8**  | Reviews, complaints, photo report                                          | Post-job                                    |
| **9**  | Notifications, deep links, account                                         | Retention                                   |
| **10** | Empty/error states, skeletons, motion pass, Hindi proofread, release build | The part that gets skipped                  |

Phases 1–2 and 3 are the only hard sequence; 8 and 9 can run in parallel with 7.

---

## 6. Things the backend will need (small, none blocking)

1. **Push notifications.** There is no FCM token endpoint. Today the app can
   only poll and rely on WhatsApp. A `POST /notifications/devices
{ token, platform }` would be the one genuinely new endpoint. Not required
   for v1 — WhatsApp already carries the critical messages.
2. **`GET /providers/:id` does not expose the technician's photo** to a
   browsing customer. `BookingDetail.counterpart.photoUrl` only appears after
   acceptance. Worth deciding deliberately rather than by omission.
3. **`GET /admin/verification/queue`** now accepts both pagination spellings
   (DEF-004), so no client trap remains.

---

## 7. Out of scope for v1

- Partner app — the 5 pilot technicians use the web dashboard.
- Live technician location on a map. The backend deliberately never exposes
  provider coordinates, and adding it would be a privacy decision, not a
  feature decision.
- In-app chat. WhatsApp plus the revealed phone number covers it.
- iOS. Android first; the codebase is Android-shaped and the pilot is
  Jabalpur.
