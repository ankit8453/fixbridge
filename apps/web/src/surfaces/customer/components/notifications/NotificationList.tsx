import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/surfaces/customer/data/notifications';
import { ErrorState, Pagination } from '@/components/ui';
import type { NotificationView } from '@/surfaces/customer/data/types';
import { BellIcon, PageHeading, RowSkeleton, ShopButton } from './shopUi';

/** `deepLink` is `booking/{id}` | `search` | `wallet` | `trust` — only `booking/*` is relevant on this surface. */
function deepLinkHref(locale: Locale, deepLink: string | null): string | null {
  if (!deepLink) return null;
  if (deepLink.startsWith('booking/')) {
    return buildLocalizedHref(locale, `/app/bookings/${deepLink.slice('booking/'.length)}`);
  }
  if (deepLink === 'search') return buildLocalizedHref(locale, '/app');
  return null;
}

type Bucket = 'today' | 'yesterday' | 'earlier';

/**
 * Bucket by calendar day rather than by elapsed hours: a message at 11pm and
 * one at 1am are two hours apart but belong to different days as far as a
 * reader is concerned, and "today" is the label they will check against.
 */
function bucketOf(createdAt: string, now: Date): Bucket {
  const then = new Date(createdAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thenTime = then.getTime();

  if (thenTime >= startOfToday) return 'today';
  if (thenTime >= startOfToday - 86_400_000) return 'yesterday';
  return 'earlier';
}

const BUCKET_ORDER: Bucket[] = ['today', 'yesterday', 'earlier'];

/**
 * The alerts list.
 *
 * ## Unread emphasis is not carried by colour alone
 *
 * The previous row said "unread" with a tinted border and a blue badge —
 * both colour-only signals, invisible to a colour-blind reader and to anyone
 * on a washed-out phone screen in daylight. An unread row now also carries a
 * filled dot in the gutter and sets its title in bold; a read row's title
 * drops to medium weight and the dot's slot is held empty so the text stays
 * aligned down the column.
 *
 * Ported from `legacy-next-src/components/customer/notifications/NotificationList.tsx`.
 */
export function NotificationList({ title }: { title: string }) {
  const t = useT();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const query = useNotifications(page, false);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const data = query.data;
  const unread = data?.unread ?? 0;

  const header = (
    <PageHeading
      trailing={
        unread > 0 ? (
          <ShopButton
            tone="quiet"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            {markAllRead.isPending ? t('common.loading') : t('app.notifications.markAllRead')}
          </ShopButton>
        ) : null
      }
    >
      <span className="inline-flex items-center gap-2">
        {title}
        {unread > 0 ? (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-shop px-1.5 text-[11px] font-bold leading-none text-shop-foreground">
            <span className="sr-only">{t('app.notifications.unreadCountLabel')}: </span>
            {unread}
          </span>
        ) : null}
      </span>
    </PageHeading>
  );

  // Loading and error are rendered under the real heading rather than in
  // place of it, so the page never flashes an untitled screen.
  let body: React.ReactNode;

  if (query.status === 'pending') {
    body = <RowSkeleton rows={4} />;
  } else if (query.status === 'error' || !data) {
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else if (data.notifications.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-shop-line bg-white/60 px-4 py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-shop-soft text-shop">
          <BellIcon className="h-6 w-6" />
        </span>
        <p className="text-[15px] font-semibold text-shop-ink">{t('app.notifications.empty')}</p>
        <p className="max-w-xs text-[13px] text-shop-ink-soft">
          {t('app.notifications.emptyHint')}
        </p>
      </div>
    );
  } else {
    const now = new Date();
    const grouped = new Map<Bucket, NotificationView[]>();
    for (const notification of data.notifications) {
      const bucket = bucketOf(notification.createdAt, now);
      const list = grouped.get(bucket);
      if (list) list.push(notification);
      else grouped.set(bucket, [notification]);
    }

    body = (
      <div className="flex flex-col gap-4">
        {BUCKET_ORDER.filter((bucket) => grouped.has(bucket)).map((bucket) => (
          <section key={bucket}>
            <h2 className="mb-1.5 px-0.5 text-[11px] font-bold uppercase tracking-wide text-shop-ink-soft">
              {t(`app.notifications.group.${bucket}`)}
            </h2>
            <ul className="divide-y divide-shop-line overflow-hidden rounded-2xl border border-shop-line bg-white shadow-sm">
              {grouped.get(bucket)!.map((notification) => (
                <li key={notification.id}>
                  <NotificationRow
                    notification={notification}
                    withDate={bucket === 'earlier'}
                    href={deepLinkHref(locale, notification.deepLink)}
                    onOpen={() => {
                      if (!notification.read) markRead.mutate(notification.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={setPage}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {header}
      {body}
    </div>
  );
}

function NotificationRow({
  notification,
  withDate,
  href,
  onOpen,
}: {
  notification: NotificationView;
  /** Rows under "Earlier" need the day too — a bare clock time there is ambiguous. */
  withDate: boolean;
  href: string | null;
  onOpen: () => void;
}) {
  const t = useT();
  const unread = !notification.read;

  const inner = (
    <>
      {/* The gutter dot. Read rows keep the slot so titles stay on one column. */}
      <span className="flex w-2.5 shrink-0 justify-center pt-[7px]" aria-hidden="true">
        {unread ? <span className="h-2.5 w-2.5 rounded-full bg-shop" /> : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 text-[15px] leading-snug ${
              unread ? 'font-bold text-shop-ink' : 'font-medium text-shop-ink-soft'
            }`}
          >
            {unread ? (
              <span className="sr-only">{t('app.notifications.unreadBadge')}: </span>
            ) : null}
            {notification.title}
          </span>
          <time
            dateTime={notification.createdAt}
            className="shrink-0 text-[11.5px] font-medium text-shop-ink-soft"
          >
            {new Date(notification.createdAt).toLocaleString(
              undefined,
              withDate
                ? { day: 'numeric', month: 'short' }
                : { hour: '2-digit', minute: '2-digit' },
            )}
          </time>
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-shop-ink-soft">
          {notification.body}
        </span>
      </span>

      {href ? (
        <ChevronRight
          className="mt-0.5 h-4 w-4 shrink-0 self-center text-shop-ink-soft"
          aria-hidden="true"
          strokeWidth={2.25}
        />
      ) : null}
    </>
  );

  const rowClass = `flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-shop-soft/50 ${
    unread ? 'bg-shop-soft/35' : ''
  }`;

  if (href) {
    return (
      <Link to={href} onClick={onOpen} className={rowClass}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onOpen} className={rowClass}>
      {inner}
    </button>
  );
}
