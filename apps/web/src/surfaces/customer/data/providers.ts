import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type { ProviderReviewsResponse, PublicProviderProfile, PublicSlot } from './types';

/**
 * `GET /providers/:id` — public profile, added in Phase 12
 * (`apps/api/src/modules/providers/public-profile.ts`). Replaces the old
 * `legacy-next-src` sessionStorage "cache the search result card" workaround
 * that this app's README's porting brief flagged: until this endpoint
 * existed, a provider page opened cold (a shared WhatsApp link, no prior
 * search this session) rendered blank fields. This surface fetches the real
 * profile on every visit instead, so a shared link works regardless of how
 * the visitor arrived.
 */
export function useProviderProfile(providerId: string) {
  return useQuery({
    queryKey: ['providers', providerId, 'profile'],
    queryFn: () =>
      apiRequest<{ profile: PublicProviderProfile }>(`/api/v1/providers/${providerId}`, {
        skipAuth: true,
      }).then((response) => response.profile),
    enabled: Boolean(providerId),
  });
}

/**
 * `GET /providers/:id/slots` — public, same rate budget as search. `from`/`to`
 * bound the window; the slot picker shows "next N days" so the caller
 * supplies that window rather than this hook guessing a default.
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
