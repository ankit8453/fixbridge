# PHASE 4 PROMPT — Verification Engine (manual-first)

You are building **Phase 4 of 14** of the `fixbridge` marketplace. Phases 1–3 are on `main`: core infra, OTP auth with roles + instant revocation, categories, customer addresses, and provider profiles with completeness-gated listing. Read `docs/summaries/phase03-summary.md` and `docs/geo-notes.md` first. Follow all established patterns.

**Why this phase matters:** verification IS the product promise. The word "verified" must be concrete, auditable, and reconstructable — we must always be able to answer *"why did this technician have a badge on the day of the incident?"* That sentence drives every design decision below.

---

## Carry-over tasks from Phase 3 review (do first)

1. **Completeness hard gates.** Change `is_listed` to: `hard_gates_pass AND score >= threshold`. Hard gates: displayName, base_location, ≥1 skill, ≥1 active price card, ≥1 active availability window. Score keeps measuring the full checklist (soft quality items: bio, years_experience, photo doc). Update the "nameless technician gets listed" test to assert the opposite; update the missing-items breakdown to distinguish hard gates from soft items (Flutter onboarding will render them differently).
2. **Rate-limit retune (approved):** OTP per-IP 5 → 30 per 15 min (CGNAT reality in India), per-phone 3 → 5, plus a 60-second resend cooldown per phone. Adjust tests.

---

## Context (frozen decisions in force)

- **Append-only, always.** Verification state transitions are new rows, never UPDATEs of status. History is the feature.
- **Manual-first.** Ops humans make the real decisions this phase. Third-party KYC APIs (Surepass/OnGrid-style) are stubbed behind adapter interfaces so wiring them later touches nothing else.
- **NEVER store raw Aadhaar numbers.** Not in DB, not in logs, not in test fixtures. Document images may contain them (unavoidable) — the images live in object storage, private, signed-URL access only. Any structured field for ID numbers stores only a masked form (last 4) + the adapter's reference token.
- **DPDP mindset:** minimum PII, purpose-limited, short-expiry signed URLs, every ops read/decision on KYC data leaves a trace.
- The four levels (concept doc §6.1): **0 identity · 1 background · 2 skill · 3 references.**
- Badge model for now: passing all four levels → badge `VERIFIED`. `SILVER`/`GOLD` are trust-score bands computed in Phase 9 — define the enum with all three now, but only `VERIFIED` is attainable this phase.

---

## Phase 4 scope

### 1. Object storage (dev: MinIO)
- Add MinIO to docker-compose (with console port, healthcheck, volume). Private bucket for KYC docs created on startup/seed if missing.
- `StorageService` interface: `getUploadUrl(key, contentType, maxBytes)`, `getDownloadUrl(key, expirySeconds)`, `delete(key)`, `exists(key)`. One S3-compatible implementation (works for MinIO now, S3/R2 later — aws-sdk v3 or minio client, your call, document it).
- Upload flow: client asks API → API returns **pre-signed PUT URL** (5-min expiry, content-type + size-limited ≤ 10 MB, key structure `kyc/{providerId}/{docType}/{uuid}`) → client uploads directly → client confirms → API verifies object exists, records metadata. API never proxies file bytes.
- Download: signed GET URLs, 5-min expiry, only via authorized endpoints (owner or ops).
- Wire the Phase 3 `provider_documents` table into this flow: replace metadata-only stubs with real statuses `awaiting_upload → uploaded`.

### 2. Verification data model
- `verification_cases`: id, provider_id, level (0–3), status (**derived** — see below), opened_at. One open case per (provider, level) — partial unique index.
- `verification_events` (the append-only core): id, case_id, event_type (`submitted` | `moved_to_review` | `info_requested` | `info_provided` | `passed` | `failed` | `adapter_result_received`), actor_type (`provider` | `ops` | `system`), actor_user_id (nullable for system), notes (nullable), payload (jsonb — e.g. which docs, adapter reference token, masked fields), created_at. **No UPDATE or DELETE on this table, ever** — enforce with a Postgres trigger that raises on UPDATE/DELETE, and a test that proves the trigger fires.
- Case `status` is a *projection* of its latest event (`submitted → in_review → needs_info → passed/failed`), stored on the case row for query convenience but recomputed from events on every write — a unit test must prove projection == fold(events).
- State machine (pure function, exhaustively unit-tested): valid transitions only — e.g. `submitted → in_review`, `in_review → passed | failed | needs_info`, `needs_info → info_provided → in_review`. `failed` cases can be reopened by a NEW case (old one stays closed forever); passed is terminal per case.
- `provider_verification_summary` (or computed columns on provider profile): levels_passed (int array/bitmask), badge (`NONE` | `VERIFIED` | `SILVER` | `GOLD`), badge_since (timestamptz nullable). Recomputed transactionally whenever a case passes/fails. **If any passed level is later failed via a new case (re-check gone wrong), the badge downgrades immediately** — test this.

