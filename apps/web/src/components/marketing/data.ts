import { apiRequest } from '@/lib/api';
import type { Locale } from '@/i18n/config';

/**
 * Server-only data access for the marketing surface.
 *
 * Every function here calls the same public, unauthenticated endpoints a
 * signed-out visitor's browser could call directly (`skipAuth: true`) — this
 * file exists only to give the marketing pages one typed, cacheable place to
 * ask for "the live numbers", not to add business logic apps/api doesn't
 * already own. A function that cannot reach the API returns null instead of
 * throwing, because a marketing page rendering without a stat is an honest
 * page; one that 500s because a stat endpoint hiccuped mid-ISR-revalidation
 * is not (PHASE12_PROMPT.md: "do NOT invent an endpoint or hardcode a
 * number — render the page without that stat and report it").
 */

/** The only seeded city (apps/api/prisma/seed.ts) and the API's own default. */
export const CITY_ID = 1;

/**
 * Wright Town, Jabalpur — the same point docs/API.md's own `/search/providers`
 * example uses (apps/api/prisma/seeds/localities.ts). Central enough that a
 * 25km radius (the API's own ceiling on `max_distance_km`) covers the whole
 * seeded service area, which is what makes a "citywide" search query from
 * here a fair stand-in for "every technician in Jabalpur".
 */
export const CITY_CENTER = { lat: 23.1618, lng: 79.9492 };

export interface CategoryNode {
  id: number;
  slug: string;
  name: string;
  nameKey: string;
  icon: string | null;
  sortOrder: number;
  providerCount: number;
  children: CategoryNode[];
}

interface CategoryTreeResponse {
  cityId: number;
  categories: CategoryNode[];
}

export interface SearchResultCard {
  providerId: string;
  rating: { average: number; count: number } | null;
  startingPrice: { amountPaise: number; display: string } | null;
}

interface SearchProvidersResponse {
  results: SearchResultCard[];
  page: number;
  pageSize: number;
  total: number;
  truncated: boolean;
}

export async function getCategoryTree(locale: Locale): Promise<CategoryNode[] | null> {
  try {
    const response = await apiRequest<CategoryTreeResponse>('/api/v1/categories', {
      query: { cityId: CITY_ID },
      skipAuth: true,
      locale,
    });
    return response.categories;
  } catch {
    return null;
  }
}

/**
 * Every category, cluster and leaf alike, flattened.
 *
 * `generateStaticParams` for `/services/[slug]` and the slug lookup both want
 * this shape — clusters get their own landing page too (a cluster like
 * "Electrical" is the actual "electrician in Jabalpur" search target; the
 * leaves underneath it, like "House wiring & repair", are the more specific
 * long-tail ones). `/search/providers?category_id=` already treats a cluster
 * id as "every service beneath it" (docs/API.md), so one detail page template
 * serves both levels with no special-casing.
 */
export function flattenCategories(tree: CategoryNode[]): CategoryNode[] {
  const flat: CategoryNode[] = [];
  for (const root of tree) {
    flat.push(root);
    flat.push(...root.children);
  }
  return flat;
}

export function findCategoryBySlug(tree: CategoryNode[], slug: string): CategoryNode | null {
  return flattenCategories(tree).find((category) => category.slug === slug) ?? null;
}

/** Total leaf services across every cluster — what the homepage calls "categories". */
export function countLeafCategories(tree: CategoryNode[]): number {
  return tree.reduce((sum, root) => sum + root.children.length, 0);
}

async function searchCity(
  locale: Locale,
  params: {
    categoryId?: number;
    sort?: 'rank' | 'distance' | 'price_low';
    pageSize?: number;
    page?: number;
  },
): Promise<SearchProvidersResponse | null> {
  try {
    return await apiRequest<SearchProvidersResponse>('/api/v1/search/providers', {
      query: {
        lat: CITY_CENTER.lat,
        lng: CITY_CENTER.lng,
        city_id: CITY_ID,
        category_id: params.categoryId,
        max_distance_km: 25, // the API's own ceiling — the widest honest "citywide" radius
        sort: params.sort ?? 'rank',
        page: params.page ?? 1,
        page_size: params.pageSize ?? 25, // the API's own max page size
      },
      skipAuth: true,
      locale,
    });
  } catch {
    return null;
  }
}

export interface CityTrustStats {
  verifiedTechnicianCount: number;
  averageRating: { value: number; count: number } | null;
}

/**
 * The homepage's "live trust numbers" (PHASE12_PROMPT.md §A).
 *
 * `verifiedTechnicianCount` is `/search/providers`'s own `total` for a
 * 25km-radius, no-category query from the city centre — the count is exact
 * (the API computes it with a SQL window function before its own candidate
 * cap truncates the *rows*, not the count — see search/repository.ts), so
 * this is every technician the public search gates (listed, VERIFIED+,
 * active) would ever surface, not a sample.
 *
 * `averageRating` is computed here, not returned by any endpoint — there is
 * no sitewide "average rating" route (only `/providers/:id/reviews`, which is
 * per-technician). Rather than fabricate a number or average just the first
 * ranked page (which would skew toward whoever the ranking formula already
 * favours), this walks a few pages so the average covers more of the same
 * population `verifiedTechnicianCount` counts. Capped at 4 pages (100
 * providers) — generous for the pilot's seed data, and bounded so an ISR
 * revalidation never turns into an unbounded burst against the search
 * endpoint's own 30-req/min-per-IP rate limit.
 */
export async function getCityTrustStats(locale: Locale): Promise<CityTrustStats | null> {
  const first = await searchCity(locale, { pageSize: 25, sort: 'rank' });
  if (!first) return null;

  const pages = [first];
  const pageCount = Math.min(Math.ceil(first.total / 25), 4);
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await searchCity(locale, { pageSize: 25, page, sort: 'rank' });
    if (next) pages.push(next);
  }

  let weightedSum = 0;
  let ratedCount = 0;
  for (const response of pages) {
    for (const result of response.results) {
      if (result.rating) {
        weightedSum += result.rating.average * result.rating.count;
        ratedCount += result.rating.count;
      }
    }
  }

  return {
    verifiedTechnicianCount: first.total,
    averageRating: ratedCount > 0 ? { value: weightedSum / ratedCount, count: ratedCount } : null,
  };
}

export interface CategoryStartingPrice {
  amountPaise: number;
  display: string;
}

/** The cheapest advertised starting price among a category's live listings — null when nobody has quoted one yet. */
export async function getCategoryStartingPrice(
  locale: Locale,
  categoryId: number,
): Promise<CategoryStartingPrice | null> {
  const response = await searchCity(locale, { categoryId, sort: 'price_low', pageSize: 25 });
  if (!response) return null;

  for (const result of response.results) {
    if (result.startingPrice) return result.startingPrice;
  }
  return null;
}
