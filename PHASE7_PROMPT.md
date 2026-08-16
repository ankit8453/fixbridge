# PHASE 7 PROMPT — Quotations & Pricing

You are building **Phase 7 of 14** of the `fixbridge` marketplace. Phases 1–6 are on `main`; the booking state machine, append-only `booking_events`, and the transactional outbox are live. Read `docs/summaries/phase06-summary.md` and `docs/bookings.md` first. Reuse every established pattern: transition-table-as-data, projection-from-log, same-tx outbox writes, Zod, i18n (hi+en), paise integers.

**Why this phase matters:** the itemized digital quotation is the product's answer to tier-2 India's #1 service fear — surprise pricing after the work. "Price agreed in writing before work proceeds" is a trust feature first, a data model second. It also produces the exact number Phase 8 will collect, so correctness of totals is money-grade.

---

## Context (frozen decisions in force)

- **Two pricing paths through a booking:**
  - **Direct path:** simple jobs booked against a `fixed`/`starting_from` price card can go straight to WORK_DONE with no quotation (Phase 6 behavior, unchanged). Payable = price card amount (for `fixed`) — `starting_from` and `inspection_based` jobs REQUIRE an approved quotation before WORK_DONE.
  - **Quotation path:** after arrival/inspection (booking IN_PROGRESS), provider sends an itemized quote; customer approves in-app; work proceeds; WORK_DONE settles against the approved quote.
