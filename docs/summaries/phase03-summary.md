# Phase 03 — Customers, Providers & Categories

**Date:** 2026-08-15 · **Phase 3 of 14**

---

## Goal

Give the marketplace its two sides. Customers get profiles and landmark-driven
saved addresses with real PostGIS points. Technicians get profiles with skills,
price cards and weekly availability templates, gated by a completeness score that
decides whether they are visible to search at all. Both sit on a shared service
taxonomy whose names are i18n keys, never stored text.

Plus the Phase 2 carry-over: block a user and their still-valid access token
stops working immediately instead of fifteen minutes later.

---

## What was built

### Carry-over — instant revocation

- `modules/auth/denylist.ts` — `auth:denylist:user:{id}` in Redis with a TTL
  equal to the access-token lifetime, so it expires exactly when the last token
  minted before the block does. Nothing to prune.
- `authenticate` now checks the denylist after verifying the signature and
  returns a distinct `401 AUTH_SESSION_REVOKED` / `errors.auth.sessionRevoked`.
- `blockUser` / `unblockUser` service functions (internal; the ops endpoint is
  Phase 11) do three things together — set `status`, add the denylist entry, and
  revoke every refresh token, so there is no way back in.

### Data model — migration `20260815112721_add_categories_customers_providers`

| Table / type                      | Contents                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `categories`                      | `id`, `city_id`, `parent_id` (nullable), `name_key`, `slug`, `icon`, `sort_order`, `is_active`. Unique `(city_id, slug)`.                                                                        |
| `customer_profiles`               | `user_id` PK/FK, `display_name`, `email`. Created lazily.                                                                                                                                        |
| `addresses`                       | `id`, `user_id`, `label` enum + free text, `address_text`, `landmark`, `city_id`, **`location geography(Point,4326) NOT NULL`**, `is_default`.                                                   |
| `provider_profiles`               | `user_id` PK/FK, `display_name`, `bio`, `years_experience`, `city_id`, **`base_location geography(Point,4326)`**, `service_radius_km`, `completeness_score`, `is_listed`, `assisted_onboarding`. |
| `provider_skills`                 | Composite PK `(provider_id, category_id)`, `experience_note`.                                                                                                                                    |
| `provider_price_cards`            | `price_type` enum, `amount_paise` (integer paise), `is_active`.                                                                                                                                  |
| `provider_availability_templates` | `day_of_week` 0–6, `start_minute`, `end_minute`, `is_active`.                                                                                                                                    |
| `provider_documents`              | `doc_type` enum, `storage_key`, `status` (`pending` only).                                                                                                                                       |

Hand-written additions to the generated migration, all of which Prisma cannot
express and which must survive any regeneration:

- **GIST indexes** on both geography columns — without them Phase 5's
  `ST_DWithin` is a sequential scan.
- A **partial index** on `(city_id) WHERE is_listed` — exactly what search filters on.
- A **partial unique index** on `(user_id) WHERE is_default` — one default
  address per user, enforced by the database rather than by hoping the service
  clears the old one first.
- **CHECK constraints**: weekday 0–6, minutes in range, `end_minute > start_minute`
  (the no-overnight-windows rule), service radius 1–25 km, completeness 0–100,
  non-negative paise, and `amount_paise` present for exactly the price types that
  carry one.
- A **trigger** enforcing the two-level taxonomy. A CHECK cannot do it — it
  cannot contain a subquery — so `categories_enforce_two_levels()` refuses any
  parent that itself has a parent.

### Categories module

Its own module rather than living under providers: it is read by providers today
and by search, bookings and the admin console later, so it is not owned by any
one of them.

`GET /api/v1/categories?cityId=1` — public, tree-shaped, active only. Names
resolve through i18n, and `nameKey` is returned alongside so a client can
re-localise offline. Orphaned children (an active service under a deactivated
cluster) are **dropped, not promoted** — switching off a cluster must hide
everything beneath it.

`requireLeafCategory` is the shared guard that stops a technician attaching
themselves to "Electrical" instead of "Motor rewinding".

### Customers module

Profile (lazily created) and addresses, all `/me`-scoped. Highlights:

- **Geocoding on write.** If the client sends `lat`/`lng`, they are used; if not,
  the address text and landmark go to the `GeoService`. Every address ends up
  with a point — there is no "address without coordinates" state for later code
  to handle. `PATCH` re-geocodes when the text changes and no fresh coordinates
  arrive, so the pin cannot drift away from the words.
- **Ownership in the WHERE clause.** Every address query filters on `user_id` as
  well as `id`, so another user's address returns `404` — never found and then
  refused, because confirming it exists is already a leak.
- Five-address cap, first-address-is-default, and delete-the-default promotes the
  oldest survivor.

