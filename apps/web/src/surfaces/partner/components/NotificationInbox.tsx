import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, BellRing, CheckCheck } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';
import { useLocale, useT } from '../../../i18n/useT';
import { Button, ErrorState, Pagination } from '../../../components/ui';
import { EmptyState, Panel, SkeletonRows, StatusPill, type Tone } from './ui';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { NotificationView } from '../lib/types';

type Criticality = NotificationView['criticality'];

const CRITICALITY_TONE: Record<Criticality, Tone> = {
  critical: 'danger',
  standard: 'brand',
};

const CRITICALITY_ICON: Record<Criticality, ComponentType<LucideProps>> = {
  critical: AlertTriangle,
  standard: BellRing,
};

/** Icon chip colours, one literal per tone so Tailwind's content scan sees them. */
const CRITICALITY_CHIP: Record<Criticality, string> = {
  critical: 'bg-danger/10 text-danger',
  standard: 'bg-brand/10 text-brand',
};

/**
 * A plain notification inbox. Ported from
 * `legacy-next-src/components/partner/NotificationInbox.tsx`.
 *
 * Unread is carried by three cues at once — a brand-tinted row, a leading
 * dot, and a heavier title — rather than a border alone: this list is read
 * on a cheap phone in daylight, where a 1px colour change is invisible.
 */
export function NotificationInbox() {
  const t = useT();
  const locale = useLocale();
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

  const timestamp = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  // The three states are handled inline rather than through `QueryState` so
  // loading can be skeleton rows shaped like the list they replace, instead
  // of a spinner that collapses the layout on every page change.
  if (query.status === 'pending') return <SkeletonRows rows={5} />;

  if (query.status === 'error' || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }

  const data = query.data;

  if (data.notifications.length === 0) {
    return (
      <Panel padded={false}>
        <EmptyState
          icon={Bell}
          title={t('partner.notifications.empty')}
          description={t('partner.notifications.emptyHint')}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title={t('partner.notifications.listTitle')}
      description={
        data.unread > 0
          ? t('partner.notifications.unreadCount', { count: data.unread })
          : t('partner.notifications.allRead')
      }
      action={
        data.unread > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            loading={markAll.isPending}
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
            {t('partner.notifications.markAllRead', { count: data.unread })}
          </Button>
        ) : null
      }
      padded={false}
    >
      <ul className="divide-y divide-slate-100">
        {data.notifications.map((notification) => {
          /**
           * Fall back rather than crash on an unrecognised criticality.
           *
           * These three lookups keyed on a vocabulary the API does not use, so
           * every real row resolved to `undefined` — and an undefined component
           * takes down the whole page with "Element type is invalid". A
           * notification the technician cannot classify is still a notification
           * worth showing, so an unknown value now reads as ordinary instead of
           * blanking the inbox.
           */
          const Icon = CRITICALITY_ICON[notification.criticality] ?? BellRing;
          const unread = !notification.read;

          return (
            <li
              key={notification.id}
              className={`flex items-start gap-3 px-4 py-4 lg:px-5 ${
                unread ? 'bg-brand/[0.03]' : ''
              }`}
            >
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  CRITICALITY_CHIP[notification.criticality] ?? CRITICALITY_CHIP.standard
                }`}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={2} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <p
                    className={`min-w-0 text-sm ${
                      unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'
                    }`}
                  >
                    {unread ? (
                      <span
                        className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-brand align-middle"
                        aria-hidden="true"
                      />
                    ) : null}
                    {notification.title}
                  </p>
                  <StatusPill tone={CRITICALITY_TONE[notification.criticality] ?? 'brand'}>
                    {t(`partner.notifications.criticality.${notification.criticality}`)}
                  </StatusPill>
                </div>

                <p
                  className={`mt-1 text-sm leading-relaxed ${
                    unread ? 'text-slate-700' : 'text-slate-500'
                  }`}
                >
                  {notification.body}
                </p>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-xs tabular-nums text-slate-400">
                    {timestamp(notification.createdAt)}
                  </span>
                  {unread ? (
                    <button
                      type="button"
                      onClick={() => markRead.mutate(notification.id)}
                      disabled={markRead.isPending}
                      className="-my-2 inline-flex min-h-touch items-center text-sm font-medium text-brand transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('partner.notifications.markRead')}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="px-4 pb-4 lg:px-5">
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={setPage}
        />
      </div>
    </Panel>
  );
}
