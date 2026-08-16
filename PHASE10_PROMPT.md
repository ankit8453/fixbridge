# PHASE 10 PROMPT — Notifications

You are building **Phase 10 of 15** of the `fixbridge` marketplace. (Plan update: the old Phase 12 has become a Next.js web app phase; Flutter customer/partner apps are 13/14; hardening/launch is 15. Update stub comments/docs where they mention the old numbering.) Phases 1–9 are on `main`: the full transactional core plus the trust engine. Read `docs/summaries/phase09-summary.md` and `docs/trust.md` first. All established patterns apply.

**Why this phase matters:** every event so far happens silently. A booking request a mistri never hears about expires; a suspension nobody explains loses a technician forever; a cash payment the customer isn't told about invites fraud. This phase is retention and fraud-sunlight infrastructure, not "sending texts."

---

## Carry-overs from Phase 9 review (do first)

1. **Nightly trust recompute.** A Redis-locked daily job recomputing trust for every active provider, so recency decay applies to inactive technicians without waiting for an event. Reuses the existing recompute path; snapshots only written when the score changes (avoid 200 identical rows/day). Test with injected clock: provider with no events for 45 days → score drops on the nightly run.
2. **`preferred_language` on users** (`hi` | `en`, default `hi`), settable via a profile endpoint. Async notifications can't read an Accept-Language header — this column is how every message knows its language. Backfill existing rows to `hi`.

---

## Context (frozen decisions in force)

