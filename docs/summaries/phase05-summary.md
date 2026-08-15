# Phase 05 — Search & Matching

**Date:** 2026-08-15 · **Phase 5 of 14**

---

## Goal

Turn four phases of supply-side machinery into something a customer can actually
use: a public geo-search that surfaces only trustworthy technicians, ranked by a
pure scorer whose weights live entirely in config, reachable by typing
"motor jal gayi" in either script on a cracked phone screen.

Plus the Phase 4 carry-over: make KYC document downloads inert.

---

## What was built

### Carry-over — inert document downloads

Signed GET URLs now pin `Content-Disposition: attachment; filename="…"` and
`response-content-type` to the content type recorded at upload. A "certificate"
that is really an HTML or SVG file with a script in it now downloads instead of
rendering in an ops reviewer's logged-in browser — which would have been a stored
XSS delivered through the KYC queue.

The overrides are S3 response-header parameters signed **into** the URL, so a
caller cannot strip them without invalidating the signature. Three tests: the URL
carries both parameters, the ops case view carries them on every document, and a
real fetch against MinIO comes back with `Content-Disposition: attachment`.

### Geo-search — `GET /api/v1/search/providers`

Public, unauthenticated, 30 req/min/IP. City-scoped.

The three gates are enforced in SQL with no way to relax them:

```sql
pp.is_listed = true                              -- completeness (Phase 3)
AND u.status = 'active'
AND pvs.badge IN ('VERIFIED', 'SILVER', 'GOLD')  -- verification (Phase 4)
```

**One query.** Skills, cheapest matching price, next availability window and the
total match count are correlated subqueries in the same statement rather than
follow-ups — an N+1 on a public endpoint is not something to leave lying around.

