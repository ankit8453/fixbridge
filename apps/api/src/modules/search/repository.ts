// All SQL for search. Raw throughout, because PostGIS and pg_trgm are the point.
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Badge } from '../verification/badge';

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
  startMinute: number | null;
  endMinute: number | null;
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
 * The three gates are non-negotiable and have no config to bypass them:
 * `is_listed` (profile completeness), `badge` (verification), and the user being
 * active. A provider missing any one is invisible to search, full stop.
 */
export async function searchProviders(
  prisma: PrismaClient,
  filters: SearchFilters,
): Promise<ProviderCandidateRow[]> {
  const categoryId = filters.categoryId;
  const dayOfWeek = filters.dayOfWeek;

  return prisma.$queryRaw<ProviderCandidateRow[]>`
    WITH customer AS (
      SELECT ST_SetSRID(
        ST_MakePoint(${filters.lng}::double precision, ${filters.lat}::double precision),
        4326
      )::geography AS point
    ),
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
        ST_Distance(pp.base_location, c.point) AS "distanceMetres"
      FROM provider_profiles pp
      JOIN users u ON u.id = pp.user_id
      JOIN provider_verification_summaries pvs ON pvs.provider_id = pp.user_id
      CROSS JOIN customer c
      WHERE pp.city_id = ${filters.cityId}
        AND pp.is_listed = true
        AND u.status = 'active'
        AND pvs.badge IN ('VERIFIED', 'SILVER', 'GOLD')
        AND pp.base_location IS NOT NULL
        -- The radius belongs to the provider: they said how far they travel.
        AND ST_DWithin(pp.base_location, c.point, pp.service_radius_km * 1000)
        -- The customer's own cap, applied on top rather than instead.
        AND (
          ${filters.maxDistanceMetres}::double precision IS NULL
          OR ST_DWithin(pp.base_location, c.point, ${filters.maxDistanceMetres}::double precision)
        )
        AND (
          ${categoryId}::int IS NULL
          OR EXISTS (
            SELECT 1 FROM provider_skills ps
            WHERE ps.provider_id = pp.user_id
              AND ps.category_id IN (SELECT id FROM target_categories)
          )
        )
        -- Availability is checked against templates, not slots: Phase 6 will
        -- additionally subtract already-booked time.
        AND (
          ${dayOfWeek}::int IS NULL
          OR EXISTS (
            SELECT 1 FROM provider_availability_templates pat
            WHERE pat.provider_id = pp.user_id
              AND pat.is_active = true
              AND pat.day_of_week = ${dayOfWeek}::int
              AND pat.start_minute <= ${filters.startMinute}::int
              AND pat.end_minute >= ${filters.endMinute}::int
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

/** The EXPLAIN behind `docs/search.md`. Used by a test to prove index usage. */
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
      AND ST_DWithin(
            pp.base_location,
            ST_SetSRID(ST_MakePoint(${filters.lng}::double precision, ${filters.lat}::double precision), 4326)::geography,
            pp.service_radius_km * 1000
          )
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
    GROUP BY ps.category_id
  `;
}

export { Prisma };