- **Transports behind an interface.** `MessageTransport`: `send(to, renderedMessage, meta) → { transportRef }` with implementations: `FakeTransport` (tests — records calls, controllable failures), `ConsoleTransport` (dev — pino-logs the rendered message), `Msg91SmsTransport` + `WhatsappTransport` (real HTTP shapes coded against MSG91/WhatsApp Cloud API docs, but constructor-gated on credentials config — **no credentials, never instantiated**; DLT paperwork is in progress and these must be drop-in when it clears). Channel→transport mapping in config: `NOTIFY_SMS_TRANSPORT=console|fake|msg91`, etc. Production config refuses `fake` (same pattern as the payment gateway).
- **Three channels:** `in_app` (always on — the inbox table), `whatsapp` (primary external — cheap, rich, no DLT), `sms` (fallback-critical only — every SMS costs money and needs DLT templates). Routing per topic decides channels + audience.
- **Templates live in i18n files, not DB.** Each template = title key + body key with typed params (e.g., `notif.booking.accepted.body` with `{providerName, time, otp}`), rendered via the existing i18n util in the *recipient's* `preferred_language`. Every template exists in hi AND en — a missing-key test enumerates all templates × both locales. Hindi is the primary text, written for a Jabalpur customer, not translated bureaucratese.
- **Criticality classes:** `critical` (OTPs in messages, booking accepted/cancelled day-of, suspension, cash-recorded confirmation) — delivered immediately, any hour; `standard` (everything else) — respects quiet hours 22:00–07:00 IST (config): queued and released at window-open by the scheduler, not dropped. Class is part of the routing table.
- **Idempotency at the delivery layer.** The outbox delivers at-least-once; a redelivered event must not re-message a human. Unique constraint on `(topic, aggregate_id, recipient_user_id, channel)` in `notification_deliveries`; insert-or-skip semantics, tested by replay.
- **Notifications NEVER contain:** full phone numbers of the other party (the app is where unmasking lives), payment card/UPI details, or KYC facts. OTPs for booking handshakes DO go out (that's their delivery path for web users) — start OTP to customer on acceptance, in the critical class.

---

## Phase 10 scope

### 1. Data model
- `notifications` (the in-app inbox): id, user_id, topic, title_key, body_key, params jsonb, deep_link (string route hint for the future apps, e.g. `booking/{id}`), criticality, read_at (nullable), created_at. Index (user_id, created_at desc).
- `notification_deliveries`: id, notification_id FK, channel, transport, status (`queued` | `sent` | `failed` | `suppressed_quiet_hours` → later `sent`), transport_ref, attempts, last_error, scheduled_for (nullable — quiet-hours release time), sent_at. The unique idempotency constraint above.
- Retry: failed external sends retry via the existing outbox backoff machinery (max attempts config, then parked — Phase 11 ops view).

### 2. Routing table (data, not code — a `notification_routes` config module or table; your call, document)
Topic → { audiences, channels per audience, criticality, template keys }. Wire AT MINIMUM:

| Topic | Audience → channels | Class |
|---|---|---|
| `booking.requested` | provider → in_app + whatsapp | critical |
| `booking.accepted` | customer → in_app + whatsapp (incl. start OTP + provider first name) | critical |
| `booking.rejected` / `booking.expired` | customer → in_app + whatsapp ("try another technician" + deep link to search) | critical |
| `booking.cancelled_by_*` | the other party → in_app + whatsapp | critical |
| `quotation.sent` | customer → in_app + whatsapp (total + deep link) | critical |
| `quotation.approved/rejected` | provider → in_app | standard |
| `payment.captured` | customer → in_app (receipt summary); provider → in_app (net credited to wallet) | standard |
| `payment.cash_recorded` | **customer → in_app + whatsapp + sms** ("₹X cash recorded for your booking — not you? reply/complain") | critical — this is the anti-fraud sunlight |
| `provider.suspended` | provider → in_app + whatsapp + sms (reason code i18n'd + how to reach ops) | critical — mandatory per Phase 9 |
| `provider.badge_changed` (emit if missing) | provider → in_app + whatsapp (congratulation on SILVER/GOLD — retention) | standard |
| `complaint.opened` | against-party → in_app; | standard |
| `complaint.resolved` | both parties → in_app | standard |
| `payout.paid` (emit if missing) | provider → in_app + whatsapp (amount + UTR) | standard |

Adding a route must require zero code outside the table + templates. Unroutable topics no-op silently (logged debug).

### 3. The consumer
- One outbox consumer subscribing to all routed topics: resolve recipients (from the aggregate — booking's customer/provider etc.), create `notifications` row + `notification_deliveries` per channel in one tx, dispatch external sends (respecting quiet hours via `scheduled_for`), in-app is "delivered" by existence.
- Quiet-hours release job: Redis-locked, every 5 min, sends due `suppressed_quiet_hours` deliveries. Clock-injected tests.
- Renderer: template + params + recipient language → final string; params validated against template (missing param = build-time/test failure, not runtime `undefined` in a customer's WhatsApp).

### 4. Endpoints
- `GET /api/v1/notifications` (paginated, own), `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`.
- Profile endpoint gains `preferred_language` get/set.
- (Ops parked-deliveries view is Phase 11; the data shape lands now.)

### 5. Seed
- Deterministic notifications + deliveries consistent with the seeded booking/payment/suspension history (inbox has content for demo users; the suspended provider has their suspension notification with reason).

### 6. Tests
- Routing: every row in the table fires correct audience/channels/class (fake transport asserts recipients + rendered content); unroutable topic no-ops.
- Idempotency: outbox redelivery ×3 → one delivery row per (topic, aggregate, user, channel), one external send.
- Quiet hours: standard at 23:00 IST queues with correct `scheduled_for`, release job sends at 07:00; critical at 23:00 sends immediately. Injected clock.
- Language: `preferred_language=en` user gets English; `hi` gets Hindi; template×locale completeness test; param-validation failure test.
- Content redaction: no full phone numbers in any rendered message (regex test over all fake-transport captures across the whole suite run).
- Retry/backoff on transport failure; parked after max; `payment.cash_recorded` reaches customer on all three channels; suspension message includes reason.
- e2e: full booking lifecycle → assert the exact inbox timeline both sides see, in Hindi.

### 7. Docs
- `docs/API.md` updated. New `docs/notifications.md`: routing table (the actual table), template-authoring guide (how to add topic/template/route), quiet-hours + criticality rules, MSG91/WhatsApp go-live checklist (what plugs in when DLT clears — env vars, template registration mapping our i18n keys to DLT template IDs, sender ID).

---

## Explicitly OUT of scope
Real MSG91/WhatsApp sends (transports coded, credential-gated — DLT pending) · push notifications/FCM (arrives with Flutter, Phase 13 — the deep_link field is its groundwork) · email (not a pilot channel) · user notification preferences beyond language (no per-topic opt-outs in v1 — document) · digests/batching · marketing/promotional messaging (transactional only — also a DLT category distinction that matters legally) · admin broadcast tooling (Phase 11 at most).

---

## Done criteria
1. Routing table drives everything; adding a route = data + templates only (proven by a test that registers a synthetic topic).
2. Idempotency replay proof; quiet-hours behavior clock-proven; language correctness; template×locale completeness; phone-redaction sweep green.
3. `payment.cash_recorded` and `provider.suspended` flows exactly as specified — these two are the phase's soul.
4. `lint/build/typecheck/test` clean; stable ×3; fresh-DB migrations (object inventory intact); idempotent seed.
5. Docs updated including the DLT go-live checklist.

## Final deliverable
`docs/summaries/phase10-summary.md`, standard six-point format. Next phase preview: Phase 11 = admin dashboard — React SPA (Vite+Tailwind per frozen stack) over ops APIs: verification queue, complaint queue, review moderation, parked outbox/webhooks/deliveries, dues settlement, payout batches, suspension lift/extend, booking timeline viewer, and the audit log that every ops action writes.
