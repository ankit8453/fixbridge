import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type { CreateReviewInput, ReviewView } from './types';

export function useBookingReviews(bookingId: string) {
  return useQuery({
    queryKey: ['bookings', bookingId, 'reviews'],
    queryFn: () =>
      apiRequest<{ bookingId: string; reviews: ReviewView[] }>(
        `/api/v1/bookings/${bookingId}/reviews`,
      ),
    enabled: Boolean(bookingId),
  });
}

export function useCreateReview(bookingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateReviewInput) =>
      apiRequest<{ review: ReviewView; message: string }>(`/api/v1/bookings/${bookingId}/reviews`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookings', bookingId, 'reviews'] });
    },
  });
}
