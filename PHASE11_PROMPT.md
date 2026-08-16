# PHASE 11 PROMPT — Admin Dashboard (ops cockpit)

You are building **Phase 11 of 15** of the `fixbridge` marketplace. Phases 1–10 are on `main`: the backend is functionally complete. Read `docs/summaries/phase10-summary.md` first. This phase has two halves: (a) the remaining ops **backend** endpoints + the audit-log backbone, (b) the **React SPA** at `apps/admin` — the first real frontend in the repo.

**Why this phase matters:** manual-first was a frozen decision — verification, complaints, payouts, dues all route through human judgment. Until now that human had only `curl`. This dashboard is where you (and later a hired ops person) actually run the marketplace. Design principle: **every screen answers "what needs my attention?" and every action leaves a trace.**

---

## Context (frozen decisions in force)

- Stack (frozen since Phase 1): **Vite + React + TypeScript + Tailwind** at `apps/admin`. NOT Next.js (that's Phase 12's customer web — different app, different needs; admin needs no SEO/SSR). Add: React Router, TanStack Query for server state, plus your choice of minimal component approach (headless-ui/radix or hand-rolled — document; no heavy UI kit). Shared API types come from `packages/shared` — if request/response types currently live only in the API app, promote the ones admin consumes into shared as part of this phase (backend imports them back — one source of truth).
- Auth: the SAME OTP login (ops/admin roles) — no separate password system. Access token in memory, refresh token via the existing rotation endpoints, `requireRoles('ops','admin')` guards every admin API. Dev login uses the fixed-OTP path; the SPA shows a small dev-mode hint for it (`import.meta.env.DEV` only).
- **Audit log is the phase's backbone.** New `audit_logs` table: id, actor_user_id, action (string enum, e.g. `verification.decide`, `payout.mark_paid`), target_type + target_id, payload jsonb (the decision's substance: before/after, notes, amounts), ip, request_id, created_at. Append-only (trigger, purge-hatch pattern). An `audited()` middleware/helper wraps every admin mutation — writing the audit row IN THE SAME TRANSACTION as the mutation. A repo-wide test asserts every admin-router mutating route is audited (enumerate routes, assert coverage — new unaudited admin routes must fail CI).
- Admin UI language: **English-only v1** (internal tool; Hindi later if ops hiring needs it — document). User-facing i18n rules don't apply here, but currency renders as ₹ with paise→rupee formatting in exactly one shared util.
- The API keeps its existing conventions; all new endpoints under `/api/v1/admin/*`, Zod-validated, paginated where lists.
- CORS: config gains `ADMIN_ORIGIN` (default `http://localhost:5173`), applied to admin routes.

---

## Phase 11 scope

### A. Backend — close the ops gaps

