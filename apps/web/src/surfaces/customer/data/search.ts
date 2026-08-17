import { useQuery } from '@tanstack/react-query';
import { apiRequest, type QueryValue } from '@/lib/api';
import type { ResolveResponse, SearchProvidersQuery, SearchProvidersResponse } from './types';

/**
 * Both routes are public (`skipAuth: true`) — a customer picks a technician
 * before signing in.
 */
export function useProviderSearch(query: SearchProvidersQuery | null) {
  return useQuery({
    queryKey: ['search', 'providers', query],
    queryFn: () =>
      apiRequest<SearchProvidersResponse>('/api/v1/search/providers', {
        query: query as unknown as Record<string, QueryValue>,
        skipAuth: true,
      }),
    // `null` means "we don't have a location yet" — the query stays disabled
    // rather than firing a request the API would 400 on for missing lat/lng.
    enabled: query !== null,
  });
}

export async function resolveSearchQuery(q: string, cityId = 1): Promise<ResolveResponse> {
  return apiRequest<ResolveResponse>('/api/v1/search/resolve', {
    query: { q, city_id: cityId },
    skipAuth: true,
  });
}
