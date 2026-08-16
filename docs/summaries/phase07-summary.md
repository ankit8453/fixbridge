# Phase 7 — Quotations & pricing

## 1. Goal

Make it impossible for a customer to be surprised by a price. A technician who
cannot name the cost up front must quote it in writing, itemised, before the work
proceeds — and the customer must agree in the app before anything is billed.

The secondary goal is Phase 8's input contract: whatever this phase freezes onto
a booking is what will be collected, so the arithmetic has to be money-grade.

## 2. What was built

**Migration `20260816120000_add_quotations_and_fees`** — hand-written after
removing six proposed `DROP INDEX` statements, the sixth phase running. Adds:

- `fee_config`, `quotations`, `quotation_items`, and `payable_paise` /
  `payable_breakdown` on `bookings`
- `CLOSED_QUOTE_DECLINED`, and five new booking event types
- the pricing wall:
  ```sql
  CREATE UNIQUE INDEX quotations_one_live_per_booking_idx
    ON quotations (booking_id) WHERE (status IN ('sent', 'approved'));
  ```
- money CHECKs: `total_paise = labour_paise + parts_total_paise`,
  `line_total_paise = qty * unit_paise`, `total_paise > 0`, plus qty/unit floors
- immutability triggers: a quotation accepts exactly one UPDATE — leaving `sent`
  — and its items accept none; DELETE only under `fixbridge.allow_kyc_purge`
- `fee_config_scope_idx` using Postgres 15's `NULLS NOT DISTINCT`, so two
  conflicting city defaults for the same date cannot both exist

**`modules/quotations/money.ts`** — the one place a quotation total is computed,
with caps that keep every intermediate three orders of magnitude clear of `int4`.

**`modules/quotations/payable.ts`** — `computePayable`, pure, every input passed
in, plus `assertBreakdownAddsUp`.

**`modules/bookings/fees.ts`** — `resolveVisitFee`, the
service → cluster → city → global chain, pure.

**Quotations module** — send (supersedes the previous version atomically),
withdraw, approve, reject, and full history to both parties.

**Booking changes** — visit fee resolved through `fee_config` at creation;
`requireSettledPrice` guarding the end handshake; `declineWork`; and the payable
frozen inside the single transition funnel so status and bill commit together.

**Seed** — three fee rows (Jabalpur ₹49, motors/genset cluster ₹99, AC gas refill
₹79) and 13 bookings, now covering a live `sent` quote, a completed
approved-quote job, a completed flat-rate job, a rejected-then-approved history,
and a declined-and-closed job — each with its payable computed by the same
function the API uses.

## 3. Key decisions and deviations

**One partial index closes both races.** Two revisions sent at once, and an
approval racing a revision, are the same failure to the caller — somebody got
there first — so they share a guard and a 409.

**"Exactly one of six parallel sends wins" is the wrong assertion, and the test
says so.** A send that arrives after another has committed is a legitimate v2,
not a race loss. The test asserts the actual invariant: one live quotation,
contiguous versions, no 500s.

**Rejecting a quote does not end the booking.** "Not at that price" invites a
revision; ending the job is a separate, explicit customer action. Collapsing them
would let one tap close a booking the customer only meant to haggle over — and
would make the visit fee feel like a penalty for asking.

**The visit fee is waived under an approved quotation and charged otherwise.**
A customer who accepts a quote has already paid for the trip inside that number;
charging it again would make the itemised total a lie, which is the exact thing
this feature exists to prevent. A customer who hears the price and declines has
still consumed a visit.

**A fee _table_, not a config constant.** A motor rewinder arrives with tools, a
meter and half a morning gone; a tap washer does not. The chain has a **cluster**
rung so ops price a whole trade with one row rather than four that drift apart —
a small extension beyond the prompt's wording, and the reason the seeded
"motors/genset ₹99" instruction works as written.

**`int4`, deliberately.** ₹2.14 crore is the ceiling; a doorstep quotation that
reaches it is a bug or a fraud, and a wider column makes neither safer. The caps
in `money.ts` mean Postgres's overflow error is a backstop that should never
fire. A test asserts the caps reject it _and_ that Postgres would raise rather
than wrap.

**Money caps are constants, not config.** Widening what a quotation may say
changes what a quotation _means_; that should be a reviewed edit, not an
environment variable somebody can change at 2am.

**Quote events publish under `quotation.*`, not `booking.*`.** They still travel
through `booking_events` — the timeline is one narrative — but a Phase 9/10
subscriber that cares about pricing should not have to sift booking events.

**Phase 6's own tests needed a price card.** Its technician had none, so every
completion now hit `QUOTATION_REQUIRED`. That is the guard working: a Phase 6
job was always implicitly a flat-rate one, and the fixture now says so.

