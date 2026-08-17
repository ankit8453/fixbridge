'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/components/customer/data/notifications';
import { Badge, Button, Pagination, QueryState } from '@/components/ui';
import type { NotificationView } from '@/components/customer/data/types';

/** `deepLink` is `booking/{id}` | `search` | `wallet` | `trust` — only `booking/*` is relevant on this surface. */
function deepLinkHref(locale: Locale, deepLink: string | null): string | null {
  if (!deepLink) return null;
  if (deepLink.startsWith('booking/')) {
    return buildLocalizedHref(locale, `/app/bookings/${deepLink.slice('booking/'.length)}`);
  }
  if (deepLink === 'search') return buildLocalizedHref(locale, '/app');
  return null;
}

export function NotificationList() {
  const t = useT();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const query = useNotifications(page, false);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  return (
    <QueryState
      status={query.status}
      error={query.error}
      data={query.data}
      loadingLabel={t('common.loading')}
      empty={{ title: t('app.notifications.empty') }}
      isEmpty={(data) => data.notifications.length === 0}
      onRetry={() => void query.refetch()}
    >
      {(data) => (
        <div className="flex flex-col gap-3">
          {data.unread > 0 ? (
            <Button
              variant="secondary"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {t('app.notifications.markAllRead')}
            </Button>
          ) : null}

          {data.notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              href={deepLinkHref(locale, notification.deepLink)}
              onOpen={() => {
                if (!notification.read) markRead.mutate(notification.id);
              }}
            />
          ))}

          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={setPage}
          />
        </div>
      )}
    </QueryState>
  );
}

function NotificationRow({
  notification,
  href,
  onOpen,
}: {
  notification: NotificationView;
  href: string | null;
  onOpen: () => void;
}) {
  const t = useT();

  const body = (
    <div
      className={`rounded-xl border p-3 ${
        notification.read ? 'border-slate-200 bg-white' : 'border-brand bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{notification.title}</p>
        {!notification.read ? (
          <Badge tone="info">{t('app.notifications.unreadBadge')}</Badge>
        ) : null}
      </div>
      <p className="mt-0.5 text-sm text-slate-700">{notification.body}</p>
      <p className="mt-1 text-xs text-slate-400">
        {new Date(notification.createdAt).toLocaleString(undefined, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </div>
  );

  if (href) {
    return (
      <Link href={href} onClick={onOpen}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onOpen} className="text-left">
      {body}
    </button>
  );
}
