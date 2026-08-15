# Phase 6 — Bookings & slots

## 1. Goal

Turn a technician's weekly availability into concrete, claimable hours, and give
a customer a way to book one and see the job through to completion — without any
possibility of two customers being sent the same technician at the same time.

Everything else in the phase serves that: the slot machinery, the booking state
machine, the physical handshake that proves a visit happened, and the outbox
that lets later phases react to any of it.

## 2. What was built

**Migration `20260815200000_add_slots_bookings_outbox`** — hand-written after
removing six proposed `DROP INDEX` statements Prisma cannot see (both GiST
indexes, both trigram indexes and two covering indexes). Adds:

- `slots`, `bookings`, `booking_events`, `outbox`, `provider_stats`
- `btree_gist`, and the constraint the phase exists for:
  ```sql
  EXCLUDE USING gist (provider_id WITH =, time_range WITH &&)
    WHERE (status IN ('held', 'booked'))
  ```
- a `BEFORE INSERT OR UPDATE` trigger keeping `time_range` in step with
  `starts_at`/`ends_at`
- `booking_events_append_only()` — refuses `UPDATE` unconditionally, `DELETE`
  except under `fixbridge.allow_kyc_purge`
- `slots_booking_link_check`: `held`/`booked` ⇒ a booking; `open`/`blocked` ⇒ none

**Slot planning** (`modules/bookings/slot-plan.ts`) — pure IST calendar
arithmetic at a fixed +05:30. `planSlots` materialises a rolling horizon;
`reconcileSlots` diffs it against reality and **never touches a `held`, `booked`
or `blocked` slot**.

**Booking state machine** (`state-machine.ts`) — the transition table as data,
`projectBookingStatus` folding the event log, reason-code enums, and a topic per
event type.

**Service layer** — `createBooking` (re-checks all three search gates, holds the
slot, writes event + outbox in one transaction), accept / reject / en-route /
start / complete / cancel, all funnelled through one `transition()` that
reprojects from the log before deciding.

**Handshake OTPs** (`otp.ts`) — two 4-digit codes per booking, HMAC-salted by
booking id and kind, Redis-only, locking at 5 attempts and staying locked.

**Transactional outbox** (`core/outbox.ts`) — `enqueueOutbox` requires a
transaction client; a Redis-locked dispatcher with exponential backoff and
parking; a subscriber registry Phases 9 and 10 will use.

**Background jobs** (`core/jobs.ts`, `core/background.ts`,
`modules/bookings/jobs.ts`) — expiry sweep and slot-horizon extension, both
idempotent and Redis-locked, wired into boot behind `JOBS_ENABLED` and drained on
shutdown.

**Acceptance rate** (`stats.ts`) — the first real outbox consumer, recomputing
from the log rather than incrementing, and the thing that closes Phase 5's
neutral ranking default.

**Endpoints** — `POST/GET /bookings`, `GET /bookings/:id`, accept · reject ·
en-route · start · complete · cancel, `GET /providers/:id/slots` (public),
`POST /providers/me/slots/:id/block|unblock`.

**Search closed its documented gap** — availability now matches real `open`
slots instead of weekly templates, and the ranking reads a real acceptance rate.

**Seed** — 1,624 slots across 17 listed technicians and 10 bookings covering
every state, with event histories replayed through the real projector before they
are written and `provider_stats` recomputed from the log.

## 3. Key decisions and deviations

**The constraint is the guarantee; everything else is courtesy.** The Redis lock
in `createBooking` and the `status = 'open'` guard on the claim exist to turn the
common race into a fast 409. Neither is trusted. A test fires eight parallel
bookings at one slot and asserts exactly one 201, seven 409s, and no 500.

**Slots are claimed after the booking is written, not before.** `slots.booking_id`
is a plain foreign key, so claiming first pointed at a row that did not exist yet
— a real 500 the integration tests caught. Reordering costs nothing: a losing
racer's booking rolls back with everything else.

**Nothing cancels from `ARRIVED` onwards.** Once a technician is at the door, "I
changed my mind" is a dispute, not a cancellation, and letting either side cancel
would erase a visit that actually happened. Disputes are Phase 9.

**Four-digit handshake codes, and the plaintext is stored.** A deliberate
departure from the auth OTP, where plaintext never exists server-side: here the
customer must be _shown_ their code, because there is nobody to send it to and
the whole mechanism depends on them reading it aloud. The hash still guards
verification, both keys are Redis-only, and a test greps `booking_events` to
prove no code reaches Postgres. Four digits rather than six because the attacker
would have to be physically present, and the attempt limit does the work length
does elsewhere.

**Locked stays locked.** After five wrong codes the correct code stops working
too. Reissuing would defeat the point of proving presence; ops unlock it, which
also means somebody looks at why five attempts failed.

**Acceptance rate is `null` below five decided requests, not zero.** One
rejection out of two is 50%, which would bury a technician who joined last week
under everyone with a longer record. `null` falls back to the neutral 0.5, so a
newcomer sits mid-pack. Provider cancellations are counted but excluded from the
ratio — abandoning an accepted job is a more serious failure and Phase 9 will
weigh it separately.

**Expired counts against a technician exactly as much as rejected.** From the
customer's side, silence and "no" are the same wasted wait.

**Ops appear in no transition rule.** Intervention is Phase 11, and allowing it
silently now would make an ops action indistinguishable from a technician's.