- **Radius is the provider's own**: `ST_DWithin(base_location, point,
service_radius_km * 1000)`. `max_distance_km` narrows further, never widens.
- **A cluster `category_id` includes every service beneath it**, inline in SQL,
  so no extra round trip.
- **Availability matches templates that fully cover** the requested window.
  Partial overlap is not availability.
- Result cards carry distance rounded to 0.1 km and **never** the provider's
  coordinates, phone, or completeness internals.

### Ranking — `modules/search/ranking.ts`

A pure `RankScorer`. Every signal normalised to 0..1, weighted, divided by ΣW.

| Signal                 | Normalisation                                | Weight |
| ---------------------- | -------------------------------------------- | ------ |
| distance               | `0.5 ^ (km / halfLife)`                      | 50     |
| badge                  | NONE 0 · VERIFIED 0.7 · SILVER 0.85 · GOLD 1 | 15     |
| experience             | `min(1, years / 15)`                         | 10     |
| trust _(Phase 9)_      | neutral 0.5                                  | 10     |
| completeness           | `score / 100`                                | 5      |
| acceptance _(Phase 6)_ | neutral 0.5                                  | 5      |
| price                  | **inverted**, relative to the result set     | 5      |

Exponential distance decay rather than linear: the gap between 1 km and 3 km
matters far more to someone with a burst pipe than the gap between 18 km and
20 km, and linear scoring treats those as equal.

### Hinglish text resolution — `GET /api/v1/search/resolve`

Three escalating passes, each only filling gaps left by the last: exact synonym →
prefix/trigram → category slug. Trigram threshold 0.3, backed by a GIN index.

`normalizeSearchTerm` is called by **both** the seed and the query path. That
being one function is the point: store `"Motor Jal Gayi"`, look up
`"motor jal gayi"`, and nothing ever matches while the symptom reads as
"synonyms are broken".

**112 seeded terms across 22 categories**, both scripts, covering all five
clusters.

### Category browse counts

`GET /api/v1/categories` gains `providerCount` per category, applying the same
three gates so a category showing "3 available" cannot return zero. Clusters sum
their services. Cached 5 minutes, no invalidation — documented as accepted.

### Migration `20260815170000_add_hinglish_synonyms`

`hinglish_synonyms` plus hand-written additions: GIN trigram indexes on
`hinglish_synonyms.term` and `categories.slug`, covering indexes for the skill,
availability and badge joins, and a `weight > 0` CHECK.

---

## Key decisions & deviations

### Versions

No new dependencies. Node v20.12.2, Prisma 6.19.3, TypeScript 5.9.3, Express
4.22.2, Zod 4.4.3, Vitest 3.2.7 — all unchanged.

### Decisions

1. **Ranking runs in TypeScript, not SQL — the trade-off the prompt asked me to
   pick.** The scorer has to be pure, unit-testable and config-driven; a `CASE`
   expression inside an `ORDER BY` is none of those. The cost is a bounded
   candidate set (`SEARCH_MAX_CANDIDATES`, default 200): beyond it, matches are
   counted in `total` but not ranked, and the response sets `truncated: true`.
   `sort=distance` and `sort=price_low` order in SQL first, so the cap takes the
   nearest or cheapest rather than an arbitrary 200. At pilot scale a dense
   radius returns tens of providers; the flag exists so that if this is ever
   wrong, it is discovered rather than silent.
2. **Weights are env config, not a database table.** A table would let ops retune
   without a deploy, which is genuinely attractive — but it adds a read to every
   search, a cache to invalidate, and an admin surface that belongs to Phase 11.
   Env vars are one restart away and testable today. Revisit when someone
   actually wants to tune it hourly.
3. **Neutral defaults are the midpoint (0.5), not 0 or 1.** Zero would push
   everyone down equally, making the weight meaningless; one would make everyone
   look perfect until real data arrived and then drop every score at once. The
   midpoint means Phase 6 and Phase 9 can start supplying real values for _some_
   providers without reshuffling everyone else.
4. **Every comparator ends in the provider id.** Two providers with identical
   scores would otherwise swap places between requests, and a customer notices
   that immediately.
5. **`locality` is a distance band, not a place name.** Phase 3 stores a point
   and no locality text. Reverse-geocoding it would be inventing precision we do
   not have, so the card says "nearby" / "within 5 km". A real locality field can
   arrive with a real geocoder.
6. **Coordinates are never returned.** The endpoint is unauthenticated; returning
   exact points would let anyone map where every technician in the city lives.
   Distance to 0.1 km is enough to choose by and too coarse to triangulate. A
   test asserts `lat`, `lng`, `baseLocation`, `phone` and `completenessScore`
   appear nowhere in the body.
7. **The whole search is one query**, not the three the prompt allowed.

### The GIST hazard bit again — as documented

`prisma migrate diff` proposed dropping both PostGIS GIST indexes for the second
phase running. It cannot see indexes on `Unsupported` columns and reads them as
drift every time. Removed from the migration, with a banner at the top of the
file. A fresh-database run confirms all four spatial and trigram indexes survive.

This is now a standing hazard for every future migration, and it is called out in
`geo-notes.md`, `search.md` and both phase summaries.

### Two things the tests caught

**A bad test of my own.** My NFC normalisation test compared `की` and `कि`,
asserting they normalise equal. They do not — those are genuinely different
vowel signs, not decomposed forms of each other. The test was wrong, not the
code. Replaced with a real decomposable pair: `क़` as one code point (U+0958)
versus `क` + nukta (U+0915 U+093C), which render identically, compare unequal as
raw strings, and must fold together. That is the case that would actually break a
Devanagari synonym lookup.

**Category counts had to be evicted between tests.** The 5-minute cache made
assertions order-dependent — a count computed before a test blocked a provider
would still be served after. The suite now clears the cache key in `beforeEach`,
which is also an honest demonstration of the staleness that was accepted.

**A cross-file race, fixed at the root this time.** The search suite passed alone
and failed in the full run: its gate tests block a seeded user and unlist a
seeded profile (restoring both afterwards), while the Phase 3 and Phase 4 suites
assert _exact_ counts over the same rows. Run in parallel, those race.

This is the second time shared fixtures have bitten — Phase 3 hit the same class
of bug over Redis keys, and was patched by scoping keys per file. Patching again
would have been treating the symptom: every integration suite shares one
Postgres, one Redis and one seeded dataset, and parallel access to a shared
mutable fixture is a race by construction.

So `fileParallelism: false` now, with the reasoning in `vitest.config.mts`. The
suite goes from ~10s to ~20s and an entire category of flakiness disappears. The
right escalation, if that ever hurts, is a database per worker — not re-enabling
parallel access to one.

---

## Assumptions & missing inputs

**Needed from Ankit:**

1. **Should availability filtering be the default?** Today it is opt-in: omit the
   date trio and you get everyone in range. A customer who wants someone _this
   evening_ has to know to ask. Phase 6 has the data to make "available soon" a
   default sort, and that is a product call.
2. **The distance half-life (5 km) is a guess.** It is the single most
   consequential ranking number — it decides whether a customer sees the nearest
   technician or the best one 6 km away. Worth tuning against real behaviour once
   there are bookings to learn from.
3. **`locality` is a band, not a place name** (decision 5). If the result card
   should say "Wright Town", that needs either a locality field on the profile or
   a real reverse geocoder.
4. **Synonyms will need ops curation.** 112 terms is a strong start, and every
   one of them is my guess at how a customer in Jabalpur phrases a problem. The
   fastest improvement here is logging what people type that resolves to nothing
   — which is Phase 14 analytics work, but the payoff is immediate.
5. **Hindi copy is still mine**, including all 112 synonym phrases.
6. **Git remote** — still none, so CI has never run.

**Assumed:**

- One city. `city_id` is threaded everywhere, but nothing tests cross-city
  isolation because there is only Jabalpur.
- A customer searches from one point. No "search near my office and my home".
- Price comparison uses the lowest active price card for the requested category.
  A provider with no price sorts last under `price_low` and takes the neutral
  default under `rank`.
- 200 candidates is enough headroom (decision 1).

---

## Verification results

Windows 11, Node v20.12.2, Docker 28.0.4.

| Check                                                   | Result                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm run lint` / `format:check` / `typecheck` / `build` | Clean                                                              |
| `npm test`                                              | **516 passed** (26 files)                                          |
| Stability                                               | Suite run **3×**, 516/516 each time                                |
| Fresh DB (`down -v` → `up -d` → `migrate:deploy`)       | All **6** migrations apply to a virgin database                    |
| Spatial + trigram indexes after fresh migrate           | All **4** present                                                  |
| `npm run seed` × 2                                      | Identical: 112 synonyms, 12 VERIFIED, 3 in progress, 2 not started |

