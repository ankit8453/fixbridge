# Phase 8 — Payments, ledger & wallet

## 1. Goal

Collect the number Phase 7 froze, record every movement of money as double-entry
ledger rows, and pay technicians what they are owed — over both the rails that
actually exist in Jabalpur: UPI, and notes handed over at the door.

Two laws govern everything: **money exists only as ledger rows** (no balance
column, ever), and **the gateway webhook is the only source of payment truth**.

## 2. What was built

**Carry-over first.** `bookings.price_card_amount_paise` / `price_card_type`,
snapshotted at creation with a documented backfill. `computePayable` and the
WORK_DONE guard now read the snapshot, so a technician editing their rate mid-job
cannot change that customer's bill.

**Migration `20260816190000_add_ledger_payments_payouts`** — hand-written after
removing seven proposed `DROP INDEX` statements, the seventh phase running.
Adds `accounts`, `ledger_journals`, `ledger_entries`, `commission_config`,
`payments`, `refunds`, `webhook_events`, `payout_batches`, `payouts`, plus:

- a **deferred constraint trigger** asserting Σdebits = Σcredits and ≥2 lines per
  journal — checked at COMMIT, because entries arrive one at a time;
- immutability triggers with **no purge escape hatch**, unlike bookings and KYC;
- three views: `account_balances`, `provider_balances`, `platform_revenue_view`;
- a deferred trigger keeping a payout batch header honest against its lines;
- partial unique indexes: one live payment per booking per purpose, one payment
  per gateway order, one refund per gateway refund id.

**`ledger.ts`** — `post()` is the only write path, requires a transaction client,
creates accounts lazily with `ON CONFLICT`, and validates the balance itself for
a decent error message while the database keeps the real guarantee.

**`commission.ts`** — basis points, `splitCommission` rounding **down to the
technician**, the provider share derived as the remainder so a journal balances
by construction. `resolveCommissionRate` shares the Phase 7 chain, extracted into
`core/scoped-config.ts` and now used by both fee and commission config.

