# PHASE 5 PROMPT — Search & Matching

You are building **Phase 5 of 14** of the `fixbridge` marketplace. Phases 1–4 are on `main`: core infra, auth, categories/customers/providers with completeness-gated listing, and the append-only verification engine with badges. Read `docs/summaries/phase04-summary.md`, `docs/geo-notes.md`, and `docs/verification.md` first. Follow all established patterns. Remember the geo-notes hazard: `prisma migrate diff` will try to drop GIST indexes on Unsupported columns — guard every new migration.

---

## Carry-over task from Phase 4 review (small, do first)

**Inert document downloads.** Signed GET URLs for KYC documents must force `Content-Disposition: attachment; filename="..."` and pin `response-content-type` to the stored content type, so a malicious HTML/SVG uploaded as a "certificate" downloads inert instead of rendering in an ops browser. Add a test asserting the signed URL carries these response-header overrides. (Full virus scanning remains Phase 14.)

---

## Context (frozen decisions in force)

- **Search surfaces only trustworthy supply:** a provider appears iff `is_listed = true` (completeness hard gates) **AND** `badge = VERIFIED` (or better) **AND** `user.status = active`. No exceptions, no config to bypass. The 17/12/3/2 seed distribution from Phases 3–4 exists to test exactly this.
- **Radius is the provider's, not the platform's.** Each provider declared `service_radius_km`. A provider matches when the customer's point is within *that provider's own* radius of their base_location: `ST_DWithin(base_location, customer_point, service_radius_km * 1000)`. Geography type = meters. GIST indexes already exist.
- **Availability filtering uses templates, not slots.** Concrete slot rows arrive in Phase 6. This phase, "available for the requested window" means: the provider has an active availability template on that day-of-week whose window fully covers the requested time window. Document plainly in code + docs: Phase 6 will additionally subtract already-booked slots.
- **Ranking is a pluggable pure function.** Inputs it will *eventually* consume: distance, trust score, acceptance rate, price band. Trust score (Phase 9) and acceptance rate (Phase 6) don't exist yet — define the scorer input type with all fields now; supply neutral defaults (documented) for missing ones. Available real signals today: distance, badge tier, years_experience, completeness score. Weights come from config (env or a config table — your call, document it). Changing weights must require zero changes outside config + scorer tests.
- All user-facing strings via i18n keys. Money in paise. City-scoped (city_id param, default 1).

---

## Phase 5 scope

### 1. Geo-search endpoint (the main event)
`GET /api/v1/search/providers` — public (no auth), rate-limited (reuse the Redis limiter, e.g. 30/min/IP), city-scoped.

