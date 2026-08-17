# PHASE 12 PROMPT — Web Platform (Next.js): Marketing + Customer + Partner

You are building **Phase 12 of 15** of the `fixbridge` marketplace. Phases 1–11 are on `main`: the backend is functionally complete and the admin SPA runs at `apps/admin`. Read `docs/summaries/phase11-summary.md` first. This phase creates `apps/web` — a single Next.js application with THREE surfaces: (A) the public marketing/SEO site, (B) the customer booking web app, (C) the partner (technician) web app. Plan change since earlier docs: partner-on-web is now IN scope — update any stale "C skipped" notes in docs.

**Why this phase matters:** this is the pilot's first customer-facing surface. A WhatsApp-forwarded link must land someone on a page that looks trustworthy, gets them logged in, and books a verified mistri — on a ₹8,000 Android phone over 4G. **Mobile-first is not a checkbox; it's the design target.** Desktop is the adaptation.

---

## Carry-over from Phase 11 review (do first — backend + admin SPA correction)

**Split ops vs admin permissions properly.** Phase 11 treated ops and admin as near-equivalent. Correct split: `ops` (sub-admin) may do the judgment work — verification decisions, complaints, review moderation, OTP unlock, suspension lift/extend, block/unblock, parked-queue retries, payout batch create/review. **`admin` ONLY** for money-critical and config actions: refunds, payout mark-paid, dues settlement recording, fee/commission config, entry-approval flag. Implement: tighten `requireRoles('admin')` on those endpoints; the admin SPA hides (not just disables) admin-only actions for ops users (role from the token); audit log viewer shows ops users only their own actions, admins everything. Tests: an ops token receives 403 on EVERY admin-only route (enumerated, CI-enforced alongside the audit coverage test); SPA role-gating component tests.

---

## Context (frozen decisions in force)

