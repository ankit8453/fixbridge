# PHASE 9 PROMPT — Reviews, Ratings & Trust Score

You are building **Phase 9 of 14** of the `fixbridge` marketplace. Phases 1–8 are on `main`: full booking lifecycle with frozen payables, double-entry money over both rails, and an outbox carrying every business event. Read `docs/summaries/phase08-summary.md`, `docs/money.md`, `docs/bookings.md` first. All established patterns apply.

**Why this phase matters:** verification (Phase 4) proves who a technician *is*; the trust engine proves how they *behave*. Ranking, badges, and suspension all flow from one auditable score. Design principle: **the score must be explainable** — "why is my score 62?" gets a component-by-component answer, because technicians will ask ops exactly that, in Hindi, angrily.

---

## Carry-over from Phase 8 (small)
Run the `COLLECT_FEE_AT_BOOKING` flag ON in one integration test end-to-end (book → upfront fee order → captured webhook → cancel → auto-refund consumer fires → ledger reversed). The flow exists; prove the integration once so flipping the flag later isn't a leap of faith.

---

## Context (frozen decisions in force)

- **Reviews are gated on money.** A review may only be created for a booking whose payment is settled (`captured` online payment OR recorded cash) — you can't rate a service you didn't complete and pay for. Review window: 7 days from settlement (config). One review per side per booking.
- **Two-way, asymmetric visibility.** Customer→provider reviews are public (they power ranking and the profile page). Provider→customer reviews are internal-only in v1 (fed to ops + future risk signals; never shown publicly) — document this clearly.
- **Trust score is an outbox consumer.** It subscribes to topics that already exist (`booking.*`, `payment.*`) plus this phase's `review.created` and `complaint.resolved`. Every recompute writes an append-only `trust_score_snapshots` row (score, components jsonb, trigger_event). Idempotent: replaying an event must not double-count (recompute-from-source-of-truth model makes this natural — recompute reads tables, not event payloads).
- **Score 0–100, pure function, components in config.** Suggested weights (config, tunable without code): avg rating (35), acceptance rate (20), completion reliability — provider-cancellation & no-show inverse (20), complaint record (15), activity recency (10). New providers with no data: score `null` (not 0) → ranking uses the existing neutral default; badges require real data. Recency: exponential decay over 90 days on rating/volume inputs — old glory fades, recent behavior dominates. Document every normalization in `docs/trust.md`.
- **Badge bands ride on verification.** `VERIFIED` = Phase 4's ladder complete (unchanged). `SILVER` = VERIFIED + trust ≥ 70 + ≥ 10 settled jobs. `GOLD` = VERIFIED + trust ≥ 85 + ≥ 30 settled jobs. Thresholds in config. Badge recomputed on every snapshot; downgrades happen (test it). Badge order for search gating stays: anything ≥ VERIFIED is searchable — bands affect *ranking and display*, not the gate.
- **Auto-suspension is a trust-engine output, not an ops whim.** Rules (config): trust < 30 with ≥ 10 settled jobs → suspended; 3 provider-cancellations within 7 days → suspended; complaint resolved as `severe` → suspended pending ops. Suspension = `provider_profiles.suspended_until` (timestamptz, null = not suspended) + reason code + outbox `provider.suspended`; search excludes suspended (extend the gate SQL + tests); ops lift/extend endpoints stubbed for Phase 11. Suspension does NOT touch verification badges — it's a separate axis, reversible.

---

## Phase 9 scope