1. **Audit backbone** as above, threaded through EVERYTHING below and retrofitted onto existing admin mutations (verification decide from Phase 4, refunds from Phase 8, complaint resolve from Phase 9).
2. **Users & providers ops:** list/search users (by phone fragment/name/role/status, paginated); user detail (roles, status, bookings count, linked profiles); block/unblock endpoint (wraps the Phase 3 `blockUser` service — instant denylist + reason, audited); provider detail aggregate (profile + completeness breakdown + verification summary + trust breakdown + suspension state + wallet balance + recent bookings — one endpoint, the SPA's provider page); suspension lift / extend (with mandatory reason; wraps Phase 9 stubs); entry-approval config flag `require_entry_approval` per city (the Phase 3/4 discussion — build the flag + pending-approval queue endpoint; when off, queue is simply empty).
3. **Bookings ops:** search (by id, phone, status, date range); full timeline endpoint (every booking_event + quotations + payments + notifications for one booking — the dispute-resolution view); **OTP unlock** (the Phase 6 `otp_locked` flag finally gets its resolution endpoint: ops verifies identity by phone, unlocks with mandatory note, audited); ops-cancel with reason (rare, audited, follows state machine rules — only pre-ARRIVED).
4. **Money ops:** dues settlement recording (Phase 8 stub → real endpoint: provider paid ₹X dues via UPI, ops records with ref, ledger `dues_settled` journal posts); payout batch lifecycle endpoints confirmed/finished (create draft → review → mark individual payouts paid with UTR → close batch); ledger browser endpoint (journal list w/ filters + journal detail with entries — read-only); revenue/GMV summary endpoint for the overview (from the existing views: today/7d/30d bookings, GMV, platform revenue, outstanding dues, pending payouts).
5. **Queues:** parked outbox rows (list + retry-now + discard-with-reason, audited); failed/parked webhook_events (list + reprocess + discard); parked notification_deliveries (list + retry + discard); verification queue (exists — ensure pagination/filters match SPA needs); complaint queue (exists); review reports queue + hide/unhide review (recompute aggregates on hide per Phase 9's decision).
6. **Seed:** an `admin` role user + an `ops` user with known dev phones (document in README); a few parked items so the queues aren't empty in dev.

### B. Frontend — the SPA

Pages (left-nav layout,每 page = its own route):
1. **Overview** — the "what needs my attention" wall: queue depths as clickable cards (verification pending, open complaints, review reports, parked deliveries/outbox/webhooks, otp-locked bookings, pending payout batch), today's bookings by status, GMV/revenue tiles, dues outstanding. Numbers from the summary endpoint; every card links to its queue.
2. **Verification queue** — filterable list → case detail: event timeline, submitted data, document viewer (signed URLs rendered in sandboxed `<img>`; non-image docs = download link only — the Phase 5 inert-download work pays off here), decide actions (pass/fail/request-info with notes), the provider's other cases inline.
3. **Providers** — search/list → detail page assembling the aggregate endpoint: completeness, badge & trust breakdown (the "why is my score 62" data, rendered), suspension controls, wallet + dues, recent bookings, block/unblock. This page is where most ops phone calls get answered.
4. **Bookings** — search → timeline view (the dispute screen: chronological merge of events/quotes/payments/notifications with actor labels), OTP unlock action, ops-cancel.
5. **Complaints** — queue → detail (linked booking timeline embedded) → resolve/dismiss with severity + note.
6. **Reviews** — reports queue, review context, hide/unhide.
7. **Money** — payout batches (create, review list, mark-paid-with-UTR flow, close), dues settlement recording form, ledger browser (filter by journal type/booking/provider; journal detail shows balanced entries), revenue summary.
8. **Queues** — the three parked lists with retry/discard.
9. **Audit log** — filterable viewer (actor, action, target, date) — read-only, paginated.
10. **Login** — phone + OTP, role-gated (non-ops login → clear error), token refresh handled invisibly, logout.

UX bar (pilot-grade, not pretty-grade): loading/error/empty states on every query; optimistic updates NOT required (correctness first — invalidate + refetch); confirmation dialogs on destructive/money actions with the reason/note field inline; every list paginated; relative timestamps with absolute on hover; ₹ formatting via the one shared util; keyboard-submittable forms. No dark mode, no theming, no dashboard-builder abstractions.

### C. Tests
- Backend: every new endpoint (authZ: customer/technician tokens → 403 everywhere; ops vs admin where they differ); audit coverage test (the CI-enforced enumeration); audit row written in-tx (mutation rollback → no audit row); OTP unlock flow; dues settlement posts the correct journal; payout mark-paid math; hide-review recompute; parked retry actually re-dispatches.
- Frontend: Vitest + React Testing Library on the critical flows — login + role gate, verification decide (mock API), payout mark-paid with UTR form validation, complaint resolve. No browser e2e suite this phase (document as Phase 15 candidate with Playwright if pilot ops volume justifies).
- The existing 958-test suite stays green — admin work must not disturb the core.

### D. Docs
- `docs/API.md` gains the admin section. New `docs/admin-guide.md`: a plain-language ops runbook — how to verify a technician, resolve a complaint, run a payout batch, settle dues, unlock a booking — written for a future ops hire who has never seen the codebase (screenshots optional, numbered steps mandatory). README gains admin dev-run instructions (`npm run dev` in apps/admin + the dev login phones).

---

## Explicitly OUT of scope
Next.js customer web (Phase 12) · admin Hindi i18n · charts/analytics beyond the tile numbers (post-pilot) · role/permission editor UI (roles change via seed/DB for pilot) · bulk actions · CSV exports (Phase 15 if needed) · websocket live-updating queues (refetch on focus is enough) · dark mode · admin mobile responsiveness beyond "usable on a tablet".

---

## Done criteria
1. Audit coverage test green and CI-enforced; every admin mutation traceable with actor + substance.
2. All ops gaps closed: OTP unlock, dues settlement, suspension lift, payout lifecycle, parked-queue retries — each proven by test.
3. SPA: an ops user can log in and complete the five core jobs (verify a technician, resolve a complaint, unlock a booking, run a payout batch, retry a parked delivery) against the seeded dev stack.
4. Full suite (958 + new) green ×3; `lint/build/typecheck` clean across BOTH apps; fresh-DB migrations; idempotent seed.
5. `docs/admin-guide.md` readable by a non-programmer.

## Final deliverable
`docs/summaries/phase11-summary.md`, standard six-point format. Next phase preview: Phase 12 = the Next.js customer web (`apps/web`): SEO-first landing (Hindi-first, "electrician in Jabalpur" queries, live category/provider counts, APK download page, DPDP privacy/terms) + the full logged-in booking experience (OTP login, search, slot booking, quote approve, Razorpay web checkout, booking timeline, reviews) — the pilot's first customer-facing surface.
