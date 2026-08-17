import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type { QuotationView } from './types';

/**
 * All three decision routes hang off `/api/v1/quotations/:id`, not the
 * booking, but they change what the booking looks like (a new
 * `pendingQuotation`/`approvedQuotation`), so success invalidates the booking
 * detail query — the one place that data is read from.
 */
function useQuotationDecision(bookingId: string, action: 'approve' | 'reject') {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ quotationId, reason }: { quotationId: string; reason?: string }) =>
      apiRequest<{ quotation: QuotationView }>(`/api/v1/quotations/${quotationId}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? { reason } : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookings', 'customer', bookingId] });
    },
  });
}

export function useApproveQuotation(bookingId: string) {
  return useQuotationDecision(bookingId, 'approve');
}

export function useRejectQuotation(bookingId: string) {
  return useQuotationDecision(bookingId, 'reject');
}
