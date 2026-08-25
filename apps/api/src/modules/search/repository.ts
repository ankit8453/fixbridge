// All SQL for search. Raw throughout, because proximity and pg_trgm are the point.
import { Prisma, type PrismaClient } from '@prisma/client';
import { boundingBox, distanceMetres, withinColumnRadius, withinMetres } from '../../core/geo-sql';
import type { Badge } from '../verification/badge';

/**
 * The widest radius any provider can claim, in metres.
 *
 * This is the bounding box's whole justification. Distance is now haversine
 * arithmetic with no spatial index behind it (see `core/geo-sql.ts` for why
 * PostGIS is gone), so every distance filter has to be preceded by a cheap
 * range predicate on `base_lat`/`base_lng` or the planner reads every profile
 * in the table and computes trigonometry for each one.
 *
 * The per-provider radius is a column, so no single box fits it — the box has
 * to be built from the largest value the column can hold. 25 km is that bound,
 * and it is enforced twice over: `serviceRadiusKm: z.coerce.number().int()
 * .min(1).max(25)` in `providers/types.ts`, and a database CHECK constraint
 * `service_radius_km BETWEEN 1 AND 25` that no code path can route around.
 * A provider 26 km away therefore cannot exist, so excluding them by box
 * cannot drop a real match.
 *
 * If that bound ever moves, this constant must move with it, and the Zod schema
 * and the CHECK are the two places to change first. A box that is too *small*
 * silently loses providers — the failure is invisible, which is exactly why the
 * number is named here rather than inlined at the call site.
 */
const MAX_SERVICE_RADIUS_METRES = 25_000;

/** Where a provider's base point lives, for the geo-sql helpers. */
const PROVIDER_BASE = { lat: 'pp.base_lat', lng: 'pp.base_lng' };

/* -------------------------------------------------------------------------- */
/* Provider search                                                            */
/* -------------------------------------------------------------------------- */

export interface SearchFilters {
  cityId: number;
  lat: number;
  lng: number;
  categoryId: number | null;
  maxDistanceMetres: number | null;
  dayOfWeek: number | null;
  /** The requested window as instants. Null when no availability filter applies. */
  windowStart: Date | null;
  windowEnd: Date | null;
  /** Ranking happens in TypeScript, so the candidate set has to be bounded. */
  candidateLimit: number;
}

export interface ProviderCandidateRow {
  providerId: string;
  displayName: string | null;
  yearsExperience: number | null;
  completenessScore: number;
  serviceRadiusKm: number;
  badge: Badge;
  distanceMetres: number;
  /** From `provider_stats`. Null below the small-sample floor — see bookings/stats. */
  acceptanceRate: number | null;
  /** 0–100, or null until there is any history. Phase 9. */
  trustScore: number | null;
  avgStars: number | null;
  reviewCount: number | null;
  settledJobsCount: number | null;
  startingPricePaise: number | null;
  skills: { categoryId: number; slug: string; nameKey: string }[] | null;
  nextWindow: { dayOfWeek: number; startMinute: number; endMinute: number } | null;
  totalCount: bigint;
}

/**
 * The whole search, in one round trip.
 *
 * Everything that could have been a follow-up query — the provider's skills,
 * their cheapest matching price, their next availability window, and the total
 * match count — is a correlated subquery here instead. That trades a slightly
 * denser statement for the absence of an N+1 across a public endpoint.
 *
 * The four gates are non-negotiable and have no config to bypass them:
 * `is_listed` (profile completeness), `badge` (verification), the user being
 * active, and not being suspended (Phase 9). A provider missing any one is
 * invisible to search, full stop.
 */