### Providers module

The big one. `POST /me/register` grants the `technician` role and opens an empty
profile; everything else manages skills, price cards, availability and document
metadata. Every mutating endpoint returns the whole rescored profile, so a client
never has to re-fetch to learn whether it just went live.

**Completeness** (`completeness.ts`, pure and exhaustively unit-tested):

| Item                       | Weight |
| -------------------------- | ------ |
| `baseLocation`             | 21     |
| `skills` (≥1)              | 21     |
| `priceCard` (≥1 active)    | 21     |
| `availability` (≥1 active) | 21     |
| `displayName`              | 10     |
| `yearsExperience`          | 3      |
| `photoDocument`            | 3      |

`is_listed = score >= threshold (default 80) AND user is active`, recomputed
centrally after every write that could change the answer.

**Availability** (`availability.ts`, pure): minutes-from-midnight, half-open
intervals so back-to-back shifts are legal, overlap detection per day.

### Geo

`core/geo.ts` — the `GeoService` interface plus a deterministic stub that hashes
address text into a point inside the Jabalpur bounding box. Same input, same
point, forever: tests can assert exact coordinates and a re-run of the seed
produces the same map. A real Ola Maps adapter drops in behind the interface
without touching a caller.

### Seed

- 25 categories (5 clusters, 20 services).
- **20 technicians** across ten real Jabalpur localities: skills spanning all five
  clusters, radii 3–15 km, 2–25 years, and a genuine mix of full-timers
  (Mon–Sat 09:00–19:00), part-timers (weekday evenings + Sunday), split shifts
  and weekend-only.
- **17 listed, 3 unlisted** — and the three fail for _different_ reasons (no
  availability, no price card, no base location), so Phase 5 can test the gate
  from three angles rather than one.
- Test customer `+919999900050` with addresses in Wright Town and Adhartal.

Idempotent via deterministic UUIDs derived from a hash, so reruns update rows in
place instead of deleting and recreating with new primary keys.

### Docs

`docs/geo-notes.md` — the PostGIS-with-Prisma pattern, the `(lng, lat)` argument
order that silently puts points in the wrong country, the casts that matter, and
what Phase 5 will need. `docs/API.md` updated with every endpoint.

---

## Key decisions & deviations

### Versions

No new dependencies. Node v20.12.2, Prisma 6.19.3, TypeScript 5.9.3, Express
4.22.2, Zod 4.4.3, Vitest 3.2.7 — all unchanged from Phase 2.

### Decisions

1. **Categories is its own module.** The prompt left it open. It is a shared
   reference table read by providers, search, bookings and admin; nesting it
   under providers would make three later modules import from a fourth's
   internals.
2. **Availability stored as minutes from midnight, not Postgres `time`.** They
   compare and add with integer arithmetic, carry no timezone semantics, and
   Prisma maps them to `number` rather than an epoch-dated `Date`. Phase 6 will
   be doing arithmetic on these to generate slots. The wire format stays
   human-readable `"HH:MM"`.
3. **Half-open intervals for overlap.** `09:00–13:00` and `13:00–17:00` are
   adjacent, not overlapping — a split shift is a normal thing to enter.
4. **Roles as a join table pays off already.** `POST /me/register` adds
   `technician` to a user who is already a `customer`, exactly as the multi-role
   requirement demands.
5. **Two-level taxonomy enforced by trigger.** The alternative was trusting
   application code; a database that permits a three-level tree will eventually
   contain one.
6. **`addresses.location` is NOT NULL, `provider_profiles.base_location` is
   nullable.** An address without a point is meaningless, so the whole INSERT is
   raw SQL. A technician's location is a completeness item they fill in later,
   so Prisma creates the row and a raw UPDATE sets the point.
7. **The denylist fails open.** If Redis is unreachable, `authenticate` allows
   the request and logs at `error` level. Failing closed would turn a Redis blip
   into a total authentication outage; failing open degrades to exactly the
   pre-Phase-3 behaviour. Alertable, not silent.
8. **Blocking also revokes refresh tokens.** Not asked for, but a block that
   leaves the user able to mint a fresh token pair is not a block.
9. **`register` accepts an optional `displayName`.** The prompt says "creates
   empty profile"; allowing a name in the same call saves a round trip and costs
   nothing.

### The completeness-weighting tension — worth reading

The prompt specifies `is_listed = score >= threshold` with a default threshold of
80, and lists seven checklist items. Those two facts constrain each other more
than they look:

With weights summing to 100 and a threshold of 80, **an item only gates listing
if it weighs 21 or more**. Missing a 20-point item leaves 80, which still
passes. And four items at 21 already consume 84 of the 100 points — so **at most
four of the seven can individually delist a profile.**

