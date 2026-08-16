# Search & matching

Written in Phase 5. Companion notes: [geo-notes.md](geo-notes.md) for how PostGIS
works here, [verification.md](verification.md) for what a badge means.

---

## The gates come first

Before any ranking, distance or text matching, a provider must pass four
filters. There is **no query parameter, config value or role that relaxes them**:

```sql
pp.is_listed = true                              -- profile completeness (Phase 3)
AND u.status = 'active'                          -- account in good standing
AND pvs.badge IN ('VERIFIED', 'SILVER', 'GOLD')  -- verification (Phase 4)
AND (pp.suspended_until IS NULL
     OR pp.suspended_until <= NOW())             -- not suspended (Phase 9)
```

This is where the marketplace's promise actually lives. Everything else in this
document is about ordering the survivors.

The suspension check is **lazy** — compared against the clock rather than cleared
by a job — so a suspension ends the moment it ends. Nothing to schedule, nothing
to miss, and no window in which somebody stays unlisted because a cron did not
run. See [trust.md](trust.md#suspension).

The seeded dataset exists to prove it: 20 technicians, 17 listed, 12 verified,
one of them suspended. A test derives the eligible set from the database and
asserts search returns exactly it — and a second test names the suspended
technician specifically, to prove their absence is the suspension rather than
something incidental.

---

## Query anatomy

`GET /api/v1/search/providers` — public, no auth, 30 requests per minute per IP.

| Parameter                        | Required | Meaning                                                                          |
| -------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `lat`, `lng`                     | ✅       | Where the customer is. GPS, or a saved address's point.                          |
| `city_id`                        | —        | Defaults to 1 (Jabalpur).                                                        |
| `category_id`                    | —        | A leaf filters to that service; a **cluster includes every service beneath it**. |
| `date`, `start_time`, `end_time` | —        | All three or none. See availability below.                                       |
| `max_distance_km`                | —        | The customer's own cap, ≤ 25, applied **on top of** each provider's radius.      |
| `sort`                           | —        | `rank` (default), `distance`, `price_low`.                                       |
| `page`, `page_size`              | —        | Default 10, max 25.                                                              |

### Radius belongs to the provider

A technician declared how far they will travel. Matching uses **their** radius,
not a platform-wide number:

```sql
ST_DWithin(pp.base_location, customer_point, pp.service_radius_km * 1000)
```

The column is `geography`, so the third argument is **metres** — this is the
whole reason for `geography` over `geometry`, where it would mean degrees.

`max_distance_km` narrows that further. It never widens it: a customer cannot
reach a technician who has said they do not travel that far.

### Availability is real slots

> Phase 5 shipped this against weekly templates and flagged the gap: a provider
> matching a template is _nominally_ free, not _confirmed_ free. **Phase 6
> materialised slots and closed it.**

`date` is read as an **IST calendar day** and combined with `start_time` and
`end_time` into real instants. A provider matches when they have an `open` slot
that **fully covers** the window:

```sql
EXISTS (
  SELECT 1 FROM slots s
  WHERE s.provider_id = pp.user_id
    AND s.status = 'open'
    AND s.starts_at <= $windowStart
    AND s.ends_at   >= $windowEnd
)
```

Full coverage, not overlap. A technician free 18:00–19:00 cannot take a
19:00–21:00 job, and returning them would waste everybody's time.

Because the predicate reads `status = 'open'`, an hour somebody has already
booked drops out on its own — there is no separate subtraction step, and no way
for the two to disagree. Slot generation and the exclusion constraint behind it
are in [bookings.md](bookings.md).

The weekday is still derived, but only to pick the `nextAvailability` window
shown on the result card.

### What a result card never contains

- **The provider's coordinates.** Distance only, rounded to 0.1 km. A
  technician's home address is not public data, and this endpoint needs no
  authentication — publishing exact points would let anyone map where every
  technician in the city lives.
- Their phone number (that arrives with a booking).
- Completeness internals.

A test asserts `lat`, `lng`, `baseLocation`, `phone` and `completenessScore`
appear nowhere in the response body.

---

## Ranking

### The formula

Every signal is normalised to 0..1, multiplied by its weight, and divided by the
sum of the weights — so the result is 0..1 and a weight reads directly as "how
much this matters relative to the others".

```
score = ( distance      × W_distance
        + badge         × W_badge
        + experience    × W_experience
        + completeness  × W_completeness
        + trust         × W_trust
        + acceptance    × W_acceptance
        + (1 − price)   × W_price
        ) / ΣW
```

| Component      | Normalisation                                | Why                                                                                                                                                                        |
| -------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distance`     | `0.5 ^ (km / halfLife)`                      | Exponential decay. The gap between 1 km and 3 km matters far more to someone with a burst pipe than the gap between 18 km and 20 km; linear scoring treats those as equal. |
| `badge`        | NONE 0 · VERIFIED 0.7 · SILVER 0.85 · GOLD 1 | Only VERIFIED is reachable today; the bands are ready for Phase 9.                                                                                                         |
| `experience`   | `min(1, years / 15)`                         | Diminishing returns, flat after 15 years.                                                                                                                                  |
| `completeness` | `score / 100`                                | A fuller profile is a better result card.                                                                                                                                  |
| `trust`        | Phase 9                                      | Neutral until then.                                                                                                                                                        |
| `acceptance`   | `accepted / decided`, 30-day window          | Real from Phase 6. Null — and therefore neutral — below 5 decided requests, so a newcomer is not ranked on noise.                                                          |
| `price`        | **inverted** — `1 − position`                | Position is relative to the current result set, because "expensive" only means anything next to the other quotes on screen.                                                |

### Default weights

| Weight             | Default | Env var                      |
| ------------------ | ------- | ---------------------------- |
| Distance           | 50      | `RANK_WEIGHT_DISTANCE`       |
| Badge              | 15      | `RANK_WEIGHT_BADGE`          |
| Experience         | 10      | `RANK_WEIGHT_EXPERIENCE`     |
| Trust              | 10      | `RANK_WEIGHT_TRUST`          |
| Completeness       | 5       | `RANK_WEIGHT_COMPLETENESS`   |
| Acceptance         | 5       | `RANK_WEIGHT_ACCEPTANCE`     |
| Price              | 5       | `RANK_WEIGHT_PRICE`          |
| Distance half-life | 5 km    | `RANK_DISTANCE_HALF_LIFE_KM` |

**Changing the ordering requires only config.** The scorer reads weights from its
input; nothing else in the codebase knows they exist. Tests prove it by
constructing a price-only weighting and asserting the ordering flips, with no
code change.

### Missing signals default to the midpoint

Any provider without enough history for a given signal defaults to **0.5**.

The midpoint is deliberate. Zero would push everyone down equally, making the
weight meaningless; one would make everyone look perfect until real data arrived
and then drop everyone's score at once. The midpoint means a technician with a
0.8 acceptance rate and one with no record yet sit near each other rather than at
opposite ends of the list.

**Both placeholder signals are now real, and neither needed this file to change.**
Acceptance rate went live in Phase 6, trust score in Phase 9; each phase added
data rather than a new scoring interface. `trustScore` arrives as the 0–100 score
divided by 100, and stays null until a technician has any history at all — which
is what keeps a newcomer at the midpoint rather than at the bottom. The formula
behind it is in [trust.md](trust.md).

### Ranking runs in TypeScript, not SQL

**The trade-off, stated plainly.**

The scorer has to be a pure, unit-testable, config-driven function — that is a
hard requirement, and a `CASE` expression inside an ORDER BY is none of those
things. So the query returns candidates and TypeScript ranks them.

The cost is that the candidate set must be bounded: `SEARCH_MAX_CANDIDATES`
(default 200). Beyond that, matches are counted in `total` but not ranked, and
the response sets `truncated: true`.

At pilot scale this is irrelevant — a dense city radius returns tens of
providers. If a single radius ever returns more than 200 genuine matches, the
right answer is to raise the cap or push ranking into SQL and duplicate the
formula there deliberately, not to discover it silently. Hence the flag.

`sort=distance` and `sort=price_low` are ordered in SQL first, so the cap takes
the _nearest_ or _cheapest_ candidates rather than an arbitrary 200.

### Determinism

Every comparator ends in the provider id. Two providers with identical scores
would otherwise swap places between requests, and customers notice that
immediately. A test runs the same query three times and asserts identical order.

---

## Text search: Hinglish

Nobody types "motor rewinding". They type `motor jal gayi`, or `मोटर जल गई`, or
`moter jal gai` on a cracked screen in the sun.

`GET /api/v1/search/resolve?q=…` turns any of those into category suggestions.
The app calls it as the customer types, then fires `/providers` with the chosen
`category_id`.

### The pipeline

Three escalating passes. Each only fills gaps left by the previous one, so a
confident match is never displaced by a fuzzy one.

| Pass | Method                           | Confidence     | `matchReason`    |
| ---- | -------------------------------- | -------------- | ---------------- |
| 1    | Exact synonym                    | 1.0            | `synonym_exact`  |
| 2a   | Synonym prefix (`LIKE 'term%'`)  | 0.9            | `synonym_prefix` |
| 2b   | Trigram similarity ≥ **0.3**     | the similarity | `synonym_fuzzy`  |
| 3    | Category slug, prefix or trigram | ≤ 0.8          | `category_name`  |

The 0.3 threshold (`SEARCH_TRIGRAM_THRESHOLD`) is Postgres's own default and
holds up here: `moter jal gai` scores ≈ 0.45 against `motor jal gayi`, while
genuine nonsense scores far below and correctly returns nothing.

Both passes are backed by a GIN trigram index on `hinglish_synonyms.term`.

### Normalisation is one function, used by both sides

```ts
normalizeSearchTerm(input); // NFC → lowercase → strip danda/punctuation → collapse spaces → trim
```

**The seed and the query path call the same function.** This is the classic bug
in this feature: store `"Motor Jal Gayi"`, look up `"motor jal gayi"`, and
nothing ever matches while the symptom reads as "synonyms are broken".

Devanagari has no case, so `toLowerCase()` is a no-op there — but **NFC is not**.
`क़` can be one code point (U+0958) or two (U+0915 + nukta). They render
identically and compare unequal, so a term seeded one way would never match a
query typed the other. Everything is folded to NFC first, and there is a test for
exactly that.

### The synonym table

`hinglish_synonyms`: `term`, `category_id`, `weight`, `is_active`.

**112 seeded terms across 22 categories**, covering all five clusters in both
scripts. `weight` breaks ties when a phrase could mean several things: `bijli` is
vague and points at the Electrical cluster, while `current nahi hai` is specific
enough to mean house wiring, so it carries more weight.

Adding a phrase is a row, not a deploy. Ops will find phrases we never thought
of, and they should not need an engineer.

---

## Category browse counts

`GET /api/v1/categories` now includes `providerCount` per category, so the app
can grey out categories that would return nothing.

The count applies **the same four gates search does**, so a category showing
"3 available" cannot return zero results. A cluster's count is the sum of its
services.

One caveat, accepted rather than engineered away: the cache means a **freshly
suspended** technician lingers in a count for up to five minutes after they have
already vanished from search. The count is a browsing hint; the search itself is
always correct.

Cached in Redis for 5 minutes with **no invalidation**. That is a deliberate
trade: the number is a browsing hint, not a promise, and a provider appearing
five minutes early or late changes nothing a customer can act on. Invalidating it
properly would mean reaching into this from four other modules' write paths, for
no benefit anyone can perceive.

---

## Query plan

The search is **one round trip**. Skills, cheapest matching price, next
availability window and the total match count are all correlated subqueries in
the same statement, rather than follow-up queries — an N+1 on a public,
unauthenticated endpoint is not something to leave lying around.

### EXPLAIN at seed scale

```
Nested Loop
  ->  Hash Join  (Hash Cond: u.id = pvs.provider_id)
        ->  Seq Scan on users u          Filter: status = 'active'
        ->  Hash -> Seq Scan on provider_verification_summaries pvs
                    Filter: badge = ANY ('{VERIFIED,SILVER,GOLD}')
  ->  Index Scan using provider_profiles_pkey on provider_profiles pp
        Filter: is_listed AND city_id = 1 AND st_dwithin(base_location, …)
```

**Sequential scans, and that is correct.** There are 20 providers and 23 users;
reading a page is cheaper than descending an index, and Postgres knows it. A plan
that used the GIST index here would mean the planner had bad statistics.

### Proving the index is usable

With `enable_seqscan = off`, so the planner has to reach for it:

```
Index Scan using provider_profiles_base_location_gist_idx on provider_profiles
  Index Cond: base_location && _st_expand('…'::geography, '8000'::double precision)
  Filter: st_dwithin(base_location, '…'::geography, '8000', true)
```

`&&` is the bounding-box overlap operator — the GIST index narrows candidates,
and `ST_DWithin` then filters exactly. This is the plan that matters at real
volume, and a test asserts it.

### Indexes search depends on

| Index                                                | Used for                             |
| ---------------------------------------------------- | ------------------------------------ |
| `provider_profiles_base_location_gist_idx`           | `ST_DWithin` radius filter           |
| `provider_profiles_listed_city_idx`                  | partial, `(city_id) WHERE is_listed` |
| `provider_verification_summaries_badge_provider_idx` | the badge join                       |
| `provider_skills_category_provider_idx`              | category filter                      |
| `provider_availability_day_window_idx`               | partial, availability windows        |
| `hinglish_synonyms_term_trgm_idx`                    | GIN trigram, fuzzy synonyms          |
| `categories_slug_trgm_idx`                           | GIN trigram, slug fallback           |

> **Every migration must be checked for `DROP INDEX` on the GIST indexes.**
> `prisma migrate diff` cannot see indexes on `Unsupported` columns and proposes
> dropping them every single time. It has now done so in Phases 4 and 5. See
> [geo-notes.md](geo-notes.md).

---

## What is deliberately not here

- Real trust scores — Phase 9. Acceptance rate arrived in Phase 6.
- Caching of search _results_. Only the category counts are cached; a stale
  result list would show technicians who have since gone offline.
- Search analytics and query logging — Phase 14 funnel work.
- Personalisation and "rebook your technician" — Phase 12, from booking history
  rather than search.
- OpenSearch or any external search engine. Postgres with `pg_trgm` handles one
  city comfortably, and a second moving part is not worth it in year one.
- Anything with a model in it.