Query params (Zod-validated):
- `lat`, `lng` (required — customer location; client sends GPS or a saved address's point)
- `category_id` (optional — leaf category filters by provider_skills; cluster category includes all leaf children)
- `date` + `start_time` + `end_time` (optional trio — availability window filter as defined above)
- `max_distance_km` (optional customer-side cap, ≤ 25, applied *in addition to* provider radius)
- `sort` (`rank` default | `distance` | `price_low`), `page`/`page_size` (default 10, max 25)

Response per result card (shaped for the Phase 12 Flutter result card): provider id, display_name, badge, years_experience, distance_km (rounded 0.1), skills (localized names), starting price for the requested category (lowest active price card, paise + display), next matching availability window, base locality text. **Never expose:** exact base_location coordinates (privacy — distance only), phone, completeness internals.

Implementation notes:
- One raw SQL query in the repository doing: ST_DWithin filter + joins for badge/listing/skill + distance computation via `ST_Distance` — then ranking + pagination in SQL or service layer (your call, document the trade-off you chose). Avoid N+1s; the whole search must be ≤ 3 queries.
- EXPLAIN-verify the GIST index is used; note the plan in the phase summary.

### 2. Ranking scorer
- `RankScorer` interface: `score(input) → number` where input = `{ distanceKm, providerRadiusKm, badge, yearsExperience, completenessScore, trustScore: number|null, acceptanceRate: number|null, priceBandPosition: number|null }`.
- Default implementation: weighted sum, weights from config, normalized inputs (distance decays — nearer is better; document each normalization). Null inputs → documented neutral constants.
- Unit tests with hand-computed fixtures: closer beats farther at equal badge; VERIFIED beats (hypothetical) NONE; weight changes reorder results as expected; neutral defaults keep ordering stable.

### 3. Text search + Hinglish synonyms
- `hinglish_synonyms` table: id, term (normalized: lowercased, trimmed), category_id FK, weight (default 1), is_active. Seed a genuinely useful set covering all 5 clusters, BOTH scripts, e.g.: "motor jal gayi"/"मोटर जल गई" → motor rewinding · "bijli"/"बिजली"/"current nahi hai" → electrical cluster · "nal tapak raha"/"leakage"/"नल" → leakage repair · "AC thanda nahi"/"गैस भरना" → AC service & gas refill · "geyser"/"गीजर" → fan/geyser/motor installation · "pankha" / "पंखा" → same · "bike kharab" → two-wheeler doorstep · "paani ki tanki" → tank cleaning · "इन्वर्टर"/"inverter battery" → inverter/UPS · at least 40 rows total.
- `GET /api/v1/search/resolve?q=` — resolves free text to category suggestions: exact/prefix synonym match first, then trigram similarity (`pg_trgm`, threshold documented) against synonyms + localized category names, then Postgres FTS as fallback. Returns ranked category suggestions (id, localized name, match_reason). The Flutter app will call this as the user types, then fire the geo-search with the chosen category_id.
- Normalization util shared by seed + query path (same lowercasing/trim rules — mismatch here is the classic bug, test it with mixed-case Devanagari+Latin input).

### 4. Category browse support
- Extend `GET /api/v1/categories` with `provider_count` per leaf (count of searchable providers in the city — listed+verified), so the app can grey out empty categories. Cache in Redis, 5-min TTL, invalidation not required this phase (document staleness as accepted).

### 5. Seed additions
- The ~40 synonym rows.
- Ensure seeded provider availability windows are deterministic (fixed, not random) so window-filter tests can assert exact results. Adjust Phase 3 seed if it used randomness — idempotency must hold.

### 6. Tests
- Geo correctness: customer point in Wright Town returns the nearby seeded providers, excludes Ranjhi provider whose 3km radius can't reach; distance ordering verified against hand-computed haversine values (±tolerance).
- Gate enforcement: the 3 unlisted and the 5 non-VERIFIED seeded providers NEVER appear, across every param combination; blocked user excluded.
- Provider-radius vs customer-cap interplay: provider with 15km radius at 10km distance appears without cap, disappears with `max_distance_km=5`.
- Availability filter: Tuesday-19:00–20:00 request matches "weekday evening" part-timers, excludes Sunday-only; window partially covered (template 18–20, request 19–21) → excluded.
- Synonyms: "motor jal gayi", "मोटर जल गई", "MOTOR JAL GAYI" all resolve to motor rewinding; misspelling "moter jal gai" resolves via trigram; nonsense string returns empty suggestions gracefully.
- Ranking determinism: same seed + same query → same order, three runs.
- Rate limit on public endpoint: 429 past threshold.
- Carry-over: signed URL response-header override test.

### 7. Docs
- `docs/API.md` updated. New `docs/search.md`: query anatomy, ranking formula + weights, synonym pipeline, the "templates now, slots in Phase 6" clarification, EXPLAIN snapshot.

---

## Explicitly OUT of scope
Slot generation & booked-slot subtraction (Phase 6) · trust score & acceptance rate real values (Phases 9/6 — neutral defaults only) · OpenSearch (never in year 1) · search analytics/logging of queries (Phase 14 funnel work) · personalization/"rebook your technician" (Phase 12 uses booking history, not search) · caching search results (only the category counts are cached) · ML anything.

---

## Done criteria
1. Carry-over done. All Phase 5 tests green; suite stable across 3 runs; `lint/build/typecheck` clean; fresh-DB migrations with GIST indexes intact; seed idempotent.
2. Gate enforcement proven exhaustively (the marketplace's trust promise lives here).
3. EXPLAIN shows index usage; noted in summary.
4. Hinglish resolve works across scripts, cases, and misspellings.
5. Scorer weights changeable via config alone; proven by test.
6. Docs updated.

## Final deliverable
`docs/summaries/phase05-summary.md`, standard six-point format. Next phase preview: Phase 6 = booking & slots — the heart: slot generation from templates, full booking state machine (REQUESTED → … → REVIEWED) with append-only events, Redis lock + tstzrange exclusion constraint against double-booking, OTP start/end handshake, and the transactional outbox that Phases 9–10 will subscribe to.