export async function searchProviders(
  prisma: PrismaClient,
  filters: SearchFilters,
): Promise<ProviderCandidateRow[]> {
  const categoryId = filters.categoryId;
  const dayOfWeek = filters.dayOfWeek;

  /**
   * The exact distance, reused three times below: once as an output column, and
   * once inside each of the two radius filters. Building it once keeps the
   * customer's coordinates bound as parameters in a single place.
   */
  const distance = distanceMetres(PROVIDER_BASE, filters.lat, filters.lng);

  /**
   * The indexable pre-filter, and the reason this query does not scan the table.
   *
   * Two radius tests run below — the provider's own `service_radius_km` and the
   * customer's optional cap — and the box has to be wide enough for whichever
   * survives more rows, or it would exclude a provider one of them would have
   * kept. `service_radius_km` is per row and unknown until the row is read, so
   * its worst case is `MAX_SERVICE_RADIUS_METRES`; the customer's cap is a
   * constant and never exceeds 25 km either (Zod `max_distance_km.max(25)`).
   * Taking the max of the two is therefore correct whether or not a cap is
   * supplied, and when one is supplied and is smaller, the box tightens.
   */
  const boxRadiusMetres = Math.max(MAX_SERVICE_RADIUS_METRES, filters.maxDistanceMetres ?? 0);

  const box = boundingBox(PROVIDER_BASE, filters.lat, filters.lng, boxRadiusMetres);

  return prisma.$queryRaw<ProviderCandidateRow[]>`
    WITH
    -- A cluster id matches the cluster and everything under it, so a customer
    -- can search "Electrical" without knowing the exact service.
    target_categories AS (
      SELECT id FROM categories
      WHERE is_active = true
        AND city_id = ${filters.cityId}
        AND (id = ${categoryId}::int OR parent_id = ${categoryId}::int)
    ),
    matched AS (
      SELECT
        pp.user_id            AS "providerId",
        pp.display_name       AS "displayName",
        pp.years_experience   AS "yearsExperience",
        pp.completeness_score AS "completenessScore",
        pp.service_radius_km  AS "serviceRadiusKm",
        pvs.badge             AS badge,
        -- LEFT JOIN, and the rate is nullable even when the row exists: a
        -- provider with no stats row and one below the sample floor mean the
        -- same thing to the scorer, and both must fall back to neutral rather
        -- than dropping out of the result set. The same is true of every Phase 9
        -- column below — a technician nobody has rated yet is unrated, not bad.
        pst.acceptance_rate   AS "acceptanceRate",
        pst.trust_score       AS "trustScore",
        pst.avg_stars         AS "avgStars",
        pst.review_count      AS "reviewCount",
        pst.settled_jobs_count AS "settledJobsCount",
        ${distance} AS "distanceMetres"
      FROM provider_profiles pp
      JOIN users u ON u.id = pp.user_id
      JOIN provider_verification_summaries pvs ON pvs.provider_id = pp.user_id
      LEFT JOIN provider_stats pst ON pst.provider_id = pp.user_id
      WHERE pp.city_id = ${filters.cityId}
        AND pp.is_listed = true
        AND u.status = 'active'
        AND pvs.badge IN ('VERIFIED', 'SILVER', 'GOLD')
        /**
         * The fourth gate, added in Phase 9: nobody suspended.
         *
         * Checked **lazily** against the clock rather than by a job that clears
         * the column, so a suspension ends the moment it ends. There is nothing
         * to schedule, nothing to miss, and no window in which somebody is
         * unlisted because a cron did not run.
         */
        AND (pp.suspended_until IS NULL OR pp.suspended_until <= NOW())
        /**
         * Both halves of the point, checked together.
         *
         * They replace the old base_location IS NOT NULL and mean exactly the
         * same thing: a technician who has not set their base is not searchable,
         * because there is no honest distance to rank them by. The columns are
         * only ever written as a pair, so either being null is the "unset" case.
         */
        AND pp.base_lat IS NOT NULL
        AND pp.base_lng IS NOT NULL
        /**
         * The box, before any trigonometry.
         *
         * This is a plain BETWEEN on two double columns, so it is indexable
         * and cheap, and it runs ahead of the two exact tests below — which is
         * the whole reason the haversine backend stays fast without a spatial
         * index. It admits a few false positives at the square's corners; the
         * exact filters immediately below remove them. It never produces a false
         * negative, so nothing that used to match can be lost here.
         */
        AND ${box}
        -- The radius belongs to the provider: they said how far they travel.
        -- Per-row, so the box above had to be sized from the 25 km ceiling.
        AND ${withinColumnRadius(PROVIDER_BASE, filters.lat, filters.lng, 'pp.service_radius_km * 1000')}
        /**
         * The customer's own cap, applied on top rather than instead.
         *
         * withinMetres rather than a bare distance comparison, so the cap
         * brings its own (tighter) box when one is supplied — a 5 km search
         * then narrows the scan instead of riding the 25 km box above. The
         * IS NULL arm still short-circuits the whole thing when no cap was
         * given, exactly as before.
         */
        AND (
          ${filters.maxDistanceMetres}::double precision IS NULL
          OR ${
            filters.maxDistanceMetres === null
              ? Prisma.sql`false`
              : withinMetres(PROVIDER_BASE, filters.lat, filters.lng, filters.maxDistanceMetres)
          }
        )
        AND (
          ${categoryId}::int IS NULL
          OR EXISTS (
            SELECT 1 FROM provider_skills ps
            WHERE ps.provider_id = pp.user_id
              AND ps.category_id IN (SELECT id FROM target_categories)
          )
        )
        -- Availability is checked against **real open slots**, not templates.
        -- Phase 5 matched templates and documented the gap; Phase 6 materialised
        -- slots, so a provider now only matches if the hour is genuinely free —
        -- already-booked time is excluded by the slot's own status.
        AND (
          ${filters.windowStart}::timestamptz IS NULL
          OR EXISTS (
            SELECT 1 FROM slots s
            WHERE s.provider_id = pp.user_id
              AND s.status = 'open'
              AND s.starts_at <= ${filters.windowStart}::timestamptz
              AND s.ends_at >= ${filters.windowEnd}::timestamptz
          )
        )
    )
    SELECT
      m.*,
      COUNT(*) OVER () AS "totalCount",
      (
        SELECT json_agg(
                 json_build_object('categoryId', cat.id, 'slug', cat.slug, 'nameKey', cat.name_key)
                 ORDER BY cat.sort_order, cat.id
               )
        FROM provider_skills ps
        JOIN categories cat ON cat.id = ps.category_id
        WHERE ps.provider_id = m."providerId" AND cat.is_active = true
      ) AS skills,
      (
        SELECT MIN(pc.amount_paise)
        FROM provider_price_cards pc
        WHERE pc.provider_id = m."providerId"
          AND pc.is_active = true
          AND pc.amount_paise IS NOT NULL
          AND (
            ${categoryId}::int IS NULL
            OR pc.category_id IN (SELECT id FROM target_categories)
          )
      ) AS "startingPricePaise",
      (
        SELECT json_build_object(
                 'dayOfWeek', pat.day_of_week,
                 'startMinute', pat.start_minute,
                 'endMinute', pat.end_minute
               )
        FROM provider_availability_templates pat
        WHERE pat.provider_id = m."providerId"
          AND pat.is_active = true
          AND (${dayOfWeek}::int IS NULL OR pat.day_of_week = ${dayOfWeek}::int)
        ORDER BY pat.day_of_week, pat.start_minute
        LIMIT 1
      ) AS "nextWindow"
    FROM matched m
    ORDER BY m."distanceMetres" ASC
    LIMIT ${filters.candidateLimit}
  `;
}

