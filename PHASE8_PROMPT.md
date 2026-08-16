# PHASE 8 PROMPT — Payments, Ledger & Wallet

You are building **Phase 8 of 14** of the `fixbridge` marketplace. Phases 1–7 are on `main`; bookings reach WORK_DONE / CLOSED_QUOTE_DECLINED with a frozen `payable_paise` + `payable_breakdown` snapshot. Read `docs/summaries/phase07-summary.md` and `docs/bookings.md` first. All established patterns apply (Zod, AppError+i18n, append-only triggers, same-tx outbox, transition tables as data, `fileParallelism: false`, GIST-index migration hazard).

**The two laws of this phase:**
1. **Money exists ONLY as double-entry ledger rows.** No `balance` column anywhere, ever. Balances are SQL views summing `ledger_entries`. Every journal must balance (Σ debits = Σ credits) — enforced by the database, not convention.
2. **The gateway webhook is the only source of payment truth.** A browser/app callback may *optimistically show* success; it never *records* it. Signature-verified, idempotently-processed webhook events move money.

---

## Carry-over from Phase 7 review (do first)

**Snapshot the price card at booking creation.** Add `price_card_amount_paise` + `price_card_type` columns to bookings, populated at creation (nullable for bookings without a card). `computePayable` consumes the snapshot, never the live price card. Backfill migration for seeded/existing rows reads current card values (document that assumption). Test: edit a price card mid-booking → payable unchanged.

---

## Context (frozen decisions in force)

