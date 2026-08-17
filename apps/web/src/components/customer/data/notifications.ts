import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import type { NotificationsResponse } from './types';

export function useNotifications(page: number, unreadOnly: boolean) {
  return useQuery({
    queryKey: ['notifications', page, unreadOnly],
    queryFn: () =>
      apiRequest<NotificationsResponse>('/api/v1/notifications', {
        query: { page, page_size: 20, unread_only: unreadOnly },
      }),
  });
}

/** The shell's bell badge. Short poll — there is no push channel in this phase. */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiRequest<{ unread: number }>('/api/v1/notifications/unread-count'),
    refetchInterval: 30_000,
  });
}

function invalidateNotifications(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['notifications'] });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) =>
      apiRequest<{ id: string; read: boolean; unread: number }>(
        `/api/v1/notifications/${notificationId}/read`,
        { method: 'POST' },
      ),
    onSuccess: () => invalidateNotifications(queryClient),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiRequest<{ marked: number; unread: number }>('/api/v1/notifications/read-all', {
        method: 'POST',
      }),
    onSuccess: () => invalidateNotifications(queryClient),
  });
}