/**
 * The EXPLAIN behind `docs/search.md`. Used by a test to prove index usage.
 *
 * It has to carry the same bounding box as the real query, not just the exact
 * distance test — the box *is* the index-visible predicate now. Explaining the
 * haversine expression alone would show a sequential scan and prove nothing,
 * which is the opposite of what this function is for.
 */
export async function explainSearch(prisma: PrismaClient, filters: SearchFilters): Promise<string> {
  const rows = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>`
    EXPLAIN
    SELECT pp.user_id
    FROM provider_profiles pp
    JOIN users u ON u.id = pp.user_id
    JOIN provider_verification_summaries pvs ON pvs.provider_id = pp.user_id
    WHERE pp.city_id = ${filters.cityId}
      AND pp.is_listed = true
      AND u.status = 'active'
      AND pvs.badge IN ('VERIFIED', 'SILVER', 'GOLD')
      AND pp.base_lat IS NOT NULL
      AND pp.base_lng IS NOT NULL
      AND ${boundingBox(PROVIDER_BASE, filters.lat, filters.lng, MAX_SERVICE_RADIUS_METRES)}
      AND ${withinColumnRadius(PROVIDER_BASE, filters.lat, filters.lng, 'pp.service_radius_km * 1000')}
  `;

  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

/* -------------------------------------------------------------------------- */
/* Text resolution                                                            */
/* -------------------------------------------------------------------------- */

export interface SynonymMatchRow {
  categoryId: number;
  slug: string;
  nameKey: string;
  parentId: number | null;
  term: string;
  weight: number;
  similarity: number;
}

/** Exact hits first — an exact synonym is not a guess. */
export function findExactSynonyms(
  prisma: PrismaClient,
  cityId: number,
  term: string,
): Promise<SynonymMatchRow[]> {
  return prisma.$queryRaw<SynonymMatchRow[]>`
    SELECT
      c.id        AS "categoryId",
      c.slug      AS slug,
      c.name_key  AS "nameKey",
      c.parent_id AS "parentId",
      s.term      AS term,
      s.weight    AS weight,
      1.0::real   AS similarity
    FROM hinglish_synonyms s
    JOIN categories c ON c.id = s.category_id
    WHERE s.is_active = true
      AND c.is_active = true
      AND c.city_id = ${cityId}
      AND s.term = ${term}
    ORDER BY s.weight DESC, c.sort_order, c.id
  `;
}

/**
 * Prefix and fuzzy matching in one pass.
 *
 * `LIKE term || '%'` catches a half-typed phrase; `similarity()` catches a
 * misspelling. Both are backed by the GIN trigram index on `term`.
 */
export function findFuzzySynonyms(
  prisma: PrismaClient,
  cityId: number,
  term: string,
  threshold: number,
  limit: number,
): Promise<(SynonymMatchRow & { isPrefix: boolean })[]> {
  return prisma.$queryRaw<(SynonymMatchRow & { isPrefix: boolean })[]>`
    SELECT
      c.id        AS "categoryId",
      c.slug      AS slug,
      c.name_key  AS "nameKey",
      c.parent_id AS "parentId",
      s.term      AS term,
      s.weight    AS weight,
      similarity(s.term, ${term}) AS similarity,
      (s.term LIKE ${term} || '%') AS "isPrefix"
    FROM hinglish_synonyms s
    JOIN categories c ON c.id = s.category_id
    WHERE s.is_active = true
      AND c.is_active = true
      AND c.city_id = ${cityId}
      AND s.term <> ${term}
      AND (s.term LIKE ${term} || '%' OR similarity(s.term, ${term}) >= ${threshold}::real)
    ORDER BY "isPrefix" DESC, similarity DESC, s.weight DESC
    LIMIT ${limit}
  `;
}

export interface CategoryNameMatchRow {
  categoryId: number;
  slug: string;
  nameKey: string;
  parentId: number | null;
  similarity: number;
}

/** Last resort: match the slug itself, for someone typing English category names. */
export function findCategoriesBySlug(
  prisma: PrismaClient,
  cityId: number,
  term: string,
  threshold: number,
  limit: number,
): Promise<CategoryNameMatchRow[]> {
  // Slugs are hyphenated; a typed phrase is spaced.
  const slugish = term.replace(/ /g, '-');

  return prisma.$queryRaw<CategoryNameMatchRow[]>`
    SELECT
      c.id        AS "categoryId",
      c.slug      AS slug,
      c.name_key  AS "nameKey",
      c.parent_id AS "parentId",
      GREATEST(similarity(c.slug, ${slugish}), similarity(c.slug, ${term})) AS similarity
    FROM categories c
    WHERE c.is_active = true
      AND c.city_id = ${cityId}
      AND (
        c.slug LIKE ${slugish} || '%'
        OR similarity(c.slug, ${slugish}) >= ${threshold}::real
      )
    ORDER BY similarity DESC, c.sort_order, c.id
    LIMIT ${limit}
  `;
}

/* -------------------------------------------------------------------------- */
/* Category counts                                                            */
/* -------------------------------------------------------------------------- */

export interface CategoryProviderCount {
  categoryId: number;
  providerCount: bigint;
}

/**
 * Searchable providers per leaf category — the same three gates search uses, so
 * a category showing "3 available" cannot return zero results.
 */
export function countSearchableProvidersByCategory(
  prisma: PrismaClient,
  cityId: number,
): Promise<CategoryProviderCount[]> {
  return prisma.$queryRaw<CategoryProviderCount[]>`
    SELECT
      ps.category_id                       AS "categoryId",
      COUNT(DISTINCT ps.provider_id)::bigint AS "providerCount"
    FROM provider_skills ps
    JOIN provider_profiles pp ON pp.user_id = ps.provider_id
    JOIN users u ON u.id = pp.user_id
    JOIN provider_verification_summaries pvs ON pvs.provider_id = pp.user_id
    WHERE pp.city_id = ${cityId}
      AND pp.is_listed = true
      AND u.status = 'active'
      AND pvs.badge IN ('VERIFIED', 'SILVER', 'GOLD')
      -- The same four gates the search itself applies, or a category would
      -- promise technicians the search cannot deliver. The five-minute cache
      -- still means a freshly-suspended one lingers in the count for a few
      -- minutes; that is accepted, and documented in docs/search.md.
      AND (pp.suspended_until IS NULL OR pp.suspended_until <= NOW())
    GROUP BY ps.category_id
  `;
}

export { Prisma };
