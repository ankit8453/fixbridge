# Phase 9 — Reviews, ratings & trust score

## 1. Goal

Verification proves who a technician _is_. This phase proves how they _behave_ —
and does it in a way a technician can argue with, because ranking, badges and
suspension all flow from one number and they will be asking about it.

The governing principle: **the score must be explainable.** "Why is my score 62?"
gets a component-by-component answer, in Hindi, or the number is worthless.

## 2. What was built

**Carry-over first.** `COLLECT_FEE_AT_BOOKING` now runs end to end in its own
suite, with a context built from a config that has the flag on: book → upfront
fee order → captured webhook → cancel → auto-refund consumer fires → ledger
reversed to zero, with every journal balanced.

**Migration `20260816220000_add_reviews_complaints_trust`** — hand-written after
removing nine proposed `DROP INDEX` statements, the eighth phase running. Adds
`reviews`, `review_reports`, `complaints`, `trust_score_snapshots`, suspension
columns on `provider_profiles`, and eight new columns on `provider_stats`. Plus:

- reviews append-only **except `status`**, so ops can moderate and nobody can
  edit what a review says;
- snapshots append-only with the DPDP purge hatch — unlike ledger rows, a
  snapshot _is_ about a person;
- a CHECK making resolution coherent: a resolution needs a note _and_ a severity,
  a dismissal needs a note and **no** severity.

**`trust/score.ts`** — `computeTrustScore`, pure, five weighted components with
half-life decay on ratings and activity; `computeBadgeBand`; `evaluateSuspension`.
Every component reports raw, normalised, weight and contribution.

**`trust/service.ts`** — the outbox consumer. Recomputes from the tables on every
relevant event, writes stats, snapshot, badge band and suspension in one
transaction.

**Reviews** — gated on settlement, one per side per booking, direction derived
from the caller, public aggregates, moderation, and a public paginated endpoint.

**Complaints** — transition table, ops-only decisions, every move on the
booking's timeline, and the synchronous safety path.

**Search** — a fourth gate (not suspended), `trustScore` live in the scorer, and
`rating` / `jobsCompleted` / badge band on the result card.

**`GET /providers/me/trust`** — the explainability endpoint, i18n'd, with the
trend and a concrete next-band target.

**Seed** — 5 reviews across both directions, 2 complaints, one SILVER, one GOLD,
one suspended technician who passes every other gate.

## 3. Key decisions and deviations

**Reviews are gated on money, not on completion.** To leave one you must have
booked a real technician, had them turn up, and parted with real money. That
removes the entire class of fake reviews, and stops a customer who never paid
using a one-star rating as leverage.

**Provider→customer reviews are internal, and the leak test is explicit.** A
technician needs somewhere to record "this address was not safe to enter" without
starting a public argument with somebody who can rate them back. The public query
filters on direction _and_ status, and a test asserts the text appears nowhere in
the serialised response.

**Null, not zero, for a technician with no history.** Zero says "we measured them
and they are untrustworthy" about somebody who started on Tuesday.

**Rescaled by the weights that applied**, not by 100. A technician with three jobs
and no ratings is scored on the 65 points that can apply to them rather than
punished for the 35 that cannot.

**Complaints are weighted by severity, not counted.** One severe wipes the
component; five minor ones do not. Averaging would let a pattern of small
failures hide behind volume, and one serious failure vanish into it.

**A dismissed complaint counts for nothing.** Being accused is not a record — if
it were, the cheapest way to damage a competitor would be to book them once.

**Recompute-from-source, never increment.** Idempotency comes free: a replay
recounts the same rows. An incremental counter would be wrong twice and nobody
would find out for months.

**Safety suspends synchronously.** Everything else settles through the outbox,
which is right for money and wrong for somebody being unsafe in a stranger's
home. A wrongly suspended technician loses a day; the alternative is somebody
else opening their door.

**Suspension expiry is lazy** — checked against the clock in the search
predicate, with no job to clear the column. A suspension ends the moment it ends.

**Suspension never touches the badge.** Separate axes: the badge says who they
are, suspension says how they have behaved. A technician serving a suspension
must not have to re-upload their Aadhaar.

**Deviation:** the seed cannot honestly reach 10 and 30 settled jobs from 13
seeded bookings, so the two band-holders get `settled_jobs_count` set directly.
That is the number `computeBadgeBand` consumes, so the badge is still _computed_
rather than asserted — but the volume is manufactured, and the summary says so
rather than the seed pretending otherwise.

## 4. Assumptions and missing inputs

- **Customer-side data is collected and not scored.** Provider→customer reviews
  exist for ops and future risk work; scoring customers has real consequences and
  no pilot need.
- **The 90-day half-lives and the complaint weights are judgement, not evidence.**
  They will need revisiting once there is a year of real data; `docs/trust.md`
  has a "how to tune safely" section for exactly that moment.
- **Nothing recomputes on a schedule.** A score only moves when an event arrives,
  so a technician who stops working keeps their score until something happens to
  them. The recency component is what makes that survivable, and an ops recompute
  endpoint exists; a nightly sweep is a Phase 11 question.
- **No review replies, appeals, or attachments.** Ops tooling at most, later.
- **`hidden` reviews are excluded from aggregates**, decided and documented.
- **Suspension notifies nobody yet.** `provider.suspended` is emitted and Phase 10
  consumes it — which matters, because a technician who cannot see why their work
  stopped will simply leave.