- **Stack:** Next.js (App Router) + TypeScript + Tailwind at `apps/web`, in the existing npm workspace. API types from `packages/shared`. The API remains the single backend — web calls the same `/api/v1/*` endpoints; NO business logic in Next.js.
- **PLAN CHANGE — one frontend for everything.** `apps/web` is now the ONLY web frontend, with FOUR surfaces as route groups: marketing (public), `/app` (customer), `/partner` (technician), `/admin` (ops/admin — ported from `apps/admin`, see section D). At the end of this phase `apps/admin` is deleted from the repo (its phase summaries/docs stay; docs referencing it get updated). One Vercel project serves the whole domain.
- **Brand is still undecided.** All naming through `APP_NAME` / a single brand-tokens module (name, logo placeholder, color tokens) — swapping the final brand must touch one file. No brand strings hardcoded in copy, metadata, or images.
- **Auth on web (security posture):** access JWT in memory only; refresh token in an **httpOnly, Secure, SameSite=Lax cookie** managed by thin Next.js route handlers (`/api/session/login|refresh|logout`) that proxy to the API's auth endpoints — the refresh token must never be readable by page JavaScript (XSS containment). Device id = generated + persisted in localStorage (it's not a secret). Silent refresh on 401, single-flight. Document the flow in `docs/web.md`. Login OTP in dev = fixed-OTP path with a dev-mode hint (same convention as admin); real delivery awaits DLT (Phase 15 wiring).
- **i18n: Hindi-first.** Default locale `hi`, toggle to `en`, Next i18n routing (`/` = hi, `/en/...` = en). Web copy lives in web-local locale files (same key discipline); localized category/data comes from the API (Accept-Language header follows the active locale; logged-in users' `preferred_language` synced on toggle). Devanagari via `next/font` (Noto Sans Devanagari + Latin fallback) — no FOUT jank on cheap devices.
- **SEO applies ONLY to surface A.** Marketing pages: SSG/ISR, full metadata, OpenGraph, JSON-LD (`LocalBusiness` + `Service`), sitemap.xml, robots.txt, hreflang hi/en. App surfaces (B/C): `noindex`, client-rendered is fine.
- **Roles:** one phone can hold customer + technician roles. Surface B requires login (any role); surface C requires `technician` role, with a "become a partner" flow that calls the existing `POST /providers/me/register`.
- CORS/config: API config gains `WEB_ORIGIN` (default `http://localhost:3000`). Web env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` (key id only — never the secret). `.env.example` per app.

---

## Phase 12 scope

### A. Marketing site (public, SEO-first)
Routes: `/` (homepage: hero promise — verified technician, upfront pricing, OTP-secured visits; live trust numbers from public APIs: verified technician count, categories, avg rating; how-it-works in 4 steps; category grid with provider counts; footer with legal links), `/services` + `/services/[category-slug]` (per-category landing pages — these are the "electrician in Jabalpur" SEO targets: localized intro copy, live provider count, starting prices from public data, FAQ block, book-now CTA into surface B), `/how-it-works`, `/for-partners` (supply-side pitch: part-time earnings, low commission, badge ladder — CTA into partner registration), `/download` (APK download page — placeholder cards for customer/partner apps with "coming soon" until Phases 13/14 produce artifacts; page structure + copy final now), `/privacy` + `/terms` (DPDP-compliant: what data, why, retention, erasure rights, grievance contact — draft honest v1 text, flag for legal review in summary), `/contact`.
ISR revalidation for live numbers (e.g. 10 min). Lighthouse budget documented: mobile performance ≥ 85 on the homepage (measure, note the score in the summary — cheap phones are the audience).

### B. Customer web app (`/app/...` routes, logged-in)
1. **Login/onboarding:** phone → OTP → (first time) name + language; address book CRUD with browser geolocation ("use my location") + manual entry with landmark field (the tier-2 pattern), map-less v1 (coordinates from geolocation or geocode stub — honest about it).
2. **Find:** category browse (grid, provider counts) + search box wired to `/search/resolve` (Hinglish suggestions as-you-type, debounced) → results list using the full Phase 5/9 card (badge, rating, jobs, distance, starting price, next slot) with sort + max-distance controls; location from chosen address or geolocation.
3. **Provider page:** profile, badge/rating/jobs, price cards, reviews (paginated), slot picker (from `/providers/:id/slots`) → book (address select + problem note + slot confirm).
4. **Bookings:** list (active/past) + detail = the customer's mission control: status timeline (rendered from events), provider info with phone reveal post-acceptance, **start OTP displayed prominently when ACCEPTED** ("technician aane par yeh code batayen"), quote view with line items + approve/reject (+ decline-work with fee explanation), **end OTP displayed during IN_PROGRESS**, cancel with reason codes where the state machine allows.
5. **Pay:** on WORK_DONE/CLOSED_QUOTE_DECLINED — Razorpay web checkout (`checkout.js` script, order from `POST /bookings/:id/payments`, callback to the optimistic endpoint, then poll booking payment status until webhook confirms — the UI must survive the closed-browser case gracefully: reopening shows true state). Cash path: "paid cash" is recorded by the technician; customer sees the cash-recorded state + the dispute path (complaint) if wrong.
6. **After:** review form (stars/tags/text) gated exactly as the API gates; complaints (raise + track); notification inbox (list/read, unread badge in the shell).

### C. Partner web app (`/partner/...` routes, technician role, mobile-browser-first)
1. **Onboarding:** become-a-partner registration; then a checklist home rendered from the completeness breakdown (hard gates vs soft items, exactly as the API reports) — profile basics, base location (geolocation), service radius, skills picker (leaf categories), price cards CRUD, availability template editor (day-of-week + windows; the part-timer's "weekday evenings + Sunday" must be a 30-second setup), document upload via the signed-URL flow (request → direct PUT → confirm).
2. **Verification center:** per-level status cards, submit each level (docs, consent, references form), needs-info responses, event history — the badge ladder made visible and motivating.
3. **Jobs:** inbox of REQUESTED (with expiry countdown), accept/reject (reason codes); active job screen driving the lifecycle: en-route tap → **enter start OTP** (big numeric keypad UX) → in-progress: create/revise quotation (line-item builder: description/qty/unit price, running total, send) → **enter end OTP** → work done → **"cash collected" button** (with confirmation + amount display) when customer pays cash. Job history list.
4. **Earnings:** wallet (balance, dues owed with explanation, pending/paid payouts with UTR), simple period totals.
5. **Trust:** score + component breakdown + trend (the Phase 9 endpoint, rendered in Hindi), badge progress ("SILVER tak: 3 aur jobs"), suspension state with reason + ops contact if suspended.
6. **Slots:** calendar-ish week view of materialized slots; block/unblock open slots (chhutti button).
7. Notification inbox (shared component with B).

### D. Admin port (`/admin/...` routes — from apps/admin)
Port the Phase 11 admin SPA into this app as the `/admin` route group: all ten pages, unchanged in function, English-only as before. Components/queries move nearly as-is into client components; React Router → Next routes; the session layer reuses this app's cookie-based auth (admin/ops roles through the same login page — role in the token decides landing surface). Admin routes: `noindex,nofollow` metadata + a role-gated layout (non-ops/admin → login or 404-style wall; no admin nav ever renders for other roles). The Phase 11 permission split (ops vs admin) carries through exactly — including the hidden-not-disabled rule and role-gating tests. Delete `apps/admin` once parity is verified (the five core ops jobs from Phase 11's done-criteria all work at `/admin` against the seeded stack); update README/docs/CI accordingly. Flag in the summary if any Phase 11 admin test couldn't be ported meaningfully.

### Shared shell
Auth guard per surface; role-aware nav (a user with both roles gets a surface switcher); PWA-lite: manifest + icons so "Add to Home Screen" works respectably (NO service-worker push/offline in v1 — document); error/loading/empty states everywhere; the ₹ util shared; all forms Zod-validated client-side with the same schemas where promotable.

### Tests
- Component (Vitest + RTL): auth flow incl. silent refresh, slot picker, quote approve math rendering, OTP display logic per state, partner quote builder totals, availability editor overlap validation, i18n toggle.
- One **Playwright golden-path spec** (chromium, mobile viewport) against the seeded dev stack: customer books → (provider accepts via API call in the test) → OTP flow → quote → approve → fake-gateway pay → review. Skips gracefully with a message if the stack isn't up (established pattern). This becomes the pilot's smoke test.
- API suite (1000+) stays green; API-side changes limited to `WEB_ORIGIN` CORS + anything genuinely missing that web exposes (flag every such addition in the summary — expectation: near-zero).

### Docs
- `docs/web.md`: architecture (three surfaces, route groups), auth/cookie flow diagram, i18n approach, SEO inventory (every indexed route + target query), Lighthouse result, Vercel deploy config (root dir `apps/web`, env vars, the API-origin CORS note).
- README quickstart gains the third app (`npm run dev` in apps/web on :3000).

---

## Explicitly OUT of scope
Real OTP SMS delivery (DLT — Phase 15 env flip) · push notifications/service worker (Flutter phases; WhatsApp covers partner alerting) · Flutter anything (13/14) · admin on web (exists) · blog/CMS (post-pilot) · customer web chat · maps rendering/Ola Maps tiles (geolocation + landmark text suffice for v1; flag if search UX suffers without a map) · AMC/B2B portal (post-pilot) · A/B testing, analytics beyond a pageview stub behind an env flag.

---

## Done criteria
1. The golden-path Playwright spec green against the seeded stack — end to end, on a mobile viewport.
2. Surface A: all routes SSG/ISR with full SEO inventory; homepage mobile Lighthouse ≥ 85 (score recorded); privacy/terms exist with DPDP substance.
3. Surface B: every booking-lifecycle state renders correctly (walk the seeded bookings across their spectrum); payment survives the closed-browser case.
4. Surface C: a fresh technician can go registration → complete profile → verified (via admin) → accept a job → OTPs → quote → cash — entirely on a phone browser.
5. Admin parity at `/admin`: the five core ops jobs work; ops-vs-admin gating tests green; `apps/admin` deleted; `/admin` noindexed.
6. Refresh token never exposed to page JS (test the cookie flags); no brand strings outside the tokens module; `lint/build/typecheck/test` clean across both apps (api + web); API suite untouched-green.
7. Docs updated (including removing apps/admin references; `docs/web.md` documents the four-surface architecture and single Vercel deploy).

## Final deliverable
`docs/summaries/phase12-summary.md`, standard six-point format. Next phase preview: Phase 13 = Flutter customer app (`apps/mobile`) — same API, native UX, FCM push riding the Phase 10 deep_links, Razorpay Flutter SDK, and the APK that finally fills the `/download` page's customer card.