- **Gateway behind an adapter.** `PaymentGatewayAdapter` interface: `createOrder(amountPaise, receipt, notes)`, `verifyWebhookSignature(rawBody, signature)`, `verifyCheckoutSignature(orderId, paymentId, signature)`, `initiateRefund(paymentId, amountPaise, notes)`. Two implementations: `RazorpayGateway` (real SDK, `npm install razorpay`) and `FakeGateway` (in-memory, deterministic ids, helper to emit synthetic webhooks — ALL tests run on the fake; zero network in CI). Selection via config `PAYMENT_GATEWAY=fake|razorpay`, default fake outside production.
- **Config/env:** add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` to the typed config + `.env.example` with placeholder values. Loader requires them only when `PAYMENT_GATEWAY=razorpay`. Ankit pastes real test keys into local `.env` — keys never appear in code, fixtures, or logs.
- **Collection point (pilot decision):** everything is collected at completion. WORK_DONE → customer pays `payable_paise` via UPI/online OR cash-to-technician. Upfront visit-fee-at-booking exists as a config flag `COLLECT_FEE_AT_BOOKING` (city-level, default OFF) — implement the flow (small: an extra payment purpose + refund-on-cancel edge) but the pilot launches with it off. CLOSED_QUOTE_DECLINED → customer pays visit fee only (same two rails).
- **Commission:** `commission_config` table (city_id, category_id nullable, rate_bps, is_active, effective_from) — same resolution chain as fee_config. Seed: Jabalpur default 1200 bps (12%); motors/genset cluster 1000 bps (10% — B2B-ish trades, sweeter for supply). Rate is **snapshotted onto the payment record at collection time**; config changes never touch past money.
- **Account model:** accounts are `(account_type, owner_type, owner_id)` — types: `gateway_cash` (platform's money at gateway), `provider_payable` (we owe technician), `provider_dues` (technician owes us — the cash-path commission), `platform_revenue`, `refunds_payable`. New account rows created lazily.

---

## Phase 8 scope

### 1. Ledger core (build first — everything posts through it)
- `ledger_journals`: id, journal_type (`payment_captured` | `cash_collected` | `refund` | `payout` | `dues_settled` | `adjustment`), booking_id (nullable), payment_id (nullable), memo, created_at. Append-only (trigger).
- `ledger_entries`: id, journal_id FK, account_id FK, direction (`debit` | `credit`), amount_paise (>0 CHECK), created_at. Append-only (trigger). **Balance enforcement:** deferred constraint trigger on journal commit asserting Σdebits = Σcredits per journal — a raw-SQL test must prove an unbalanced journal cannot commit.
- `accounts`: id, account_type, owner_type (`platform` | `provider` | `customer`), owner_id (nullable for platform), unique on the triple.
- Views: `provider_balances` (payable minus dues per provider), `platform_revenue_view`. A `LedgerService.post(journalType, entries[], refs)` is the ONLY write path — repositories elsewhere never insert entries directly.

### 2. Payments (online rail)
- `payments`: id, booking_id, purpose (`final_bill` | `visit_fee_upfront`), amount_paise, commission_bps_snapshot, gateway (`fake` | `razorpay`), gateway_order_id, gateway_payment_id (nullable), status (`created` | `captured` | `failed` | `refunded` | `partially_refunded`), created/updated. Status transitions via transition-table (reuse the pattern).
- `POST /api/v1/bookings/:id/payments` (customer, booking in WORK_DONE or CLOSED_QUOTE_DECLINED, no captured payment yet): creates gateway order for the frozen payable; returns `{ order_id, amount, currency, key_id }` for the future Flutter checkout. Re-calling while `created` returns the same order (idempotent), not a new one.
- `POST /api/v1/payments/:id/checkout-callback` (customer): accepts razorpay_payment_id/order_id/signature, verifies via adapter, marks an **optimistic** flag only (`checkout_verified_at`) — UX may show "processing"; ledger does NOT move.
- **Webhook** `POST /api/v1/webhooks/razorpay` (public, raw-body capture for HMAC): verify signature against `RAZORPAY_WEBHOOK_SECRET` (reject 400 on mismatch); insert into `webhook_events` (id, gateway, gateway_event_id UNIQUE, event_type, payload jsonb, received_at, processed_at, processing_error) — **unique gateway_event_id is the idempotency wall; duplicate delivery = 200 + no-op (test replay ×3 → one ledger journal)**. Process async via the outbox pattern (webhook row → outbox topic → handler), so a slow handler never times out Razorpay's delivery.
- On `payment.captured`: payment → `captured`; post journal: debit `gateway_cash` (gross), credit `provider_payable` (gross − commission), credit `platform_revenue` (commission). Commission from the snapshot bps. Booking gains `paid_at` + outbox `payment.captured` (Phase 10 will notify). On `payment.failed`: mark, allow re-initiation.
- Amount validation: webhook amount must equal expected payable — mismatch parks the event with error (ops visibility Phase 11), never posts.

### 3. Cash rail (the Jabalpur reality)
- `POST /api/v1/bookings/:id/cash-collected` (provider, WORK_DONE/CLOSED_QUOTE_DECLINED, no captured/cash payment): records payment row (gateway `cash`-like: add `cash` to the gateway enum or a `method` column — your call, document), posts journal: debit `provider_dues` (commission amount — he collected our money, owes us the cut), credit `platform_revenue` (commission). Note the asymmetry vs online: only commission moves through us on cash. Outbox `payment.cash_recorded` (customer gets notified in Phase 10 — silent-cash-marking fraud gets sunlight; disputes are Phase 9).
- Provider dues visible in wallet endpoint; `dues_settled` journal type + ops endpoint stub for recording a dues payment (UPI-to-platform reality; full flow is Phase 11 ops work).

### 4. Refunds
- `POST /api/v1/payments/:id/refund` (ops/admin only this phase): full or partial (amount param ≤ captured), adapter `initiateRefund`, `refunds` table (id, payment_id, amount, gateway_refund_id, status created|processed|failed), webhook `refund.processed` completes it: journal reverses proportionally (debit provider_payable + platform_revenue by their shares, credit refunds_payable → then debit refunds_payable / credit gateway_cash on settlement — document the two-step or collapse to one journal, your call, but the provider must bear their share). Visit-fee-upfront refund edge: booking cancelled/EXPIRED with captured upfront fee → auto-refund via outbox consumer (only active when the flag is on; test behind the flag).
- Cash payments are not refundable through us (document).

### 5. Payouts (T+1, pilot-grade)
- `payout_batches` (id, status draft|processing|completed, created_by, window_end, totals) + `payouts` (id, batch_id, provider_id, amount_paise, status pending|paid|failed, utr_ref nullable). 
- Job (daily, Redis-locked) or ops-triggered endpoint: snapshot each provider's positive balance (payable − dues, floor 0, minimum payout threshold config default ₹100) into a batch; marking a payout `paid` (ops enters UTR — pilot = manual bank transfer/UPI; RazorpayX adapter is a stub interface only) posts journal: debit `provider_payable`, credit `gateway_cash`. Batch totals must equal Σ payouts (CHECK/test).
- Provider wallet endpoint: `GET /api/v1/providers/me/wallet` → balance, dues, pending payout, last N journal lines (their accounts only, memo-redacted).

### 6. Seed
- Extend deterministically: 2 online-paid bookings (webhook-simulated, ledger posted), 1 cash booking with dues, 1 refunded, 1 completed-unpaid, one draft payout batch. All ledger views consistent — a seed-validation test asserts every journal balances and `provider_balances` matches hand-computed numbers.

### 7. Tests (money-grade)
- Ledger: unbalanced journal cannot commit (SQL-level); append-only triggers; every service path posts balanced journals; views match hand-computed fixtures.
- Webhook: bad signature 400; replay ×3 = one journal; amount-mismatch parks; raw-body HMAC works with the exact bytes Express received (classic body-parser bug — test it).
- Checkout callback never moves money; capture without callback (browser died) still completes via webhook — **the "browser closed after paying" e2e is mandatory**.
- Cash: journal shape, dues accumulate, dues_settled clears.
- Refund math incl. partial + proportional provider share; upfront-fee auto-refund behind flag.
- Payout: threshold, batch totals, paid → balance drops to 0, dues-heavy provider (negative net) excluded with dues intact.
- Commission snapshot: change config after capture → past journals untouched; resolution chain tested.
- Full e2e ×2 (online + cash): search→book→accept→OTPs→quote→approve→WORK_DONE→pay→ledger→wallet→payout.
- Fake gateway only in CI; a skipped-by-default smoke test hits real Razorpay test API when `PAYMENT_GATEWAY=razorpay` + keys present (Ankit runs locally once).

### 8. Docs
- `docs/API.md` updated. New `docs/money.md`: account model, journal shapes per flow (tables), webhook idempotency design, commission/fee snapshots, payout lifecycle, "the two laws" stated at top. Webhook URL + secret setup steps for the Razorpay dashboard (test mode) so Ankit can configure it when running the smoke test (ngrok/localtunnel note for local webhook delivery).

---

## Explicitly OUT of scope
GST invoices/PDFs (deferred; breakdown data suffices for pilot) · RazorpayX live payout API (stub interface only) · Razorpay Route/split settlement (year-2) · customer wallets/credits · subscriptions & AMC billing (post-pilot) · payment links · EMI/cards-specific flows (UPI-first; whatever checkout offers rides free) · dispute/chargeback handling (Phase 9 complaints + ops) · admin UI (Phase 11 — APIs only).

---

## Done criteria
1. Unbalanced-journal SQL proof + webhook replay proof + browser-death e2e — the three non-negotiables — green.
2. Both rails e2e green; wallet/payout math matches hand-computed fixtures; commission & price-card snapshots immune to config edits.
3. No secrets in code/fixtures/logs (extend the tripwire scan to `rzp_live_` patterns — fail the build if a live key ever lands anywhere).
4. `lint/build/typecheck/test` clean; stable ×3; fresh-DB migrations; idempotent seed with balanced-ledger validation.
5. Docs updated.

## Final deliverable
`docs/summaries/phase08-summary.md`, standard six-point format. Next phase preview: Phase 9 = reviews, ratings & trust score — two-way reviews gated on paid bookings, complaint flow, the trust-score engine (outbox consumer over booking/payment/review topics) with SILVER/GOLD badge bands, auto-suspension rules, and the ranking scorer's trustScore input finally going live.
