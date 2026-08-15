import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import type { Translator } from '../../core/i18n';
import { consumeRateLimit } from '../../core/rate-limit';
import type { Badge } from '../verification/badge';
import { formatTimeOfDay } from '../providers/availability';
import { istDayOfWeek, istDayParts, istInstant } from '../bookings/slot-plan';
import { PAISE_PER_RUPEE } from '@fixbridge/shared';
import * as repo from './repository';
import { isUsableQuery, normalizeSearchTerm } from './normalize';
import {
  createWeightedRankScorer,
  priceBandPositions,
  type RankInput,
  type RankScorer,
  type RankWeights,
} from './ranking';
import type {
  CategorySuggestion,
  MatchReason,
  ResolveQuery,
  ResolveResponse,
  SearchProvidersQuery,
  SearchProvidersResponse,
  SearchResultCard,
} from './types';

/* -------------------------------------------------------------------------- */
/* Wiring                                                                     */
/* -------------------------------------------------------------------------- */

/** Weights come from config and nowhere else — see docs/search.md. */
export function rankWeightsFrom(context: AppContext): RankWeights {
  return {
    distance: context.config.RANK_WEIGHT_DISTANCE,
    badge: context.config.RANK_WEIGHT_BADGE,
    experience: context.config.RANK_WEIGHT_EXPERIENCE,
    completeness: context.config.RANK_WEIGHT_COMPLETENESS,
    trust: context.config.RANK_WEIGHT_TRUST,
    acceptance: context.config.RANK_WEIGHT_ACCEPTANCE,
    price: context.config.RANK_WEIGHT_PRICE,
    distanceHalfLifeKm: context.config.RANK_DISTANCE_HALF_LIFE_KM,
  };
}