**Gateway adapter** — `PaymentGatewayAdapter`, `FakeGateway` (real HMAC over real
bytes, deterministic ids, synthetic webhook bodies in Razorpay's envelope) and
`RazorpayGateway` (real SDK). Every test runs on the fake; CI never touches the
internet.

**Payments** — order creation (idempotent), the optimistic checkout callback that
moves nothing, webhook capture, the cash rail, refunds, payouts, the wallet, and
ops routes for batches and dues.

**Webhook pipeline** — raw body parsed _before_ `express.json()`, signature
verified, `webhook_events` row inserted, outbox row queued in the same
transaction, `200` returned. Processing happens off the outbox.

**Seed** — commission config (12% city, 10% motors cluster), two online-paid
bookings, one cash booking with dues, one partially refunded, one unpaid, and a
draft payout batch. Every journal balances.

## 3. Key decisions and deviations

**No balance column, and no exception to that.** A balance you can `UPDATE` is a
balance that can be wrong, and every future code path would have to remember to
keep it right. Views cost a `GROUP BY` and cannot drift.

**The cash journal is asymmetric on purpose.** Only the commission moves through
our books, because only the commission was ever ours — the rest went hand to
hand. Posting the gross would put cash on our balance sheet that we do not have.

**Refunds come out of both pockets in proportion.** Refunding from platform
revenue alone would turn every refund into a subsidy we pay a technician for work
the customer rejected.

**One refund journal, not two.** The prompt allowed a two-step through
`refunds_payable`; with this gateway the money leaves our balance the moment the
refund processes, so that leg would be credited and debited in the same breath
and would describe a state that never exists. The account is kept for a gateway
that settles differently.

**A separate `method` column rather than `cash` in the gateway enum.** Cash has
no gateway, no order id and no webhook; modelling it as a gateway would leave
three columns permanently null with nothing saying why. A CHECK constraint states
the rail's shape instead.

**Commission rounds down, always to the technician.** A few rupees a year, and it
makes "we never round in our own favour" true without an asterisk.

**Dues are never netted out of a payout silently.** A technician who owes more
than we owe them is skipped from the batch with their dues intact. The first time
a technician sees a payout smaller than they expected is the last time they trust
the wallet screen.

**Ledger rows have no DPDP purge hatch.** Financial records are not personal data
and carry statutory retention. Erasure cuts the link (`booking_id` → NULL) and
leaves the money — which forced a narrow exception in the immutability trigger,
permitting exactly that nulling and nothing else.

**Production cannot run on the fake gateway.** The config schema refuses to
parse it, the same shape of guard as the fixed-OTP one. It also refuses
`razorpay` with any key missing, in every environment.

**The tripwire now scans for `rzp_live_` keys**, with a test proving the pattern
is not vacuous.

## 4. Assumptions and missing inputs

- **`COLLECT_FEE_AT_BOOKING` is off and has no live coverage.** The flow, the
  auto-refund consumer and the config are built; the refunder's behaviour is
  asserted through its unit path rather than a flag-on integration run, because
  turning the flag on mid-suite would change every other booking's payable.
- **Payouts are manual.** RazorpayX is an interface with nothing behind it.
- **No GST, no invoices, no chargebacks.** Phase 8's breakdown data is enough for
  the pilot; disputes are Phase 9 plus ops.
- **The Razorpay adapter has never run.** It is written against the SDK's
  documented shapes and exercised by nothing automated. `docs/money.md` has the
  dashboard and tunnel steps so it can be smoke-tested locally once.
- **`refunds_payable` is defined but unused**, kept for a gateway that settles
  refunds separately from processing them.
- **Payout batches assume one currency and one country.** True for a long time.

## 5. Verification results

```
npm run typecheck      clean
npm run lint           clean
npm run format:check   clean
npm run build          clean
npm test               798 passed / 798, three consecutive runs
```

New coverage: 39 payment integration tests, 14 commission tests, 12 gateway
tests, 8 payment state-machine tests, 8 seed-ledger audit tests, plus config
guards and the live-key tripwire.

**The three non-negotiables, all green:**

1. **An unbalanced journal cannot commit** — proved at SQL level, one paisa out,
   plus the empty-journal and negative-amount cases.
2. **A replayed webhook posts once** — the same event delivered three times
   yields one `webhook_events` row and one ledger journal, and draining the
   outbox twice changes nothing.
3. **The browser closed after paying** — no callback ever fires and the booking
   settles from the webhook alone, with `checkout_verified_at` still null.

Also proved end to end:

- Raw-body HMAC over the exact bytes, with a body whose key order and whitespace
  no re-serialisation would reproduce.
- An amount that does not match the frozen payable parks the event and posts
  nothing.
- The capture, cash, refund and payout journals have exactly the shapes
  documented; a partial refund reverses in proportion at the snapshotted rate.
- A doubled commission rate after capture leaves past money untouched, and a
  tripled price card mid-job leaves the bill untouched.
- Payout minimum, dues-heavy exclusion, double-pay refusal, and a batch header
  that cannot disagree with its lines.
- Both full e2e runs — online to payout, cash to settled dues — with the books
  closing at the end of each.
- Erasure cuts a journal's booking link and leaves the entries; re-pointing it at
  a different booking is refused.

Migrations verified against a fresh database twice; the seed run twice reports
`0 payments, 0 journals`.

**Three bugs found by these tests and fixed:**

1. `ledger_journals` refused _all_ UPDATEs, which made `ON DELETE SET NULL`
   impossible and so made DPDP erasure of a paid booking impossible. The trigger
   now permits exactly the link-nulling.
2. `gateway_order_id` had no uniqueness guarantee, so `findPaymentByOrderId`
   could return the wrong payment and capture the wrong booking. Now a partial
   unique index — and the fake gateway no longer resets its id counter, because
   a fake that reissues ids is lying about the world.
3. A Phase 5 search test hardcoded a date that had become "today", so its morning
   slots were in the past. It now asks for the next occurrence of a weekday.

## 6. Next steps

**Phase 9 (reviews, ratings & trust score)** gates reviews on **paid** bookings,
which this phase now makes checkable: `payments.status` and the frozen payable
are the gate. Its trust engine subscribes to booking, payment and review topics —
`payment.cash_recorded` in particular is worth a look, since a technician whose
cash markings are regularly disputed is a different problem from one who is
simply slow.

`RankInput.trustScore` is still neutral and finally goes live there, alongside
the SILVER/GOLD bands that have been in the `Badge` enum since Phase 4.

Also waiting:

- **Phase 10** notifies on `payment.captured`, `payment.cash_recorded` and
  `payment.refunded`. The cash one matters most: it is what gives a customer the
  chance to say "no I didn't".
- **Phase 11** needs the ops screens these APIs assume — parked webhook events,
  payout batches, dues settlement, and the platform position — plus the ability
  to post an `adjustment` journal, which is the only way a correction can ever be
  made.
- **Phase 12** builds the checkout against `POST /bookings/:id/payments` and the
  wallet screen against `GET /providers/me/wallet`.
- **Before real money:** run the Razorpay smoke test once (steps in
  `docs/money.md`), and snapshot the price card amount for any booking created
  before this phase — the backfill used current card values, which is stated in
  the migration and is the one place the data may be approximate.