### 3. Level-specific submission requirements (validated at `submitted`)
- **Level 0 (identity):** id_proof doc uploaded + selfie photo doc uploaded + masked ID last-4 + id_type (`aadhaar` | `pan` | `dl` | `voter`).
- **Level 1 (background):** consent boolean (timestamped in payload) — the actual check is ops/adapter work.
- **Level 2 (skill):** at least one of: certificate doc (`certificate` type) OR trade-test flag with ops notes OR field-audit flag (payload records which path).
- **Level 3 (references):** exactly 2 references: name, phone (E.164), relationship (`past_employer` | `shop_owner` | `senior_technician` | `other`). Reference phones stored for ops calling; masked in provider-facing responses.
- Levels are **independent** — a provider may submit 0 and 2 in parallel. (Sequencing pressure comes from the badge requiring all four.)

### 4. Adapter interfaces (stubs only)
- `IdentityKycAdapter`, `BackgroundCheckAdapter` interfaces: `initiate(caseRef, payload) → { referenceToken }`, `handleResult(referenceToken, result)`. One `ManualAdapter` implementation that does nothing (ops decide), one `FakeAdapter` for tests that auto-resolves configurable pass/fail after a tick — proving the async `adapter_result_received` event path works end to end. Real Surepass/OnGrid wiring is explicitly a later concern.

### 5. Endpoints
- Provider (role technician, own data only): submit level N, provide requested info, view own cases + event history (ops internal notes redacted), request doc upload URLs, list own docs.
- Ops (role ops/admin): review queue `GET /api/v1/admin/verification/queue?status=&level=&city=` (paginated, oldest-first), case detail with full event history + signed doc URLs, decide (`pass`/`fail`/`request_info` with mandatory notes on fail/request_info).
- **Every ops doc-view and decision writes an event or audit row** — viewing documents is `payload: {viewed_docs: [...]}` on an `info` event or a lightweight `kyc_access_log` table (your call, document it). Ops actions on KYC data must be reconstructable.

### 6. Events → listing interplay
- Passing levels does NOT bypass completeness; badge and is_listed are independent axes. (Phase 5 search will require `is_listed AND badge >= VERIFIED`.) Add `badge` to the provider profile GET response.

### 7. Seed
- Extend seed: of the 17 listed technicians — 12 fully VERIFIED (all levels passed, with realistic event histories: submitted → in_review → passed, some with a needs_info detour), 3 mid-pipeline (various levels/statuses), 2 with no verification started. The 3 unlisted keep no verification. This distribution feeds Phase 5 tests.
- Seed an ops user (roles [ops]) if Phase 2's seed didn't already.

### 8. Tests
- State machine: every valid transition, every invalid transition rejected.
- Append-only trigger fires on UPDATE and DELETE attempts.
- Projection == fold(events) property.
- Full e2e: technician uploads docs (real MinIO round-trip) → submits all 4 levels → ops works the queue → needs_info detour on one level → provider responds → all pass → badge VERIFIED appears with badge_since → new failed re-check case on level 1 → badge drops to NONE.
- AuthZ: provider A cannot see provider B's cases/docs; customer role gets 403 on all verification routes; ops queue closed to technicians.
- Signed URL expiry actually enforced (fetch after expiry fails).
- Grep-test: no 12-digit Aadhaar-like numbers in any fixture/log output (write a small test that scans fixtures).

### 9. Docs
- `docs/API.md` updated. New `docs/verification.md`: the ladder, state machine diagram (mermaid), append-only rationale, adapter wiring plan for real KYC APIs.

---

## Explicitly OUT of scope
Real Surepass/OnGrid/DigiLocker API calls · trust score & SILVER/GOLD computation (Phase 9) · auto-suspension rules (Phase 9) · admin UI (Phase 11 — API only now) · virus scanning of uploads (note it for Phase 14) · reference-calling workflow tooling (ops does it by phone; they record the outcome via decide endpoint) · document OCR.

---

## Done criteria
1. Carry-over items done, tests updated.
2. Full e2e above green, including MinIO round-trip and badge downgrade.
3. Append-only proven by trigger tests; every case history fully reconstructable from events alone.
4. No raw Aadhaar anywhere (scan test green).
5. `lint/build/typecheck/test` clean; fresh-DB migrations; idempotent seed (12 VERIFIED count stable across runs).
6. Docs updated.

## Final deliverable
`docs/summaries/phase04-summary.md`, standard six-point format. Next phase preview: Phase 5 = geo-search & matching — PostGIS `ST_DWithin` radius search filtered by `is_listed AND badge VERIFIED` AND availability-window coverage, pluggable ranking (distance/trust/acceptance/price), Postgres FTS + trigram with a Hinglish synonym table ("motor jal gayi" → motor rewinding).
