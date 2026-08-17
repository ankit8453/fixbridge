import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../i18n/useT';
import { Badge, Button, Pagination, QueryState } from '../../../components/ui';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';

const CRITICALITY_TONE = { critical: 'danger', normal: 'info', low: 'neutral' } as const;

/** A plain notification inbox. Ported from `legacy-next-src/components/partner/NotificationInbox.tsx`. */
export function NotificationInbox() {
  const t = useT();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: partnerKeys.notifications(page, false),
    queryFn: () => fetchNotifications(page, false),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner', 'notifications'] });
      queryClient.invalidateQueries({ queryKey: partnerKeys.unreadCount });
    },
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner', 'notifications'] });
      queryClient.invalidateQueries({ queryKey: partnerKeys.unreadCount });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        empty={{ title: t('partner.notifications.empty') }}
        isEmpty={(data) => data.notifications.length === 0}
      >
        {(data) => (
          <>
            {data.unread > 0 ? (
              <Button
                variant="secondary"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate()}
              >
                {t('partner.notifications.markAllRead', { count: data.unread })}
              </Button>
            ) : null}

            <ul className="flex flex-col gap-2">
              {data.notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={`rounded-xl border p-3 ${notification.read ? 'border-slate-200 bg-white' : 'border-brand bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-medium text-slate-900">{notification.title}</p>
                    <Badge tone={CRITICALITY_TONE[notification.criticality]}>
                      {t(`partner.notifications.criticality.${notification.criticality}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{notification.body}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      {new Date(notification.createdAt).toLocaleString('hi-IN')}
                    </span>
                    {!notification.read ? (
                      <button
                        type="button"
                        onClick={() => markRead.mutate(notification.id)}
                        className="min-h-touch text-sm font-medium text-brand"
                      >
                        {t('partner.notifications.markRead')}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={setPage}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