I gave those four to the items that make a technician _bookable_: location,
skills, price card, availability. Missing any one scores 79 and delists.

**The consequence, stated plainly:** `displayName` is weighted 10, so a profile
missing only a display name scores 90 and **is listed**. A nameless technician
could appear in search. There is a test asserting exactly this so the behaviour
is deliberate and visible rather than a lurking surprise.

Two ways to close it, both one-line, both your call:

- raise `PROVIDER_LISTING_THRESHOLD` to `91`, which makes `displayName` gate too
  (and also makes `yearsExperience` and `photoDocument` nearly mandatory); or
- make `displayName` a hard precondition alongside the score, departing from the
  prompt's formula.

I did neither, because both change behaviour the prompt specified. Flag which you
want and it is a small change.

---

## Assumptions & missing inputs

**Needed from Ankit:**

1. **The `displayName` gap above** — raise the threshold, add a hard gate, or
   accept it?
2. **How does someone become a technician in production?** Today `POST
/me/register` is fully self-serve: any signed-in user can grant themselves the
   role. That is right for a supply-hungry launch and wrong if you want ops to
   screen people first. Phase 4 verification gates _trust_, and completeness
   gates _listing_, but nothing gates _entry_.
3. **`assistedOnboarding` has no way to be set.** The column exists and defaults
   to `false`, but the only writer would be an ops endpoint, which is Phase 11.
   If field agents will be onboarding technicians before then, that endpoint is
   needed sooner.
4. **The Jabalpur locality coordinates are approximate**, good to a few hundred
   metres. Fine for development and for relative-distance tests; if Phase 5's
   ranking is to be judged against reality, real surveyed coordinates would help.
5. **Hindi copy is still mine**, now including all 25 category names. These are
   the strings a technician in Jabalpur reads first — worth a native review
   before any field test.
6. **The rate-limit changes I proposed after Phase 2 are still not applied**
   (`OTP_MAX_PER_IP` 5 → 30 for CGNAT, per-phone 3 → 5, 60-second resend
   cooldown). Unchanged and still recommended.

**Assumed:**

- Two levels of taxonomy is enough. A third would need the trigger relaxed and
  the tree builder generalised.
- One profile per user per side; no notion of a firm with several technicians.
- `price_cards` are per category, and a technician may have several for the same
  category (e.g. "Split AC service" and "Gas refill").
- Documents are metadata only; nothing validates that `storage_key` points at
  anything, because nothing uploads yet.

---

## Verification results

Windows 11, Node v20.12.2, Docker 28.0.4.

| Check                                 | Result                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`                        | Clean                                                                                                                                      |
| `npm run format:check`                | Clean                                                                                                                                      |
| `npm run typecheck` / `npm run build` | Clean                                                                                                                                      |
| `npm test`                            | **294 passed** (18 files) — 208 unit + 86 integration                                                                                      |
| Stability                             | Suite run **3× consecutively**, 294/294 each time                                                                                          |
| Fresh DB migration                    | All 4 migrations apply to a virgin database                                                                                                |
| `npm run seed` × 2                    | Identical counts both runs: 25 categories, 20 providers (**17 listed**, 3 unlisted), 32 price cards, 125 availability windows, 2 addresses |
| Geography round-trip                  | `ST_Y`/`ST_X` return exactly what was written, to 6 dp                                                                                     |

### Done criteria

| Criterion                                   | Where it is proven                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Tests green, migrations, idempotent seed | Above; seed counts identical across two runs                                                                                                                                                                                                            |
| 2. Completeness controls `is_listed`        | `flips is_listed as the profile is built up and torn back down` — builds a profile piece by piece, asserts it goes live only at the last booking-critical item, deletes the price card, asserts it delists, and checks the **database** value each time |
| 3. Ownership isolation                      | User B gets `404` on GET/PATCH/DELETE/set-default of user A's address, sees an empty list, and A's row is verified untouched afterwards                                                                                                                 |
| 4. Category hi/en by Accept-Language        | Asserts `बिजली का काम` vs `Electrical` from the same rows                                                                                                                                                                                               |
| 5. No hardcoded display text                | Categories store `name_key`; a test asserts `nameKey` starts with `categories.` and differs from the rendered name                                                                                                                                      |
| 6. Docs                                     | `docs/API.md` + `docs/geo-notes.md`                                                                                                                                                                                                                     |

### Two things the tests caught

**A cross-file test race.** The new Phase 3 suite reset Redis with a wildcard
`del auth:otp:*`, which wiped rate-limit counters the auth suite was mid-way
through asserting — vitest runs files in parallel. One run failed, the next
passed. Fixed by scoping each file's cleanup to its own keys, lifting the per-IP
cap out of the way in the test environment (every supertest request comes from
127.0.0.1), and adding `core/rate-limit.integration.test.ts` to exercise the
limiter — including the Lua script under concurrent hits — against real Redis
with its own keys. Then run three times to confirm.

**The config schema caught me.** Setting `OTP_MAX_PER_IP=1000000` in the test env
made every integration test skip: the schema caps it at 1000. Exactly the failure
mode the Phase 1 config loader was built for, this time pointed at its author.

### Working curl examples

```bash
# Category tree, English
$ curl 'http://localhost:3000/api/v1/categories?cityId=1' -H 'Accept-Language: en'
{"cityId":1,"categories":[{"id":1,"slug":"electrical","name":"Electrical",
 "nameKey":"categories.electrical","icon":"bolt","sortOrder":1,
 "children":[{"id":6,"slug":"house-wiring","name":"House wiring & repair",…}]}]}

