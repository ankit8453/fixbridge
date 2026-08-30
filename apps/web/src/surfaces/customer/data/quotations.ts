import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useActionToast } from '@/lib/use-action-toast';
import { useT } from '@/i18n/useT';
import type { QuotationView } from './types';

/**
 * All three decision routes hang off `/api/v1/quotations/:id`, not the
 * booking, but they change what the booking looks like (a new
 * `pendingQuotation`/`approvedQuotation`), so success invalidates the booking
 * detail query — the one place that data is read from.
 */
function useQuotationDecision(bookingId: string, action: 'approve' | 'reject') {
  const queryClient = useQueryClient();
  const toast = useActionToast();
  const t = useT();

  return useMutation({
    mutationFn: ({ quotationId, reason }: { quotationId: string; reason?: string }) =>
      apiRequest<{ quotation: QuotationView; message?: string }>(
        `/api/v1/quotations/${quotationId}/${action}`,
        {
          method: 'POST',
          body: action === 'reject' ? { reason } : undefined,
        },
      ),
    /**
     * Approving a quotation is the moment a customer commits to a price. It
     * deserves an explicit acknowledgement rather than a quietly re-rendered
     * card — and if it failed, they must know before the technician starts
     * work on a total nobody agreed.
     */
    onError: (error) => toast.failed(error),
    onSuccess: (result) => {
      toast.succeeded(result, {
        success:
          action === 'approve'
            ? t('app.booking.quoteApprovedToast')
            : t('app.booking.quoteRejectedToast'),
      });
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