### 1. Reviews
- `reviews`: id, booking_id, direction (`customer_to_provider` | `provider_to_customer`), author_user_id, subject_user_id, stars (1–5), tags (text[] from a fixed enum per direction — c2p: `punctual` | `polite` | `fair_price` | `clean_work` | `expert`; p2c: `respectful` | `clear_problem` | `paid_promptly` | `difficult`), text (nullable ≤500), status (`published` | `hidden`), created_at. Unique (booking_id, direction). Append-only after creation except `status` (ops moderation path, Phase 11 uses it; report-review endpoint this phase just flags via a `review_reports` table: id, review_id, reporter_user_id, reason, created_at).
- Create endpoint (author must be the booking's own customer/provider, settlement + window checks), emits `review.created`.
- Aggregates on provider: avg stars (1 decimal), count, tag frequencies — computed into `provider_stats` by the review consumer; exposed on provider profile GET, search result card (rating + jobs count), and a public paginated `GET /api/v1/providers/:id/reviews` (published c2p only; customer shown as first name + initial; text as-is).

### 2. Complaints
- `complaints`: id, booking_id, raised_by_user_id, against_user_id, category (`overcharge` | `no_show` | `quality` | `behavior` | `cash_dispute` | `safety` | `other`), description (≤1000), status (`open` | `in_review` | `resolved` | `dismissed`), resolution_note, severity_on_resolution (`minor` | `major` | `severe`, set by ops at resolve), resolved_by_user_id, created/resolved_at. Status via transition table; every transition appends to `booking_events` (the booking timeline stays the single narrative) + outbox topics (`complaint.opened`, `complaint.resolved`).
- Endpoints: raise (either party, booking must be ≥ ARRIVED — pre-arrival grievances are cancellations, not complaints; within 14 days of terminal state), view own; ops queue + resolve/dismiss with mandatory note + severity (`requireRoles ops/admin`).
- A `safety`-category complaint immediately (synchronously, not via consumer) sets the provider's `suspended_until` = pending-ops sentinel and emits the suspension event — safety doesn't wait for a poll loop. Test this path explicitly.

### 3. Trust engine
- `trust_score_snapshots`: id, provider_id, score (0–100), components jsonb (each input, its raw value, normalized value, weight, contribution), badge_band_after, trigger (topic + aggregate id), created_at. Append-only trigger.
- Consumer subscribes to: `booking.accepted/rejected/expired/cancelled_by_provider`, `payment.captured/cash_recorded`, `review.created`, `complaint.resolved`. Recompute = read current truth from tables (reviews, provider_stats, complaints, bookings) → pure `computeTrustScore(inputs, weights)` → snapshot + update `provider_stats.trust_score` + recompute badge band + evaluate suspension rules.
- Wire `RankInput.trustScore` live in the Phase 5 scorer (replace neutral default when present). Scorer tests updated: higher trust outranks at equal distance.
- `GET /api/v1/providers/me/trust` (provider): current score, badge, per-component breakdown (the "why is my score 62" endpoint — i18n'd component labels), last 10 snapshots trend. This becomes the partner-app screen in Phase 13.

### 4. Search & profile surfacing
- Result card gains: avg rating, review count, badge band, jobs completed. Suspended providers excluded (gate SQL + the exhaustive gate tests extended).
- Category `provider_count` (Phase 5 Redis cache) now counts non-suspended — accept the 5-min staleness, note it.

### 5. Seed
- Deterministic reviews across the paid/cash seeded bookings (mixed stars/tags), aggregates consistent; trust snapshots for all active providers (hand-computable); one provider seeded into SILVER, one into GOLD, one suspended (3 recent cancellations) — search tests rely on this distribution; two complaints (one open, one resolved `minor`).

### 6. Tests
- Gating: unpaid/no-cash booking → 403; window expiry (injected clock); double review → 409; actor validation; p2c never appears in public endpoints (test the leak explicitly).
- Trust math: hand-computed fixtures per component; null-until-data; decay behavior (old reviews matter less — clock-injected); config weight change reorders (and requires zero code change).
- Consumer idempotency: replay `review.created` ×3 → identical snapshot count grows but score/aggregates identical (recompute model) — assert aggregates don't inflate.
- Badges: SILVER earned at exactly the thresholds; GOLD; downgrade when rating drops; suspension never touches VERIFIED.
- Suspension: each auto-rule fires (clock-injected for the 7-day window); suspended vanishes from search; safety-complaint synchronous path; `suspended_until` expiry restores listing (job or lazy check — your call, document).
- e2e: full loop — paid booking → both reviews → trust snapshot → SILVER appears on search card → complaint `severe` resolved → suspended → gone from search → suspension lifted → back with lower score.
- Moderation: hidden review leaves aggregates (recompute excludes hidden — decide and document whether hidden reviews count; recommendation: excluded, recompute on hide).

### 7. Docs
- `docs/API.md` updated. New `docs/trust.md`: formula with every weight and normalization, badge bands, suspension rules, the explainability principle, "how to tune weights safely" note for post-pilot.

---

## Explicitly OUT of scope
Review replies/appeals (Phase 11 ops tooling at most) · ML/sentiment anything · customer-side trust scores (p2c data collected, not scored) · warranty claims flow (concept §7 — post-pilot; complaints cover disputes for now) · notification delivery of any of this (Phase 10 consumes the topics) · public web profile pages (Phase 12+) · photo/video review attachments (deferred).

---

## Done criteria
1. Review gating + two-way asymmetric visibility proven (including the p2c leak test).
2. Trust math hand-verified; explainability endpoint returns full component breakdown; weights tunable via config alone.
3. Consumer idempotency proven; badge transitions including downgrade; every auto-suspension rule fires and search excludes correctly.
4. e2e loop green. `lint/build/typecheck/test` clean; stable ×3; fresh-DB migrations (all prior constraints intact); idempotent seed with hand-computable trust numbers.
5. Docs updated.

## Final deliverable
`docs/summaries/phase09-summary.md`, standard six-point format. Next phase preview: Phase 10 = notifications — the outbox finally speaks to humans: notification templates (hi/en) over WhatsApp/SMS/in-app behind a `MessageTransport` interface (fake + console transports now, MSG91/WhatsApp adapters interface-ready for when DLT clears), per-topic routing rules, quiet hours, an in-app notification inbox, and delivery-status tracking.