# …and the same rows in Hindi
$ curl 'http://localhost:3000/api/v1/categories'
# → "name":"बिजली का काम", "name":"घर की वायरिंग और मरम्मत"

# Save an address with no coordinates — it gets geocoded
$ curl -X POST http://localhost:3000/api/v1/customers/me/addresses \
    -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
    -d '{"label":"home","addressText":"212 Shastri Nagar, Wright Town",
         "landmark":"Behind Gupta Kirana"}'
# → 201, "location":{"lat":23.201434,"lng":79.913882}, "isDefault":true

# Become a technician (then sign in again — roles live in the token)
$ curl -X POST http://localhost:3000/api/v1/providers/me/register \
    -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
    -d '{"displayName":"Ramesh Vishwakarma"}'
# → 201, completeness.score 10, isListed false

# Overlapping hours are refused, and told what they clashed with
$ curl -X POST http://localhost:3000/api/v1/providers/me/availability \
    -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
    -d '{"dayOfWeek":3,"startTime":"12:00","endTime":"17:00"}'
{"error":{"code":"AVAILABILITY_OVERLAP",…,
 "details":{"conflictsWith":{"dayOfWeek":3,"startTime":"09:00","endTime":"13:00"}}}}

# A cluster cannot be a skill
$ curl -X POST http://localhost:3000/api/v1/providers/me/skills \
    -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
    -d '{"categoryId":1}'
# → 400 CATEGORY_NOT_A_SERVICE
```

```sql
-- The geography round-trip, straight from Postgres
SELECT display_name, ST_Y(base_location::geometry) AS lat,
       ST_X(base_location::geometry) AS lng, completeness_score, is_listed
FROM provider_profiles ORDER BY completeness_score LIMIT 4;

 Bharat Singh Thakur |         |         |  79 | f   -- no base location
 Manoj Ahirwar       | 23.1694 | 79.9407 |  79 | f   -- no price card
 Suresh Bind         | 23.1421 | 79.9043 |  79 | f   -- no availability
 Anil Barman         | 23.2172 | 79.9081 | 100 | t
```

### Not verified

- **CI going green** — still no git remote, so the workflow has never run. All
  its steps pass locally.
- **Graceful shutdown under a real signal** — unchanged; Windows cannot deliver a
  meaningful `SIGTERM`.
- **Geocoding quality** — the stub is deterministic, not accurate. Nothing here
  tests real geocoding, because there is no real geocoder yet.

---

## Next steps — Phase 4 (verification engine)

**Ready to build on:**

- `provider_documents` already holds `doc_type`, `storage_key` and a `status`
  enum with a single `pending` value — Phase 4 extends that enum with the
  reviewed states rather than creating a table.
- `is_listed` is trustworthy and recomputed centrally, so badge logic can sit
  beside completeness without either fighting the other.
- The `blockUser` path (status + denylist + refresh revocation) is the model for
  whatever "verification failed, suspend them" does.
- `assistedOnboarding` exists for the ops-entered case the KYC flow will meet.

**Phase 4 will need to decide:**

- Where the verification state machine lives — its own `verification` module (the
  stub is mounted and empty) versus columns on `provider_profiles`. Append-only
  suggests its own table.
- Whether a badge affects `is_listed` or is purely a ranking signal in Phase 5.
  Today completeness alone gates listing, and keeping those two concerns separate
  has kept both simple.
- MinIO bucket layout and signed-URL lifetime; `storage_key` is a free string
  today, so nothing constrains the naming yet.

**Carried forward, still deliberately not built:** the transactional outbox and
dispatcher, object storage, Razorpay/UPI, WhatsApp messaging adapters, OpenAPI
generation, session-listing endpoints, account deletion (DPDP, Phase 14),
admin endpoints for managing other users' profiles, rating fields on profiles,
and any geo query beyond the round-trip test.