**`slot-horizon` is an interval, not a nightly clock time.** A process that
restarts more often than 24 hours would never reach a 24-hour timer, and "nobody
can be booked" is a silent failure. It defaults to 6 hours and also runs once at
boot. The job is idempotent, so the extra runs cost a diff that finds nothing.

**`createMany` is unavailable on `slots`.** Prisma will not generate it for a
model with an `Unsupported` column, so `applySlotPlan` builds a raw multi-row
insert. It omits `time_range` (the trigger fills it) and supplies `id` and
`updated_at`, whose Prisma defaults are client-side.

**Deviation from the prompt's wording:** the public slots endpoint lives in the
bookings module but mounts under `/api/v1/providers/:id/slots`, which is where a
client looks for it, and reuses the search rate limit rather than inventing a
second budget — it is the step immediately after a search, and a scraper walking
every technician's calendar is exactly the traffic that limit exists to stop.

## 4. Assumptions and missing inputs

- **No payment is taken.** `visit_fee_paise` is snapshotted onto every booking
  and charged by nobody. Phase 8.
- **No notification is sent.** Every transition emits an outbox event; most have
  no subscriber. Phase 10 delivers over the WhatsApp Business API.
- **No rescheduling.** v1 is cancel plus rebook. `rescheduled_from_booking_id`
  exists so the two can be linked when that changes.
- **Ops cannot unlock a booking yet.** A locked handshake needs a Phase 11
  console action; today it requires a Redis key deletion.
- **The 30-day acceptance window and the 5-request floor are guesses.** Both are
  constants in `stats.ts` rather than config, because moving them changes what
  the number _means_ and that should be a considered edit, not an env var.
- **Slot increment is uniform at 60 minutes.** A two-hour AC service and a
  ten-minute fuse change occupy the same hour. Per-category durations are a real
  need and were not in scope.
- **No timezone but IST.** Fixed +05:30, no DST, no tz database. Correct for
  India and wrong everywhere else, by design.

## 5. Verification results

```
npm run -w @fixbridge/api typecheck   clean
npm run -w @fixbridge/api lint        clean
npm run -w @fixbridge/api build       clean
npm run -w @fixbridge/api test        614 passed / 614, three consecutive runs
```

New coverage: 36 booking integration tests, 18 state-machine tests, 30
slot-planning tests, 8 acceptance-rate tests, 6 outbox tests.

Proved end to end against real Postgres and Redis:

- Two overlapping `held` slots for one technician are refused at SQL level, and
  the same two hours for _different_ technicians are accepted.
- Eight parallel bookings on one slot → exactly one 201, seven 409, no 500.
- Full lifecycle request → accept → en route → start → complete, with the
  history showing `arrived` even though nothing called an "arrive" endpoint.
- Template regeneration deletes open slots while preserving a booked one.
- Handshake: wrong code counts down and is recorded as evidence; lock at 5;
  correct code refused after lock; end code invisible before `IN_PROGRESS`.
- Expiry with an injected clock releases the hour; a second sweep is a no-op; an
  accepted booking is untouched a year late.
- Outbox: event and state change roll back together; delivery marks processed and
  does not repeat; failures back off and park; only one dispatcher holds the lock.
- Acceptance rate 4/5 accepted → 0.8, unchanged after a duplicate delivery.
- Phone masked before acceptance, revealed after; address hidden from the
  technician until they accept.
- A booked hour disappears from both the public slots endpoint and search.
- `booking_events` refuses `UPDATE` at the database level.

Migrations verified against a fresh database with all spatial and trigram indexes
intact; the seed run twice reports `0 new` slots and `10 already present`.

**Two bugs found by these tests and fixed:**

1. The slot claim preceded the booking insert, violating `slots_booking_id_fkey`
   — a 500 on every booking.
2. The repo-wide Aadhaar tripwire fired on partially-interpolated UUID literals
   in the new test file. The tripwire was right; the fixtures now assemble their
   ids at runtime.

**One flake found and fixed:** the outbox delivery test raced Postgres's
`CURRENT_TIMESTAMP` against Node's `Date.now()` — the Docker clock drifts a few
milliseconds either side of the host's, so a freshly enqueued row was sometimes
"not due yet". The dispatcher's clock is now nudged forward in those tests.

## 6. Next steps

**Phase 7 (quotations)** will hang off `IN_PROGRESS`: a technician itemises what
the job actually needs, the customer approves in-app, and only then does work
continue. `price_card_id` is already recorded on the booking as the starting
point. The state machine will need `QUOTE_SENT` / `QUOTE_APPROVED` rows — added
to `TRANSITIONS`, not to a switch statement.

Also waiting on later phases:

- **Phase 8** charges `visit_fee_paise` and settles the quotation.
- **Phase 9** subscribes to `booking.rejected`, `booking.expired`,
  `booking.cancelled_by_provider` and `booking.otp_locked` for the trust score,
  and fills `RankInput.trustScore`, which is still neutral. Its complaint flow
  covers the gap left by refusing cancellation after `ARRIVED`.
- **Phase 10** subscribes to essentially every topic and sends over WhatsApp.
- **Phase 11** needs an ops action to unlock a handshake, and a view over parked
  outbox rows — both are why parked events are kept rather than dropped.
- **Phase 12** builds the customer booking flow against these endpoints, and will
  want per-category slot durations before the UI can look right.