### Done criteria

| Criterion                                       | Where it is proven                                                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Carry-over + green suite                     | Three inert-download tests; 516 tests over 3 runs                                                                                                                                      |
| 2. Gate enforcement                             | Returns exactly the 12 verified; the other 8 are checked against **8 different parameter combinations**; blocking a user or unlisting a profile drops them mid-test and restores after |
| 3. EXPLAIN shows index usage                    | Below                                                                                                                                                                                  |
| 4. Hinglish across scripts, cases, misspellings | `motor jal gayi` / `मोटर जल गई` / `MOTOR JAL GAYI` all exact-match; `moter jal gai` resolves fuzzily at ≈0.45; nonsense returns `[]` with 200                                          |
| 5. Weights changeable by config alone           | A price-only weighting flips a distance-driven ordering with no code change                                                                                                            |
| 6. Docs                                         | `docs/API.md` + `docs/search.md`                                                                                                                                                       |

### EXPLAIN

At seed scale the planner chooses sequential scans — and it is right to:

```
Nested Loop
  ->  Hash Join  (Hash Cond: u.id = pvs.provider_id)
        ->  Seq Scan on users u          Filter: status = 'active'
        ->  Hash -> Seq Scan on provider_verification_summaries pvs
  ->  Index Scan using provider_profiles_pkey on provider_profiles pp
        Filter: is_listed AND city_id = 1 AND st_dwithin(base_location, …)
```

20 providers and 23 users: reading a page beats descending an index. A plan that
used GIST here would mean the statistics were wrong.

Forcing the planner's hand proves the index is usable, which is what matters at
real volume:

```
SET enable_seqscan = off;

Index Scan using provider_profiles_base_location_gist_idx on provider_profiles
  Index Cond: base_location && _st_expand('…'::geography, '8000'::double precision)
  Filter: st_dwithin(base_location, '…'::geography, '8000', true)
```

`&&` is bounding-box overlap — GIST narrows, `ST_DWithin` filters exactly. A test
asserts this plan, so losing the index fails the build rather than quietly
degrading production.

### Geo correctness

The radius test does not trust the query it is testing. It reads every provider's
stored point and radius, recomputes membership with an independent haversine, and
asserts the API agrees — skipping anyone within 500 m of their own boundary,
because haversine is a sphere and PostGIS is a spheroid. It also asserts it
checked at least 7 providers, so it cannot pass vacuously.

