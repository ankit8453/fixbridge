# PHASE 6 PROMPT — Booking & Slots (the heart of the marketplace)

You are building **Phase 6 of 14** of the `fixbridge` marketplace. Phases 1–5 are on `main`: infra, auth, profiles with completeness gating, append-only verification with badges, and gated geo-search with pluggable ranking. Read `docs/summaries/phase05-summary.md`, `docs/search.md`, `docs/verification.md`, `docs/geo-notes.md` first. Known hazards: `prisma migrate diff` drops GIST/spatial indexes on Unsupported columns (guard every migration); integration suites share one seeded dataset (`fileParallelism: false` is deliberate — keep it).

**Why this phase matters:** everything before this was setup; everything after consumes what this phase emits. Two invariants are sacred: **(1) a technician can never be double-booked — enforced by the database itself, not application code. (2) every booking's history is fully reconstructable — same append-only discipline as verification.**

---

## Context (frozen decisions in force)

- Timezone: all times stored as `timestamptz`; business logic in Asia/Kolkata. No other timezone exists in v1.
- The booking state machine (concept doc §5.3, adapted): `REQUESTED → ACCEPTED | REJECTED | EXPIRED`, `ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → WORK_DONE`, plus `CANCELLED_BY_CUSTOMER` / `CANCELLED_BY_PROVIDER` reachable from REQUESTED/ACCEPTED/EN_ROUTE (not after ARRIVED — after arrival, disputes are Phase 9's complaint flow, not cancellation). `WORK_DONE` is this phase's terminal state — payment/review states arrive in Phases 8–9 and will extend the machine, so design the transition table as data, not a switch statement.
- Same event-sourcing pattern as verification: `booking_events` append-only (trigger-enforced, purge-flag pattern reused), `bookings.status` is a projection, projector throws on unreplayable logs.
- **Transactional outbox is born this phase.** Every state transition writes its event to the `outbox` table IN THE SAME TRANSACTION as the state change. An in-process dispatcher polls and delivers to registered handlers. At-least-once delivery; consumers must be idempotent. No Kafka, no BullMQ — this is the pilot-scale event bus, and Phases 9 (trust score) and 10 (notifications) will subscribe to it.
- OTP handshake: start OTP proves physical arrival (customer tells it to technician, technician enters it), end OTP proves work completion sign-off. 4-digit, hashed in Redis keyed by booking, same hashing/attempt-limiting discipline as auth OTPs (5 attempts, then locked pending support).
- Money is NOT handled this phase. Bookings carry `visit_fee_paise` (snapshot from config at creation: default 4900) and reference the chosen price card, but no payment collection — Phase 8. Quotations — Phase 7.
- Scheduling jobs run in-process (`setInterval`/node-cron style) with a Redis lock so multiple instances wouldn't double-run. No external schedulers.

---

## Phase 6 scope

### 1. Slot materialization
- `slots`: id, provider_id, time_range (`tstzrange`, minute granularity), status (`open` | `held` | `booked` | `blocked`), source_template_id (nullable FK), booking_id (nullable), created/updated.
- **The double-booking wall (non-negotiable):** enable `btree_gist` extension; add exclusion constraint — `EXCLUDE USING gist (provider_id WITH =, time_range WITH &&) WHERE (status IN ('held','booked'))`. A test MUST prove the constraint fires at the SQL level when application checks are bypassed (raw insert of overlapping booked slots → error).
- Generation: materialize slots from `provider_availability_templates` for a rolling horizon (config, default 14 days), in fixed increments (config, default 60 min; windows shorter than the increment produce no slot — document). Nightly job extends the horizon; the job is idempotent (re-run adds nothing).
- Template changes: regenerating a provider's future slots must NEVER touch slots with status `held`/`booked` — only `open` slots are dropped/recreated. Test: book a slot, change the template, booked slot survives, surrounding open slots reflect the new template.
- Provider can `block` open slots (chhutti, personal work) and unblock; blocked slots are invisible to search/booking.

### 2. Search integration (closing Phase 5's documented gap)
- The Phase 5 availability filter checked templates; now it must check **actual open slots**. `GET /search/providers` with the date/time trio matches providers having an `open` slot covering the window. The Phase 5 "templates now, slots in Phase 6" note in docs/search.md gets updated.
- New endpoint: `GET /api/v1/providers/:id/slots?from=&to=` — public, returns that provider's `open` slots (never held/booked/blocked details — just availability), max 14-day window, rate-limited like search.

### 3. Booking lifecycle
- `bookings`: id (uuid), customer_id, provider_id, category_id, price_card_id (nullable), address_id (+ denormalized address snapshot jsonb — the address may be edited/deleted later; the booking keeps what was true at creation), slot_id, time_range (copy), problem_note (nullable, ≤500 chars), visit_fee_paise, status (projection), created/updated.
- `booking_events`: same shape as verification_events (event_type, actor_type customer|provider|system|ops, actor_user_id, payload jsonb, created_at), trigger-enforced append-only.
- **Create booking** (`POST /api/v1/bookings`, role customer): validates slot is `open` and belongs to a searchable provider (listed+VERIFIED+active — re-check at booking time, not just search time), category matches a provider skill, address belongs to customer. Atomically: slot → `held`, booking → `REQUESTED`, outbox event `booking.requested`. Concurrency: Redis lock on slot id around the transaction as a fast-path courtesy; the exclusion constraint remains the wall. **Concurrency test: N parallel create-booking calls for the same slot → exactly 1 success, N−1 clean 409s, no orphaned holds.**
- **Provider accept** (`POST /bookings/:id/accept`): REQUESTED → ACCEPTED, slot → `booked`, generates both OTPs (returned to nobody yet — customer fetches start OTP via their booking detail; end OTP revealed to customer only when IN_PROGRESS). Outbox `booking.accepted`.
- **Provider reject** (with reason code enum: `too_far` | `busy` | `wrong_skill` | `other`+note): → REJECTED, slot released to `open`, outbox event.
- **Request expiry:** REQUESTED older than config (default 15 min) → system transitions to EXPIRED, slot released, outbox event. Runs on the in-process job (every minute, Redis-locked). Test with fake timers/clock injection — do not sleep 15 min.
- **EN_ROUTE** (provider taps "chal diya"), **ARRIVED** (provider submits start OTP — wrong OTP = attempt counted, 5 fails = booking flagged `otp_locked` in payload + ops will resolve; correct → ARRIVED then immediately IN_PROGRESS), **WORK_DONE** (provider submits end OTP, same discipline). Every transition validates actor (only the booking's provider/customer/system may fire their transitions), emits outbox event.
- **Cancellation:** customer may cancel while REQUESTED/ACCEPTED/EN_ROUTE (reason codes: `changed_mind` | `found_other` | `emergency` | `provider_delay` | `other`); provider may cancel while ACCEPTED/EN_ROUTE (`emergency` | `vehicle_issue` | `wrong_skill` | `other`) — provider cancellations are the reliability signal Phase 9 punishes, so the event payload must be precise. Slot returns to `open` on any cancellation. No cancellation after ARRIVED.
- Reschedule = cancel + rebook in v1 (document as limitation; the two bookings are linked via `rescheduled_from_booking_id` nullable column for future analytics).
- **Detail & list endpoints:** customer sees own bookings (list + detail incl. start OTP when ACCEPTED+, end OTP when IN_PROGRESS, provider display info, masked provider phone until ACCEPTED — full phone after acceptance, both sides need to call each other, that's reality); provider sees own jobs (list + detail incl. customer first name, address revealed only after acceptance, full customer phone after acceptance); each side sees the event timeline (internal payloads redacted).

### 4. Transactional outbox (the pattern, done properly)
- `outbox`: id (uuid), topic (e.g. `booking.accepted`), aggregate_type + aggregate_id, payload jsonb, created_at, processed_at (nullable), attempts (int), next_attempt_at, last_error (nullable).
- Dispatcher: in-process loop (config interval, default 2s), Redis-locked (one dispatcher across instances), fetches due unprocessed rows (ordered, batched), invokes registered handlers, marks processed on success; on handler failure: exponential backoff via next_attempt_at, max attempts (config, default 8) then parked with last_error (ops visibility in Phase 11).
- Handler registry: `outbox.subscribe(topic, handler)`. This phase registers one real consumer to prove the pattern end-to-end: an **acceptance-rate projector** (below). Design handlers to be idempotent; test at-least-once semantics by forcing a redelivery.
- Graceful shutdown drains the in-flight batch.

### 5. Acceptance rate → search ranking (closing Phase 5's neutral default)
- `provider_stats`: provider_id PK, accepted_count, rejected_count, expired_count, cancelled_by_provider_count, window rolling-30d recompute (simplest correct approach: recompute from booking_events for the window on each relevant outbox event — booking volume at pilot scale makes this trivially cheap; document the future optimization path).
- `acceptance_rate = accepted / (accepted + rejected + expired)` (null until ≥5 decided requests — small-sample noise shouldn't torpedo a new mistri).
- Wire into the Phase 5 scorer: replace the neutral default with the real value when present. Scorer tests updated: provider with 40% acceptance ranks below equal provider with 95%.

### 6. Seed
- Extend seed deterministically: slots materialized for all listed providers for the horizon; ~10 bookings across the state spectrum (REQUESTED fresh, ACCEPTED with OTPs, IN_PROGRESS, WORK_DONE, one REJECTED, one EXPIRED, one cancelled each side) with full consistent event histories; provider_stats consistent with those events.

### 7. Tests (the critical set)
- State machine: transition table exhaustively tested — every legal transition, every illegal one rejected, actor validation on each.
- Double-booking: the SQL-level exclusion proof + the N-parallel-requests race + hold released on expiry/rejection/cancellation.
- Template regeneration preserves booked slots.
- OTP handshake: correct flow, wrong-OTP attempts, lock at 5, end OTP not revealed before IN_PROGRESS.
- Outbox: event written in same tx (force a tx rollback after state write → no outbox row leaks); at-least-once redelivery with idempotent consumer; backoff on failing handler; parked after max attempts; dispatcher lock (two dispatchers, no double-processing).
- Expiry job with injected clock.
- Acceptance rate math incl. the <5 null rule and ranking effect.
- Full e2e: search (slot-aware) → create → accept → en_route → arrived (start OTP) → work_done (end OTP) → verify event timeline + outbox topics emitted in order + provider_stats updated + slot lifecycle open→held→booked throughout.
- Phone masking/unmasking rules per state.

### 8. Docs
- `docs/API.md` updated. New `docs/bookings.md`: state diagram (mermaid), slot lifecycle, OTP handshake sequence, outbox pattern + how Phases 9/10 should subscribe, invariants list.

---

## Explicitly OUT of scope
Payments/refunds/fee collection (Phase 8 — visit_fee_paise is stored, never charged) · quotations (Phase 7) · reviews & trust scoring beyond acceptance rate (Phase 9) · notifications to users about any of these events (Phase 10 — outbox topics are the contract) · live location tracking of EN_ROUTE (deferred list) · chat (deferred) · multi-slot/multi-day jobs (v1 = single slot) · admin booking intervention endpoints (Phase 11).

---

## Done criteria
1. SQL-level double-booking proof + parallel-race test green. This is the phase's soul — if only one test survives, it's this.
2. State machine exhaustive tests green; every transition audited via events; projection==fold proven.
3. Outbox same-tx atomicity + at-least-once + idempotency proven; acceptance-rate consumer live and feeding search ranking.
4. Full e2e green. `lint/build/typecheck/test` clean; suite stable ×3; fresh-DB migrations (spatial indexes intact); idempotent seed.
5. Docs updated.

## Final deliverable
`docs/summaries/phase06-summary.md`, standard six-point format. Next phase preview: Phase 7 = quotations — itemized digital quotation (parts + labour, paise), versioned revisions, customer approve/reject in-app, quotation state riding on booking IN_PROGRESS, visit-fee-waiver-on-approval rule (fee config table), all emitting outbox events.
