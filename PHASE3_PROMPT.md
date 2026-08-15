# PHASE 3 PROMPT — Customers, Providers & Categories

You are building **Phase 3 of 14** of the `fixbridge` marketplace. Phases 1–2 are complete on `main`: scaffold, config/logging/error/i18n core, Prisma 6 + Postgres 16/PostGIS, Redis, and full OTP auth (JWT access + rotating refresh tokens, roles, rate limiting, `authenticate` + `requireRoles`). Read `docs/summaries/phase02-summary.md` before writing code. Follow the established patterns exactly — Zod schemas, AppError with messageKey, pino, i18n keys (hi + en) for every user-facing string.

---

## Carry-over task from Phase 2 review (build first, it's small)

**Instant revocation.** When a user is blocked, stateless JWTs stay valid up to 15 min. Fix: on status change to `blocked`, write `denylist:user:{userId}` to Redis with TTL equal to access-token lifetime. `authenticate` middleware checks the denylist after JWT verification; denylisted → 401 with a distinct i18n key. Ops endpoint to block/unblock comes in Phase 11 — for now expose an internal service function + repository method, and cover with unit + integration tests (blocked user's valid token → 401 immediately).

---

## Context (frozen decisions in force this phase)

- Addresses are **landmark-driven**: text + lat/lng + landmark field ("near Gupta Kirana"). Tier-2 reality.
- PostGIS: Prisma can't natively model geography columns. Use `Unsupported("geography(Point, 4326)")` in the Prisma schema, write the columns + GIST indexes in raw SQL within the migration, and do all geo reads/writes via `$queryRaw`/`$executeRaw` in the repository layer. Keep every raw query in repositories only — services never see SQL.
- GeoService (geocoding) goes behind an interface **now**, with a stub implementation: given text, returns deterministic fake coordinates inside Jabalpur bounds (seeded hash → lat/lng), so dev/test needs no API key. Real Ola Maps adapter comes later behind the same interface.
- Availability templates are the part-time-supply differentiator: "weekdays 18:00–22:00, Sunday full day". Model carefully — Phase 6 generates concrete bookable slots from these.
- Profile completeness **gates listing**: an incomplete technician profile must never appear in search (Phase 5 will rely on this flag).
- Money fields (price cards): integers, paise.
- `city_id` on providers and categories. Jabalpur = 1.
- Multi-role reminder: a user can be both customer and technician. Profiles are separate tables keyed to user_id, not user-type variants.

---

## Phase 3 scope

### 1. Service category tree (`categories` in its own module or under providers — your call, document it)
- `categories`: id, city_id, parent_id (nullable — two levels max: cluster → service), name_key (i18n key, NOT display text), slug, icon (nullable string), sort_order, is_active.
- Launch taxonomy (from concept doc §5.1) as seed data, i18n names in hi + en:
  - **Electrical**: house wiring & repair · inverter/UPS · fan/geyser/motor installation · switchboard & MCB · earthing
  - **Motors & Generators**: motor rewinding · pump & borewell repair · genset servicing · stabilizers
  - **Plumbing**: leakage repair · fittings & fixtures · tank cleaning · RO service
  - **Cooling & Appliances**: AC service & gas refill · fridge · washing machine · microwave
  - **Mechanics**: two-wheeler doorstep service · car battery/jumpstart · cycle repair
- `GET /api/v1/categories` — public, tree-shaped response, locale-aware names, only active, filtered by city (query param, default 1).

### 2. Customer profiles & saved addresses (`customers` module)
- `customer_profiles`: user_id (PK/FK), display_name, email (nullable), created/updated. Created lazily on first profile update (auth already creates the user).
- `addresses`: id, user_id FK, label (`home`/`shop`/`other` + free text), address_text, landmark, city_id, location geography(Point,4326) via raw SQL, is_default, created_at. Max 5 addresses per user (enforced in service).
- Geocoding: on address create/update, if lat/lng not supplied by client (GPS case), call GeoService stub with address_text + landmark. Always store a point.
- Endpoints (authenticated, role customer): get/update own profile; CRUD own addresses; set default. Zod-validate everything; users can only touch their own rows.

### 3. Technician profiles (`providers` module) — the big one
- `provider_profiles`: user_id (PK/FK), display_name, bio (nullable), years_experience, city_id, base_location geography(Point,4326) (raw SQL), service_radius_km (default 5, max 25), is_listed (computed, see completeness), assisted_onboarding (bool — ops entered the data), created/updated.
- `provider_skills`: provider_id + category_id (leaf categories only — reject cluster-level), experience_note (nullable). A provider needs ≥1 skill.
- `provider_price_cards`: id, provider_id, category_id, title (e.g. "Fan installation"), price_type (`fixed` | `starting_from` | `inspection_based`), amount_paise (nullable for inspection_based), is_active. ≥1 active card required for completeness.
- `provider_availability_templates`: id, provider_id, day_of_week (0–6), start_time, end_time (time-of-day, minute granularity), is_active. Multiple windows per day allowed; reject overlapping windows for same day; reject end ≤ start (no overnight windows in v1 — document as limitation). ≥1 active window required for completeness.
- `provider_documents`: id, provider_id, doc_type (`id_proof` | `certificate` | `photo` | `other`), storage_key (string — actual upload is Phase 4), status (`pending`), created_at. Metadata only this phase.
- **Completeness score** (pure function, unit-tested): weighted checklist — display_name, base_location, ≥1 skill, ≥1 active price card, ≥1 availability window, years_experience set, photo doc metadata present. Score 0–100; `is_listed = score >= threshold (config, default 80) AND user.status = active`. Recomputed on every profile-touching write. Expose score + missing-items breakdown in the profile GET (drives the Flutter onboarding checklist in Phase 13).
- Endpoints (authenticated): technician manages own profile/skills/price-cards/availability/documents-metadata. `POST /api/v1/providers/me/register` — a customer-role user requests technician role: adds `technician` role + creates empty profile (self-serve entry; verification gating is Phase 4's job, listing gating is completeness's job).

### 4. Seed data (idempotent, extends existing seed)
- Full category tree (above).
- **20 fake technicians** spread across real Jabalpur localities (use real coords: Wright Town, Napier Town, Adhartal, Vijay Nagar, Madan Mahal, Gorakhpur, Ranjhi, Garha, Civil Lines, Sadar) with varied: skills across all 5 clusters, radii 3–15 km, price cards, availability windows (mix of full-timers "9–19 daily" and part-timers "weekday evenings + Sunday"), years 2–25. 17 complete (listed) + 3 deliberately incomplete (unlisted) — Phase 5 search tests will depend on this distribution.
- Test customer with 2 addresses (one Wright Town, one Adhartal).

### 5. Tests
- Unit: completeness scorer (each missing item), availability overlap rejection, address cap, geo stub determinism, denylist logic.
- Integration/e2e: category tree shape + locale switch (hi/en); customer address CRUD with geocode-on-create; ownership enforcement (user A cannot read/edit user B's addresses — 403/404); technician register flow (role added, profile created); completeness lifecycle (build profile piece by piece → is_listed flips at threshold → remove price card → flips back); blocked-user denylist 401.
- Raw-SQL geo round-trip test: write a point, read it back, values survive.

### 6. Docs
- `docs/API.md` updated with all endpoints.
- Short `docs/geo-notes.md`: how PostGIS columns work with Prisma here (Unsupported type + raw SQL pattern) — future phases will reference it.

---

## Explicitly OUT of scope
Verification pipeline/KYC/badges (Phase 4) · document file upload/MinIO (Phase 4) · search/ranking/geo-queries beyond the round-trip test (Phase 5) · slot generation from templates (Phase 6) · anything payments · admin endpoints for managing other users' profiles (Phase 11) · rating fields on profiles (Phase 9).

---

## Done criteria
1. All Phase 3 + carry-over tests green; `lint/build/typecheck` clean; migrations apply to a fresh DB; seed idempotent (run twice, same counts: 20 providers, 17 listed).
2. Completeness gating demonstrably controls `is_listed`.
3. Ownership isolation proven by tests.
4. Category API returns correct hi/en names by Accept-Language.
5. No display text hardcoded — category names are i18n keys.
6. `docs/API.md` + `docs/geo-notes.md` written.

## Final deliverable
`docs/summaries/phase03-summary.md` in the standard six-point format. Next phase preview: Phase 4 = verification engine — KYC state machine per level (0 identity → 3 references), append-only, manual-first ops review, MinIO document upload with signed URLs, badge computation.
