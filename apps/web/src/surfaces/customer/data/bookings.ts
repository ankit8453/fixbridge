import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useActionToast } from '@/lib/use-action-toast';
import type { BookingDetail, CreateBookingInput, CustomerCancelReason } from './types';

const LIST_KEY = ['bookings', 'customer'] as const;
const detailKey = (id: string) => ['bookings', 'customer', id] as const;

export function useMyBookings() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () =>
      apiRequest<{ bookings: BookingDetail[]; side: 'customer' }>('/api/v1/bookings', {
        query: { side: 'customer' },
      }),
  });
}

export function useBookingDetail(bookingId: string) {
  return useQuery({
    queryKey: detailKey(bookingId),
    queryFn: () => apiRequest<{ booking: BookingDetail }>(`/api/v1/bookings/${bookingId}`),
    enabled: Boolean(bookingId),
    /**
     * The mission-control screen is the one place a customer watches state
     * change out from under them without doing anything themselves (a
     * technician accepting, going en route, a webhook confirming a payment).
     * A short poll is the pragmatic v1 answer — there is no websocket/push
     * channel in this phase — and it only runs while this screen is actually
     * mounted and visible.
     */
    refetchInterval: 8_000,
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBookingInput) =>
      apiRequest<{ booking: BookingDetail; message: string }>('/api/v1/bookings', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

function useBookingAction<TBody>(bookingId: string, path: string) {
  const queryClient = useQueryClient();
  const toast = useActionToast();

  return useMutation({
    mutationFn: (body: TBody) =>
      apiRequest<{ booking: BookingDetail; message: string }>(
        `/api/v1/bookings/${bookingId}${path}`,
        { method: 'POST', body: body ?? {} },
      ),
    /**
     * Cancelling or declining changes almost nothing on screen beyond a status
     * pill, so without a toast the customer cannot tell the tap registered —
     * and taps it again.
     */
    onError: (error) => toast.failed(error),
    onSuccess: (result) => {
      toast.succeeded(result);
      void queryClient.invalidateQueries({ queryKey: detailKey(bookingId) });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useCancelBooking(bookingId: string) {
  return useBookingAction<{ reason: CustomerCancelReason; note?: string }>(bookingId, '/cancel');
}

export function useDeclineWork(bookingId: string) {
  return useBookingAction<{ note?: string } | undefined>(bookingId, '/decline-work');
}
