import { Prisma } from '@prisma/client';

/**
 * Proximity SQL, in one place, so the host can change without a rewrite.
 *
 * ## Why this module exists
 *
 * Phases 1–12 used PostGIS: `geography(Point, 4326)` columns, `ST_DWithin` for
 * radius filters, `ST_Distance` for the ranking scorer, and GiST indexes to
 * make both fast. That is the right tool.
 *
 * The production host cannot provide it. Its PostgreSQL is aaPanel's
 * source-compiled build at `/www/server/pgsql`, whose extension directory holds
 * four extensions and neither `postgis` nor `btree_gist`. `apt install
 * postgresql-16-postgis-3` installs into `/usr/share/postgresql/`, which that
 * server never reads — so it appears to succeed and changes nothing. Copying
 * extension binaries between two differently-compiled builds risks crashing the
 * server, so it is not an option either.
 *
 * The owner expects to move hosts later. So rather than deleting the PostGIS
 * path, every distance expression in the app is generated *here*. Repositories
 * ask this module for SQL; they do not write `ST_` or `haversine` themselves.
 * Switching back is then a change to `GEO_BACKEND` plus a migration that
 * restores the geography columns — not an archaeology exercise across five
 * repositories.
 *
 * ## What the haversine backend costs
 *
 *   - **Accuracy.** Haversine models the Earth as a sphere; PostGIS uses the
 *     WGS-84 ellipsoid. The error is about 0.3%, so roughly 15 m over 5 km.
 *     For "which electrician is nearest", that is not a real difference.
 *   - **Indexing.** There is no spatial index, so the exact distance cannot be
 *     index-accelerated. `boundingBox` below is what recovers most of this: it
 *     is a plain range predicate that ordinary B-tree indexes on `lat`/`lng`
 *     *can* use, cutting the candidate set to a small square before any
 *     trigonometry runs. At one city and thousands of providers this is
 *     comfortably fast; at millions of rows across a country it would not be.
 *
 * ## Correctness note
 *
 * `distanceMetres` deliberately mirrors `haversineMetres` in `core/geo.ts`
 * formula-for-formula, including the same Earth radius. Tests assert distances
 * computed in TypeScript against distances computed in SQL, and a discrepancy
 * between the two would make those tests lie.
 */

/**
 * Mean Earth radius (IUGG), metres — the same constant `core/geo.ts` uses.
 * Changing one without the other silently desynchronises SQL from TypeScript.
 */
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Which backend generates the SQL below.
 *
 * `haversine` is correct everywhere and needs no extensions. `postgis` is
 * faster and more accurate but requires the extension *and* geography columns,
 * so flipping this alone is not enough — see the note at the top.
 */
export type GeoBackend = 'haversine' | 'postgis';

export const GEO_BACKEND: GeoBackend = 'haversine';

export interface GeoColumns {
  /** SQL expression for the row's latitude, e.g. `pp.base_lat`. */
  lat: string;
  /** SQL expression for the row's longitude, e.g. `pp.base_lng`. */
  lng: string;
}

/**
 * Great-circle distance in metres between a row and a fixed point.
 *
 * `asin(least(1, sqrt(h)))` rather than a bare `asin(sqrt(h))`: floating-point
 * rounding can push `h` a hair above 1 for two points that are effectively
 * identical, and `asin(1.0000000001)` is NaN, not 0. A NaN distance would sort
 * unpredictably and fail a `<=` filter silently — the kind of bug that only
 * appears when a customer searches from exactly a provider's own doorstep.
 */
export function distanceMetres(columns: GeoColumns, lat: number, lng: number): Prisma.Sql {
  return Prisma.sql`(
    2 * ${EARTH_RADIUS_M}::double precision * asin(least(1, sqrt(
      power(sin(radians(${lat}::double precision - ${Prisma.raw(columns.lat)}) / 2), 2)
      + cos(radians(${Prisma.raw(columns.lat)}))
      * cos(radians(${lat}::double precision))
      * power(sin(radians(${lng}::double precision - ${Prisma.raw(columns.lng)}) / 2), 2)
    )))
  )`;
}

/**
 * A cheap latitude/longitude square around a point, as a predicate.
 *
 * This is the part that keeps the haversine backend fast. It is a plain range
 * comparison, so a B-tree index on `lat`/`lng` applies, and it runs before any
 * trigonometry. Callers pair it with `distanceMetres` for the exact test:
 * the box admits a few false positives at the corners (a square always contains
 * more than its inscribed circle) and the precise distance filter removes them.
 *
 * It never produces false *negatives*, which is the property that matters — a
 * technician inside the radius is always inside the box.
 *
 * The longitude degree shrinks with latitude, hence the `cos` term. It is
 * clamped because at the poles `cos(lat)` reaches zero and the box width would
 * explode to infinity; Jabalpur is at 23°N so this never binds in practice, but
 * an unclamped division by ~0 is not a thing to leave in query-generating code.
 */
export function boundingBox(
  columns: GeoColumns,
  lat: number,
  lng: number,
  radiusMetres: number,
): Prisma.Sql {
  const METRES_PER_DEGREE_LAT = 111_320;
  const latDelta = radiusMetres / METRES_PER_DEGREE_LAT;

  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const lngDelta = radiusMetres / (METRES_PER_DEGREE_LAT * cosLat);

  return Prisma.sql`(
    ${Prisma.raw(columns.lat)} BETWEEN ${lat - latDelta}::double precision AND ${lat + latDelta}::double precision
    AND ${Prisma.raw(columns.lng)} BETWEEN ${lng - lngDelta}::double precision AND ${lng + lngDelta}::double precision
  )`;
}

/**
 * "Is this row within `radiusMetres` of the point?" — box first, then exact.
 *
 * The two are `AND`ed in this order deliberately: Postgres evaluates the cheap
 * indexable predicate first and only computes trigonometry for rows that
 * survive it.
 */
export function withinMetres(
  columns: GeoColumns,
  lat: number,
  lng: number,
  radiusMetres: number,
): Prisma.Sql {
  return Prisma.sql`(
    ${boundingBox(columns, lat, lng, radiusMetres)}
    AND ${distanceMetres(columns, lat, lng)} <= ${radiusMetres}::double precision
  )`;
}

/**
 * The same, for a radius that is itself a column rather than a constant — a
 * provider's own `service_radius_km`, which differs per technician.
 *
 * No bounding box here: the box needs a numeric radius to compute its corners,
 * and this one is only known per row. Callers pair it with a box built from the
 * *maximum* radius they care about, which is what `search/repository.ts` does.
 */
export function withinColumnRadius(
  columns: GeoColumns,
  lat: number,
  lng: number,
  radiusMetresExpr: string,
): Prisma.Sql {
  return Prisma.sql`(${distanceMetres(columns, lat, lng)} <= ${Prisma.raw(radiusMetresExpr)})`;
}