## 5. Verification results

```
npm run typecheck      clean
npm run lint           clean
npm run format:check   clean
npm run build          clean
npm test               881 passed / 881, four runs
```

New coverage: 34 trust-score tests against hand-computed fixtures, 34 trust
integration tests, 12 complaint state-machine tests, 4 upfront-fee carry-over
tests.

**Fresh-database verification.** All 11 migrations applied to an empty database
in order, and the object inventory came out identical to the incrementally
migrated dev database — 124 indexes, 21 triggers, 60 CHECK constraints, 5 views.
That is the check the hand-edited migration exists for: every raw-SQL index
`migrate diff` proposed dropping is present on a fresh install, including
`slots_no_double_booking`, `quotations_one_live_per_booking_idx`,
`payments_one_live_per_purpose_idx`, `payments_gateway_order_id_key`,
`refunds_gateway_refund_id_key`, both GiST location indexes and both trigram
indexes.

**Seed idempotency.** Seeded the fresh database twice. The second run reported
`0 new` for every section, and all thirteen table counts were identical
afterwards — 23 users, 1,658 slots, 13 bookings, 58 events, 5 payments,
14 ledger entries, 5 reviews, 2 complaints, 3 snapshots.

Both tripwires still run inside the suite: no raw Aadhaar anywhere, and no
`rzp_live_` key anywhere. The live-key pattern is built by string concatenation
so the scan cannot flag itself, and a planted fixture proves it would catch a
real one while leaving `rzp_test_` alone.

Proved end to end:

- An unpaid job cannot be reviewed; a paid one can; a second review from the same
  side is a 409; the window closes on an injected clock; a stranger gets a 404.
- A provider→customer review appears in **no** public response, does not move the
  technician's average, and cannot be reported.
- Trust math: every component hand-computed, including a 60 built from five
  components and a 100 built from the 65 weight that applied.
- Changing the weights reorders two technicians **with no code change**.
- Replaying a recompute three times leaves every aggregate byte-identical while
  the snapshot count grows.
- Hiding a review recomputes the average without it, and the row survives.
- Reviews refuse UPDATE of their substance and DELETE outright.
- Each suspension rule fires: safety synchronously, three cancellations in the
  window, a severe complaint — and none of them touches the verification badge.
- A suspended technician vanishes from search and returns the moment the
  suspension lapses, with no job involved.
- The explainability endpoint returns five components with i18n'd labels, and
  answers in Hindi when asked.
- Full e2e: paid job → both reviews → score → severe complaint → suspended → gone
  from search → lifted → back with a lower score and a zeroed complaint
  component.

Migrations verified against the existing database; the seed run twice is a no-op.

**One real bug found and fixed, and one gap closed:**

1. **The upfront-fee flow was never wired.** `startPayment` only ever handled a
   terminal booking's frozen payable, so `visit_fee_upfront` returned
   `BOOKING_NOT_BILLABLE` on every attempt — Phase 8 shipped a flag that could
   not have worked. It now branches on purpose, with its own permitted statuses.
   Exactly what the carry-over was for.
2. **DPDP erasure could not remove a technician** once they had reviews or trust
   snapshots: both tables refuse DELETE, and the cascade from `users` tripped the
   trigger. `purgeBookingData` now erases reviews, reports, complaints and
   snapshots inside its flagged transaction — which is also the correct answer,
   since all four are personal data.

**Three test updates, all legitimate consequences:**

- The Phase 5 gate test now derives its expected set including the fourth gate,
  and a new test names the suspended technician specifically.
- Phase 4's verified count now counts all three bands — `SILVER` and `GOLD` are
  `VERIFIED` plus a record, not something else.
- The suite now forces `PAYMENT_GATEWAY=fake` in `vitest.config.mts`, because a
  developer whose `.env` points at real Razorpay test keys must not thereby make
  `npm test` reach across the internet.

**Two bits of housekeeping**, both mine to clean up: the final typecheck caught
four loose casts in the new integration suite that Vitest never type-checks at
runtime — including one assertion that was comparing JSON string lengths and so
could not have failed. It now reads the category count out of the response tree
and asserts it drops by exactly one. And `apps/api/repro.tmp.ts`, a debug script
I committed by accident in Phase 8, is deleted.

## 6. Next steps

**Phase 10 (notifications)** consumes everything this phase emits. The topics
that matter most:

- `provider.suspended` — a technician whose work stops without explanation will
  simply leave. This one is not optional.
- `review.created` — the other side should know they were rated.
- `complaint.opened` / `complaint.resolved` — both parties, at both ends.
- `payment.cash_recorded` — from Phase 8, and the one that gives a customer the
  chance to say "no I didn't".

Also waiting:

- **Phase 11** needs the ops screens these APIs assume: the complaint queue, the
  review-report queue, suspension lift/extend, and a bulk recompute after a
  weight change.
- **Phase 12/13** build the customer's review screen and the partner app's
  "why is my score" screen, which is what `GET /providers/me/trust` was shaped
  for.
- **Before launch:** decide whether a nightly recompute is wanted so an inactive
  technician's recency decays without an event to trigger it, and revisit the
  half-lives once there is real data behind them.