## 4. Assumptions and missing inputs

- **The price card's amount is read at completion, not snapshotted at booking.**
  A technician editing a `fixed` price mid-job would change the bill. The booking
  stores the card's id, not its amount. Phase 8 should snapshot the amount at
  creation alongside the visit fee; widening the booking row is its concern, and
  doing it here would have meant a second migration for one column.
- **No payment.** `payable_paise` is frozen and collected by nobody.
- **No GST, no invoice formatting.** Phase 8.
- **Items are free text.** No parts catalogue, no inventory. A standard-part list
  would slow every technician down for a benefit nobody has asked for yet.
- **No ops intervention.** A wrong quotation cannot be corrected by support; the
  technician withdraws or supersedes it. Phase 11.
- **`decidedAt` is set on supersede and withdraw too**, not only on a customer
  decision. It reads as "when this row stopped being live", which is what the
  CHECK constraint enforces and what the UI needs.
- **50 items, ₹2,00,000 per quotation.** Both are guesses that fit a doorstep
  repair. A job that genuinely exceeds either is one this marketplace is not
  built for yet.

## 5. Verification results

```
npm run typecheck      clean
npm run lint           clean
npm run format:check   clean
npm run build          clean
npm test               710 passed / 710, three consecutive runs
```

New coverage: 38 quotation integration tests, 20 money-math tests, 22 payable
tests, 11 fee-resolution tests, plus 5 added to the booking state machine.

Proved end to end against real Postgres and Redis:

- Six parallel sends leave exactly one live quotation, contiguous versions, and
  no 500s; approve-racing-a-revision produces a single winner.
- Two live quotations, and a duplicate version, are refused at SQL level.
- A stored total that is not the sum of its parts, and a line total that is not
  `qty × unit`, are both refused by the database.
- A quotation's money cannot be changed; its items cannot be updated or deleted;
  the erasure path still works.
- Completion is blocked with a pending quote, and blocked for an
  `inspection_based` job with no approval; the flat-rate path is untouched.
- Decline-work is blocked while a quote is pending or approved, and is refused to
  the technician.
- Full e2e: book (inspection) → accept → arrive → v1 sent → rejected → v2 sent →
  approved → end OTP → `WORK_DONE`, payable = v2 total with the fee waived, and
  the timeline showing all nine events in order.
- Decline e2e: rejected → declined → `CLOSED_QUOTE_DECLINED`, payable = fee only,
  and nothing may follow.
- The fee chain resolves city → cluster → exact service against the real table,
  and a fee change after booking does not alter the bill.
- `quotation.sent/rejected/approved` are emitted in order, delivered to a
  subscriber, and a redelivery changes nothing.

Migrations verified against a fresh database with every prior index, constraint
and trigger intact; the seed run twice reports `0 created, 13 already present`.

**Two bugs found by these tests and fixed:**

1. `isLiveQuotationConflict` matched on index _names_, but Prisma reports a
   `P2002` as the field list and never names a partial index — so a lost race
   returned a 500 instead of a 409. It now matches on the columns.
2. The Phase 6 search test picked a slot by index and happened to land on the
   23:00 hour, whose IST end time is `00:00` — which the validator correctly
   rejects. It was passing by luck of the clock; it now asks for a daytime hour.

**One test corrected rather than the code:** the parallel-send assertion, as
described above.

## 6. Next steps

**Phase 8 (payments, ledger & wallet)** takes `payable_paise` as its input
contract — frozen, never moved. Its work:

- a Razorpay adapter behind an interface, with a fake for dev and test, the same
  shape as the Phase 4 KYC adapters;
- double-entry `ledger_entries` where money exists only as rows and balances are
  views;
- UPI collect plus a logged-cash path, because a good share of Jabalpur will pay
  the technician in notes and the platform still has to know;
- `webhook_events` for idempotency — the gateway will deliver twice;
- T+1 payout batches;
- refund edge cases on the visit fee, which is where `visitFeeCharged` and the
  `basis` field in the frozen breakdown earn their place.

**It should also snapshot the price card's amount onto the booking**, closing the
one sharp edge noted above.

Waiting further out:

- **Phase 9** reads `quotation.rejected` and `booking.work_declined` as a softer
  signal than the reliability ones: a technician whose quotes are regularly
  declined may be pricing badly rather than working badly.
- **Phase 10** sends `quotation.sent` over WhatsApp — a customer standing next to
  the technician still gets the itemised price in writing, which is the whole
  promise.
- **Phase 11** needs an ops view of quotations and a way to intervene on a wrong
  one; today the technician must withdraw or supersede.
- **Phase 12** builds the quote-approval screen, which is the most trust-critical
  screen in the app.
