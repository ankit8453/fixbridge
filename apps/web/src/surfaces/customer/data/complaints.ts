import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useActionToast } from '@/lib/use-action-toast';
import type { ComplaintCategory, ComplaintView } from './types';

export function useMyComplaints() {
  return useQuery({
    queryKey: ['complaints', 'mine'],
    queryFn: () => apiRequest<{ complaints: ComplaintView[] }>('/api/v1/complaints'),
  });
}

export function useComplaint(complaintId: string) {
  return useQuery({
    queryKey: ['complaints', complaintId],
    queryFn: () => apiRequest<{ complaint: ComplaintView }>(`/api/v1/complaints/${complaintId}`),
    enabled: Boolean(complaintId),
  });
}

export function useRaiseComplaint(bookingId: string) {
  const queryClient = useQueryClient();
  const toast = useActionToast();

  return useMutation({
    mutationFn: (input: { category: ComplaintCategory; description: string }) =>
      apiRequest<{ complaint: ComplaintView; message: string }>(
        `/api/v1/bookings/${bookingId}/complaints`,
        { method: 'POST', body: input },
      ),
    onError: (error) => toast.failed(error),
    onSuccess: (result) => {
      toast.succeeded(result);
      void queryClient.invalidateQueries({ queryKey: ['complaints', 'mine'] });
    },
  });
}
