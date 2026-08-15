# PostGIS with Prisma — how geography works in this codebase

Written in Phase 3, when the first geography columns landed. Phase 5 (search)
and everything geospatial after it follows the pattern described here.

---

## The problem

Prisma has no PostGIS support. There is no `geography` scalar, no `ST_*` in the
query builder, and no plan for either. But we need real spatial types: "find
technicians within 8 km" has to be an indexed query, not a full table scan with
distance computed in Node.

## The approach

**Declare the column in Prisma, read and write it in raw SQL.**

```prisma
model Address {
  id       String                                @id @default(uuid()) @db.Uuid
  location Unsupported("geography(Point, 4326)")
  // …
}

model ProviderProfile {
  baseLocation Unsupported("geography(Point, 4326)")? @map("base_location")
  // …
}
```

`Unsupported(...)` means:

- ✅ the column **is** in the schema, so `prisma migrate` emits correct DDL and
  drift detection works;
- ✅ the rest of the model is still normal Prisma — relations, includes, filters;
- ❌ Prisma Client **cannot read or write that one column**. It is simply absent
  from the generated types.

So every point goes in and out through `$queryRaw` / `$executeRaw`.

## The rules

1. **Raw SQL lives in repositories only.** Services never see a query. If you
   are writing `ST_` outside a `repository.ts`, stop.
2. **Always use tagged templates** — `` prisma.$queryRaw`… ${value} …` `` — never
   string concatenation. Tagged templates parameterise; concatenation is an
   injection.
3. **Project points into plain `lat`/`lng` at the repository boundary.** Nothing
   above the repository should know PostGIS exists.
4. **SRID 4326 everywhere.** WGS-84, the coordinate system GPS and every map
   client speaks.
5. **`geography`, not `geometry`.** `geography` measures in metres on a spheroid,
   so `ST_DWithin(a, b, 8000)` means 8 km. With `geometry` it would mean 8000
   degrees, which is nonsense.

## The gotcha that will bite you

**PostGIS is (x, y) — that is (longitude, latitude).** The reverse of how
everyone says it aloud.

```sql
ST_MakePoint(79.9492, 23.1618)   -- lng, lat  ✅
ST_MakePoint(23.1618, 79.9492)   -- lat, lng  ❌ silently wrong, lands in China
```

Nothing errors. The point is just in the wrong place. This is why the swap
happens in exactly one place per table, wrapped in a helper.

## Reading a point

`::geometry` is needed because `ST_X`/`ST_Y` are geometry functions:

```ts
const rows = await prisma.$queryRaw<{ lat: number; lng: number }[]>`
  SELECT
    ST_Y(location::geometry) AS lat,
    ST_X(location::geometry) AS lng
  FROM addresses
  WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid
`;
```

Note `user_id` in the `WHERE`: ownership is enforced in the query, so another
user's row is never found in the first place.

## Writing a point

`addresses.location` is `NOT NULL`, which means Prisma cannot create the row at
all — the whole INSERT is raw, with `RETURNING` so one round trip does the job:

```ts
await prisma.$queryRaw`
  INSERT INTO addresses (id, user_id, location, …)
  VALUES (
    ${id}::uuid,
    ${userId}::uuid,
    ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography,
    …
  )
  RETURNING id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, …
`;
```

`provider_profiles.base_location` is nullable, so Prisma creates the row normally
and a separate raw `UPDATE` sets the point.

**Casting matters.** Without `::double precision`, Prisma sends a JS number in a
way Postgres may read as `numeric`, and `ST_MakePoint` has no `numeric` overload.
Without `::uuid`, a parameter arrives as `text` and the comparison fails.

## Indexes and constraints

Prisma cannot express a GIST index or a CHECK constraint, so the migration is
generated and then **hand-edited**. See
`prisma/migrations/20260815112721_add_categories_customers_providers/migration.sql`
— everything below the "Hand-written additions" banner is maintained manually and
must be carried forward if the migration is ever regenerated.

```sql
CREATE INDEX "addresses_location_gist_idx" ON "addresses" USING GIST ("location");
CREATE INDEX "provider_profiles_base_location_gist_idx"
  ON "provider_profiles" USING GIST ("base_location");
```

Without GIST, `ST_DWithin` degrades to a sequential scan over every provider —
fine at 20 rows, not at 20,000.

## Geocoding

Address text → coordinates goes through the `GeoService` interface in
[`src/core/geo.ts`](../apps/api/src/core/geo.ts). The only implementation today
is a **deterministic stub**: it hashes the address text and landmark into a point
inside the Jabalpur bounding box.

Deterministic on purpose — the same address always yields the same point, so
tests can assert exact values and a re-run of the seed produces the same map. It
understands nothing about streets; it is a placeholder with the right shape.

A real provider (Ola Maps) drops in behind the same interface. Nothing else
changes, because nothing else knows which implementation is wired in.

## Verifying it works

The Phase 3 suite includes a round-trip test — write a point through the API,
read it back, assert the coordinates survive to six decimal places. Keep that
test alive; it is the canary for a lat/lng swap or a lost cast.

```bash
docker exec fixbridge-postgres psql -U fixbridge -d fixbridge \
  -c "SELECT display_name, ST_Y(base_location::geometry) AS lat,
             ST_X(base_location::geometry) AS lng
      FROM provider_profiles WHERE base_location IS NOT NULL LIMIT 5;"
```

## What Phase 5 will need

- `ST_DWithin(base_location, $point, radius_metres)` for the radius filter — this
  is the query the GIST indexes exist for.
- `ST_Distance` for the distance component of ranking. It returns metres for
  `geography`.
- The technician's own `service_radius_km` is a second, independent filter: a
  customer is in range only if each is inside the other's radius.
- `is_listed = true` on every search query. Phase 3 guarantees that flag is
  accurate; search must not second-guess it by recomputing completeness.