export function scorerFor(context: AppContext): RankScorer {
  return createWeightedRankScorer(rankWeightsFrom(context));
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

const searchRateKey = (ip: string): string => `search:rate:ip:${ip}`;

/**
 * `/search` is unauthenticated, so the IP is all there is to limit on. The cap
 * is per minute rather than per quarter-hour: search is a typing-speed endpoint,
 * and a long window would punish a customer who simply browsed.
 */
export async function enforceSearchRateLimit(context: AppContext, ip: string): Promise<void> {
  const result = await consumeRateLimit(
    context.redis,
    searchRateKey(ip),
    context.config.SEARCH_RATE_LIMIT_PER_MINUTE,
    60,
  );

  if (!result.allowed) {
    throw AppError.tooManyRequests(
      `Search rate limit reached (${result.count}/${result.limit} per minute)`,
      result.retryAfterSeconds,
      { details: { scope: 'search', retryAfterSeconds: result.retryAfterSeconds } },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

/** Paise to a rupee string. Integer arithmetic only — never a float. */
export function formatPaise(amountPaise: number): string {
  const rupees = Math.floor(amountPaise / PAISE_PER_RUPEE);
  const paise = amountPaise % PAISE_PER_RUPEE;

  return paise === 0
    ? `₹${rupees.toLocaleString('en-IN')}`
    : `₹${rupees.toLocaleString('en-IN')}.${String(paise).padStart(2, '0')}`;
}

/** 0.1 km resolution: enough to choose by, too coarse to triangulate a home. */
export function roundDistanceKm(metres: number): number {
  return Math.round(metres / 100) / 10;
}

/* -------------------------------------------------------------------------- */
/* Provider search                                                            */
/* -------------------------------------------------------------------------- */

export async function searchProviders(
  context: AppContext,
  t: Translator,
  query: SearchProvidersQuery,
): Promise<SearchProvidersResponse> {
  const cityId = query.city_id ?? context.config.DEFAULT_CITY_ID;

  /**
   * The requested window as real instants.
   *
   * Phase 5 only needed a weekday, because it matched weekly templates. Now that
   * slots are materialised, availability is a question about a specific hour on
   * a specific date — and the date arrives as an IST calendar day.
   */
  const window =
    query.date && query.start_time !== undefined && query.end_time !== undefined
      ? {
          start: istInstant(istDayParts(query.date), query.start_time),
          end: istInstant(istDayParts(query.date), query.end_time),
        }
      : null;

  const dayOfWeek = window ? istDayOfWeek(window.start) : null;

  const rows = await repo.searchProviders(context.prisma, {
    cityId,
    lat: query.lat,
    lng: query.lng,
    categoryId: query.category_id ?? null,
    maxDistanceMetres: query.max_distance_km ? query.max_distance_km * 1000 : null,
    dayOfWeek,
    windowStart: window?.start ?? null,
    windowEnd: window?.end ?? null,
    candidateLimit: context.config.SEARCH_MAX_CANDIDATES,
  });

  const total = rows.length > 0 ? Number(rows[0]?.totalCount ?? 0) : 0;
  const truncated = total > rows.length;

  // Price position is relative to this result set, so it is computed once here
  // rather than per provider.
  const positions = priceBandPositions(rows.map((row) => row.startingPricePaise));
  const scorer = scorerFor(context);

  const scored = rows.map((row, index) => {
    const distanceKm = row.distanceMetres / 1000;

    const input: RankInput = {
      distanceKm,
      providerRadiusKm: row.serviceRadiusKm,
      badge: row.badge,
      yearsExperience: row.yearsExperience,
      completenessScore: row.completenessScore,
      // Trust score is Phase 9; neutral until then. Acceptance rate is real from
      // Phase 6, but stays null below the small-sample floor so a technician with
      // three jobs is not ranked on noise.
      trustScore: null,
      acceptanceRate: row.acceptanceRate,
      priceBandPosition: positions[index] ?? null,
    };

    return { row, distanceKm, rank: scorer.score(input) };
  });

  /**
   * Every comparator ends with the provider id. Without it, two providers with
   * identical scores could swap places between requests, and "same query, same
   * order" is something a customer notices immediately.
   */
  const byId = (a: (typeof scored)[number], b: (typeof scored)[number]): number =>
    a.row.providerId.localeCompare(b.row.providerId);

  const comparators = {
    rank: (a: (typeof scored)[number], b: (typeof scored)[number]) =>
      b.rank.score - a.rank.score || a.distanceKm - b.distanceKm || byId(a, b),
    distance: (a: (typeof scored)[number], b: (typeof scored)[number]) =>
      a.distanceKm - b.distanceKm || byId(a, b),
    price_low: (a: (typeof scored)[number], b: (typeof scored)[number]) => {
      // Providers who quote nothing sort last rather than first.
      const priceA = a.row.startingPricePaise ?? Number.POSITIVE_INFINITY;
      const priceB = b.row.startingPricePaise ?? Number.POSITIVE_INFINITY;
      return priceA - priceB || a.distanceKm - b.distanceKm || byId(a, b);
    },
  } as const;

  const ordered = [...scored].sort(comparators[query.sort]);
  const start = (query.page - 1) * query.page_size;
  const page = ordered.slice(start, start + query.page_size);

  const results: SearchResultCard[] = page.map(({ row, distanceKm }) => ({
    providerId: row.providerId,
    displayName: row.displayName,
    badge: row.badge as Badge,
    yearsExperience: row.yearsExperience,
    distanceKm: roundDistanceKm(row.distanceMetres),
    skills: (row.skills ?? []).map((skill) => ({
      categoryId: skill.categoryId,
      slug: skill.slug,
      name: t(skill.nameKey),
    })),
    startingPrice:
      row.startingPricePaise === null
        ? null
        : { amountPaise: row.startingPricePaise, display: formatPaise(row.startingPricePaise) },
    nextAvailability: row.nextWindow
      ? {
          dayOfWeek: row.nextWindow.dayOfWeek,
          startTime: formatTimeOfDay(row.nextWindow.startMinute),
          endTime: formatTimeOfDay(row.nextWindow.endMinute),
        }
      : null,
    // Coarse area only. The exact point never leaves the database.
    locality: describeLocality(distanceKm),
  }));

  return {
    results,
    page: query.page,
    pageSize: query.page_size,
    total,
    truncated,
    sort: query.sort,
    query: {
      cityId,
      categoryId: query.category_id ?? null,
      maxDistanceKm: query.max_distance_km ?? null,
      availability:
        dayOfWeek === null || query.start_time === undefined || query.end_time === undefined
          ? null
          : {
              dayOfWeek,
              startTime: formatTimeOfDay(query.start_time),
              endTime: formatTimeOfDay(query.end_time),
            },
    },
  };
}

/**
 * A rough "how far" band instead of a place name.
 *
 * Phase 3 stores no locality text on the profile — only a point — and reverse
 * geocoding it would be inventing precision we do not have. A band is honest and
 * still useful on a result card. A real locality field can arrive with a real
 * geocoder.
 */
function describeLocality(distanceKm: number): string | null {
  if (distanceKm <= 2) return 'nearby';
  if (distanceKm <= 5) return 'within 5 km';
  if (distanceKm <= 10) return 'within 10 km';
  return 'over 10 km away';
}

/* -------------------------------------------------------------------------- */
/* Text resolution                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Free text to category suggestions, in three escalating passes:
 *
 *   1. exact synonym  — "motor jal gayi" is not a guess
 *   2. prefix + trigram — mid-typing, and misspellings like "moter jal gai"
 *   3. category slug  — someone typing the English name we use internally
 *
 * Each pass only fills gaps left by the one before, so a confident match is
 * never displaced by a fuzzy one.
 */
export async function resolveQuery(
  context: AppContext,
  t: Translator,
  query: ResolveQuery,
): Promise<ResolveResponse> {
  const cityId = query.city_id ?? context.config.DEFAULT_CITY_ID;
  const normalized = normalizeSearchTerm(query.q);

  if (!isUsableQuery(normalized)) {
    return { query: query.q, normalizedQuery: normalized, suggestions: [] };
  }

  const seen = new Map<number, CategorySuggestion>();

  const add = (
    row: { categoryId: number; slug: string; nameKey: string; parentId: number | null },
    reason: MatchReason,
    confidence: number,
    matchedTerm: string | null,
  ): void => {
    const existing = seen.get(row.categoryId);
    if (existing && existing.confidence >= confidence) return;

    seen.set(row.categoryId, {
      categoryId: row.categoryId,
      slug: row.slug,
      name: t(row.nameKey),
      nameKey: row.nameKey,
      parentId: row.parentId,
      matchReason: reason,
      confidence,
      matchedTerm,
    });
  };

  for (const row of await repo.findExactSynonyms(context.prisma, cityId, normalized)) {
    add(row, 'synonym_exact', 1, row.term);
  }

  const fuzzy = await repo.findFuzzySynonyms(
    context.prisma,
    cityId,
    normalized,
    context.config.SEARCH_TRIGRAM_THRESHOLD,
    query.limit * 3,
  );

  for (const row of fuzzy) {
    add(
      row,
      row.isPrefix ? 'synonym_prefix' : 'synonym_fuzzy',
      // A prefix match is stronger than a similarity score, but neither is exact.
      row.isPrefix ? 0.9 : Math.min(0.85, Number(row.similarity)),
      row.term,
    );
  }

  if (seen.size < query.limit) {
    const bySlug = await repo.findCategoriesBySlug(
      context.prisma,
      cityId,
      normalized,
      context.config.SEARCH_TRIGRAM_THRESHOLD,
      query.limit,
    );

    for (const row of bySlug) {
      add(row, 'category_name', Math.min(0.8, Number(row.similarity)), null);
    }
  }

  const suggestions = [...seen.values()]
    .sort((a, b) => b.confidence - a.confidence || a.categoryId - b.categoryId)
    .slice(0, query.limit);

  return { query: query.q, normalizedQuery: normalized, suggestions };
}

/* -------------------------------------------------------------------------- */
/* Category provider counts                                                   */
/* -------------------------------------------------------------------------- */

const categoryCountsKey = (cityId: number): string => `search:category-counts:${cityId}`;

/**
 * How many searchable providers each leaf category has, so the app can grey out
 * the ones that would return nothing.
 *
 * Cached for five minutes with **no invalidation**, which is a deliberate
 * trade: the number is a browsing hint, not a promise, and a provider going live
 * five minutes early or late changes nothing a customer can act on. Invalidation
 * would mean touching this from four other modules' write paths.
 */
export async function getCategoryProviderCounts(
  context: AppContext,
  cityId: number,
): Promise<Record<number, number>> {
  const key = categoryCountsKey(cityId);

  try {
    const cached = await context.redis.get(key);
    if (cached) return JSON.parse(cached) as Record<number, number>;
  } catch (error) {
    // A cache miss and a cache outage are the same thing to the caller.
    context.logger.warn({ err: error, cityId }, 'category counts: cache read failed');
  }

  const rows = await repo.countSearchableProvidersByCategory(context.prisma, cityId);
  const counts: Record<number, number> = {};

  for (const row of rows) {
    counts[row.categoryId] = Number(row.providerCount);
  }

  try {
    await context.redis.set(
      key,
      JSON.stringify(counts),
      'EX',
      context.config.CATEGORY_COUNT_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    context.logger.warn({ err: error, cityId }, 'category counts: cache write failed');
  }

  return counts;
}
