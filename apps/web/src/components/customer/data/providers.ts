import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type { ProviderReviewsResponse, PublicSlot, SearchResultCard } from './types';

/**
 * `GET /providers/:id/slots` — public, same rate budget as search. `from`/`to`
 * bound the window; the phase spec's slot picker shows "next N days" so the
 * caller supplies that window rather than this hook guessing a default.
 */
export function useProviderSlots(providerId: string, from: Date, to: Date) {
  return useQuery({
    queryKey: ['providers', providerId, 'slots', from.toISOString(), to.toISOString()],
    queryFn: () =>
      apiRequest<{ providerId: string; slots: PublicSlot[] }>(
        `/api/v1/providers/${providerId}/slots`,
        { query: { from: from.toISOString(), to: to.toISOString() }, skipAuth: true },
      ),
    enabled: Boolean(providerId),
  });
}

export function useProviderReviews(providerId: string, page: number, pageSize = 10) {
  return useQuery({
    queryKey: ['providers', providerId, 'reviews', page, pageSize],
    queryFn: () =>
      apiRequest<ProviderReviewsResponse>(`/api/v1/providers/${providerId}/reviews`, {
        query: { page, page_size: pageSize },
        skipAuth: true,
      }),
    enabled: Boolean(providerId),
  });
}

/* -------------------------------------------------------------------------- */
/* Provider-summary cache                                                     */
/* -------------------------------------------------------------------------- */

/**
 * There is no public `GET /providers/:id` endpoint in this API (checked
 * `apps/api/src/modules/providers/routes.ts` and `search/routes.ts` — every
 * `/providers/:id/*` route is either `/slots` or `/reviews`, both scoped, no
 * profile-by-id route exists). A gap flagged in the phase report.
 *
 * The workaround: the results list is the only place a `SearchResultCard`
 * (name, badge, rating, skills, starting price) is ever fetched, so it stashes
 * the card here, keyed by provider id, the moment it renders one. The provider
 * page reads it back for an instant, fully-populated header. `sessionStorage`
 * (not a request cache) so a reload of the provider page — not just a client
 * navigation — still has it for the rest of that browsing session; a cold
 * visit (a shared link with no prior search) legitimately has nothing here,
 * and the provider page degrades to what it *can* still show publicly
 * (reviews, slots) with an honest note instead of blank fields.
 */
const CACHE_KEY = 'fixbridge.web.providerCardCache';

function readCache(): Record<string, SearchResultCard> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(CACHE_KEY) ?? '{}') as Record<
      string,
      SearchResultCard
    >;
  } catch {
    return {};
  }
}

export function cacheProviderCard(card: SearchResultCard): void {
  if (typeof window === 'undefined') return;
  const cache = readCache();
  cache[card.providerId] = card;
  window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function getCachedProviderCard(providerId: string): SearchResultCard | null {
  return readCache()[providerId] ?? null;
}