Concretely, searching from Vijay Nagar:

- **Golu Rajak** (Sadar, 3 km radius, ~4.8 km away) is correctly absent.
- **Imran Ansari** (Adhartal, 15 km radius, ~2.3 km away) is present.
- With `max_distance_km=5`, every provider beyond 5 km disappears.

### Working curl examples

```bash
# Nearby technicians, ranked
$ curl 'http://localhost:3000/api/v1/search/providers?lat=23.1618&lng=79.9492&page_size=2' \
    -H 'Accept-Language: en'
{"results":[{"providerId":"195e4019-…","displayName":"Ramesh Vishwakarma",
  "badge":"VERIFIED","yearsExperience":18,"distanceKm":0,
  "skills":[{"slug":"house-wiring","name":"House wiring & repair"},…],
  "startingPrice":{"amountPaise":18000,"display":"₹180"},
  "nextAvailability":{"dayOfWeek":1,"startTime":"09:00","endTime":"19:00"},
  "locality":"nearby"}],
 "page":1,"pageSize":2,"total":12,"truncated":false,"sort":"rank"}

# Tuesday evening only — matches the weekday-evening part-timers
$ curl 'http://localhost:3000/api/v1/search/providers?lat=23.1618&lng=79.9492\
&date=2026-08-18&start_time=19:00&end_time=20:00'

# Hinglish, four ways to the same answer
$ curl 'http://localhost:3000/api/v1/search/resolve?q=motor%20jal%20gayi'   # exact
$ curl 'http://localhost:3000/api/v1/search/resolve?q=%E0%A4%AE%E0%A5%8B%E0%A4%9F%E0%A4%B0%20%E0%A4%9C%E0%A4%B2%20%E0%A4%97%E0%A4%88'  # मोटर जल गई
$ curl 'http://localhost:3000/api/v1/search/resolve?q=MOTOR%20JAL%20GAYI'   # exact
$ curl 'http://localhost:3000/api/v1/search/resolve?q=moter%20jal%20gai'    # fuzzy, 0.45
# → all four: {"slug":"motor-rewinding", …}

$ curl 'http://localhost:3000/api/v1/search/resolve?q=zzzzqqq%20xyzzy'
{"suggestions":[]}
```

### Not verified

- **CI going green** — still no git remote.
- **Behaviour above 200 candidates.** The cap is exercised by config in tests,
  not by a dataset that large.
- **Ranking quality.** The tests prove the formula does what it says; whether the
  formula picks the technician a customer would have picked is unknowable until
  there are real bookings.
- **Graceful shutdown under a real signal** — unchanged; Windows limitation.

---

## Next steps — Phase 6 (booking & slots)

**Ready to build on:**

- `provider_availability_templates` stores minutes-from-midnight, so expanding a
  template into dated slots is integer arithmetic plus a date.
- Search already filters on template coverage; Phase 6 subtracts booked slots
  from the same shape, and `docs/search.md` says so in both the code and the docs
  so the two cannot drift.
- The append-only event pattern from Phase 4 (`verification_events`, its trigger,
  and `projectStatus`) is the template for the booking state machine. The
  `REQUESTED → … → REVIEWED` log can be built the same way, including the
  projection test.
- `acceptanceRate` already exists in the ranking input with a neutral default —
  Phase 6 supplies the real number and nothing in the scorer changes.
- The OTP machinery (generation, HMAC storage, TTL, attempt limits) is reusable
  as-is for the start/end handshake.

**Phase 6 will need to decide:**

- Whether slots are materialised rows or computed on read. Materialised makes the
  `tstzrange` exclusion constraint straightforward; computed avoids a generation
  job. The exclusion constraint probably settles it.
- Where the Redis lock sits relative to the database constraint. The constraint is
  the correctness guarantee; the lock is only there to avoid a stampede of
  losers.
- Whether a booking's OTP reuses `auth:otp:*` keys or gets its own namespace.
  Separate is probably right — different lifetime, different failure handling.

**Carried forward, still deliberately not built:** the transactional outbox and
dispatcher, Razorpay/UPI, WhatsApp adapters, OpenAPI generation, session listing,
account deletion (DPDP, Phase 14), admin UI, trust score and SILVER/GOLD,
auto-suspension, virus scanning, document OCR, search analytics, and result
caching.
