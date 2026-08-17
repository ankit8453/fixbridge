import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type { CategoriesResponse } from './types';

/**
 * Public, unauthenticated — same call works on the home screen before the
 * customer has picked an address, which is why `cityId` defaults to Jabalpur
 * (`1`) rather than waiting on a selected address's city.
 */
export function useCategories(cityId = 1) {
  return useQuery({
    queryKey: ['categories', cityId],
    queryFn: () =>
      apiRequest<CategoriesResponse>('/api/v1/categories', {
        query: { cityId },
        skipAuth: true,
      }),
    staleTime: 5 * 60_000, // the taxonomy barely changes; no reason to refetch every mount
  });
}