- **Quotations are versioned, never edited.** A revision is a new row superseding the old (same immutability philosophy as everything else — the customer saw v1; v1 must survive forever). All quote lifecycle events also land in `booking_events` (the booking's timeline is the single narrative) and the outbox.
- **Visit-fee waiver rule (concept doc §7):** the visit fee (snapshotted on the booking at creation) is charged when the customer walks away, waived-into-the-bill when work proceeds: if a quotation is approved, `visit_fee_charged = false` and the payable is the quote total alone; if the booking ends via quote-declined or direct-path-without-quote, visit fee applies as configured. Config table makes fees city/category-tunable.
- Booking state machine is EXTENDED (transition table is data — add rows, don't restructure): from `IN_PROGRESS`, two new terminals become reachable: `CLOSED_QUOTE_DECLINED` (customer rejected the final quote and ended the job — visit fee payable, no work billed) and the existing `WORK_DONE`. WORK_DONE gains guards (below).
- Money math: integers only; total must equal sum of line items; no floats anywhere; negative/zero line amounts rejected.

---

## Phase 7 scope

### 1. Fee config
- `fee_config`: id, city_id, category_id (nullable = city default), visit_fee_paise, is_active, effective_from. Resolution: exact (city, category) → city default → global config default (4900). Booking creation (Phase 6 code) now snapshots via this resolution instead of the flat config constant — small refactor, keep the snapshot behavior.
- Seed: Jabalpur default 4900; motors/genset cluster 9900 (higher-skill visits); AC gas refill 7900.

### 2. Quotation model
- `quotations`: id, booking_id FK, version (int, per-booking sequence), status (`sent` | `approved` | `rejected` | `superseded` | `withdrawn`), labour_paise, parts_total_paise (denormalized = sum of items), total_paise (= labour + parts, DB CHECK), note (nullable ≤500), created_by (provider user id), decided_at, created_at. Partial unique index: at most ONE quotation per booking in status `sent` or `approved`.
- `quotation_items`: id, quotation_id, kind (`part` | `labour_extra`), description (≤120 chars), qty (int ≥1), unit_paise (>0), line_total_paise (= qty × unit, DB CHECK). ≥0 items allowed only if labour_paise > 0 (a pure-labour quote is legal; an empty quote is not).
- Immutability: `quotations` and `quotation_items` are append-only after creation (trigger: no UPDATE except the status/decided_at columns on quotations via defined transitions; no DELETE — reuse the purge-flag pattern for DPDP).

### 3. Lifecycle & rules
- **Send** (`POST /api/v1/bookings/:id/quotations`, booking's provider only, booking must be IN_PROGRESS): creates version N (N = last+1), any previous `sent` quote → `superseded` atomically. Emits `quotation.sent` (outbox + booking_events).
- **Withdraw** (provider, own `sent` quote): → `withdrawn`. Provider may then send a corrected version.
- **Approve** (`POST /quotations/:id/approve`, booking's customer only, quote must be `sent`): → `approved`, decided_at set, emits `quotation.approved`. Approval **locks pricing**: no further quotations may be sent on this booking (unique index + service guard). 
- **Reject** (customer, with optional reason ≤200): → `rejected`, emits `quotation.rejected`. Provider may send a revision (v2, v3…). Rejection does NOT end the booking — ending it is a separate explicit customer action:
- **Decline & close** (`POST /bookings/:id/decline-work`, customer, IN_PROGRESS, only when no `sent` quote is pending and no quote approved): booking → `CLOSED_QUOTE_DECLINED`, slot stays consumed (the visit happened), payable = visit fee. Emits booking event + outbox.
- **WORK_DONE guards (extend Phase 6):** end-OTP submission is rejected if (a) a quotation is `sent` (awaiting decision — settle the price first), or (b) the booking's price card is `starting_from`/`inspection_based` and no `approved` quote exists. Direct path for `fixed` remains untouched.
- **Payable computation** (pure function, unit-tested to death — Phase 8's invoice will call it): on WORK_DONE → `{ payable_paise, components }` = approved quote total (visit fee waived) OR fixed price card amount + visit fee per fee-waiver config. On CLOSED_QUOTE_DECLINED → visit fee only. Snapshot the result onto the booking (`payable_paise`, `payable_breakdown` jsonb) at terminal transition — Phase 8 charges what was frozen here, not a recomputation.

### 4. Endpoints & visibility
- Both parties view quote history on their booking (all versions, statuses, full itemization — transparency is the point).
- Quotation appears in booking detail responses; list endpoints gain `payable_paise` when terminal.
- All quote actions actor-validated (booking's own provider/customer only), all i18n'd.

### 5. Seed
- Extend the booking seed: one IN_PROGRESS with a `sent` quote (2 parts + labour), one WORK_DONE via approved quote (fee waived in breakdown), one WORK_DONE direct-path fixed (fee applied per config), one CLOSED_QUOTE_DECLINED (fee only), one with a rejected v1 + approved v2 history. provider_stats untouched (quote outcomes are not acceptance events).

### 6. Tests
- Money math: totals = sums enforced at DB and service level; zero/negative rejected; big-qty overflow sanity (int4 vs int8 — pick and justify).
- Versioning: v2 supersedes v1 atomically; concurrent double-send race → one wins, one 409; approve-vs-supersede race → single winner (the partial unique index is the wall — test it at SQL level like the slot constraint).
- Guards: WORK_DONE blocked with pending quote; blocked for inspection_based without approval; decline-work blocked while quote pending; no quotes after approval/terminal; actor enforcement.
- Payable function: fixed+fee, approved-quote+waiver, declined+fee-only, fee_config resolution chain (city+category > city > global) — hand-computed fixtures.
- Immutability triggers fire on UPDATE/DELETE of items.
- Full e2e: book (inspection_based) → accept → arrive → quote v1 sent → rejected → v2 sent → approved → end OTP → WORK_DONE → payable snapshot matches v2 total with fee waived → timeline shows every step; plus the decline-and-close e2e asserting fee-only payable.
- Outbox: `quotation.sent/approved/rejected` topics emitted, consumable, idempotent.

### 7. Docs
- `docs/API.md` updated. `docs/bookings.md` extended: quote lifecycle diagram, the two pricing paths, payable computation table (all cases), fee-waiver rule stated in one unambiguous sentence.

---

## Explicitly OUT of scope
Payment collection/refunds/ledger (Phase 8 — payable_paise is frozen, never moved) · GST/invoicing formatting (Phase 8) · parts catalog/inventory (deferred — items are free text) · quote PDFs (deferred) · price suggestions/ML · admin quote intervention (Phase 11) · notifications (Phase 10 consumes the topics).

---

## Done criteria
1. The two race tests (double-send, approve-vs-supersede) green with SQL-level proof.
2. Payable function covers every path with hand-computed fixtures; snapshot frozen at terminal transition.
3. WORK_DONE guards enforced; quote history immutable; full e2e green both paths.
4. `lint/build/typecheck/test` clean; stable ×3; fresh-DB migrations (all prior indexes/constraints intact); idempotent seed.
5. Docs updated.

## Final deliverable
`docs/summaries/phase07-summary.md`, standard six-point format. Next phase preview: Phase 8 = payments, ledger & wallet — Razorpay adapter behind an interface with a fake for dev/test, double-entry `ledger_entries` (money exists only as ledger rows; balances are views), UPI collect + logged cash path, webhook idempotency via `webhook_events`, T+1 payout batches, refund of visit fee edge cases. The `payable_paise` snapshot from this phase is its input contract.
