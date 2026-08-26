import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useMyBookings } from '@/surfaces/customer/data/bookings';
import { BookingListItem } from '@/surfaces/customer/components/bookings/BookingListItem';
import { IconWaiting, IconDone } from '@/surfaces/customer/components/bookings/BookingIcons';
import { ErrorState, Skeleton } from '@/components/ui';
import type { BookingStatus } from '@/surfaces/customer/data/types';

const ACTIVE_STATUSES = new Set<BookingStatus>([
  'REQUESTED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
]);

type Tab = 'active' | 'past';

/**
 * The shape a booking row takes, held while the list loads.
 *
 * A spinner here would be wrong twice over: this is the screen somebody opens
 * *because* a technician is on the way, so the wait is the most anxious moment
 * in the product, and a spinner that resolves into three rows makes the whole
 * page jump. Skeletons in the row's own shape keep the layout still and say
 * "your bookings are coming" rather than "something is happening".
 */
function BookingSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-shop-line bg-white py-3 pl-4 pr-3">
      <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="mt-1.5 h-3 w-1/3" />
        <Skeleton className="mt-1.5 h-2.5 w-1/4" />
      </div>
    </div>
  );
}

/**
 * `/app/bookings` — active vs past.
 *
 * ## Why this does not use `QueryState`
 *
 * `QueryState` renders one spinner and one generic `EmptyState` for the whole
 * query, and both are wrong here. The empty state depends on which tab is open
 * *and* on whether this customer has ever booked anything: a first-timer with
 * no bookings at all needs a way into the catalogue, not a grey box telling
 * them a filter matched nothing. So the three states are laid out by hand — the
 * error path still goes through the shared `ErrorState` with its request id.
 */
export default function Bookings() {
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>('active');
  const query = useMyBookings();

  const all = query.data?.bookings ?? [];
  const visible = all.filter((b) => (tab === 'active') === ACTIVE_STATUSES.has(b.status));
  const activeCount = all.filter((b) => ACTIVE_STATUSES.has(b.status)).length;
  const hasNoBookingsAtAll = query.status === 'success' && all.length === 0;

  return (
    <div className="flex w-full flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-shop-ink lg:text-[26px]">
          {t('app.bookings.title')}
        </h1>
        {/* Only when there is something live. A permanent counter that usually
            reads zero trains people to stop reading it. */}
        {activeCount > 0 ? (
          <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-shop">
            <span
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-shop"
              aria-hidden="true"
            />
            {t('app.bookings.activeCount', { count: activeCount })}
          </p>
        ) : null}
      </div>

      {/* A segmented control, not two buttons: the two tabs are one choice with
          two positions, and a filled pill in a tinted track shows which of the
          two you are in without needing to read either label. */}
      <div
        role="tablist"
        aria-label={t('app.bookings.title')}
        className="flex gap-1 rounded-xl bg-shop-soft/70 p-1"
      >
        {(['active', 'past'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`min-h-touch flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${
              tab === value
                ? 'bg-white text-shop shadow-sm'
                : 'text-shop-ink-soft hover:text-shop-ink'
            }`}
          >
            {t(`app.bookings.tab.${value}`)}
          </button>
        ))}
      </div>

      {query.status === 'pending' ? (
        <div className="flex flex-col gap-2.5" role="status" aria-label={t('app.bookings.loading')}>
          <BookingSkeleton />
          <BookingSkeleton />
          <BookingSkeleton />
        </div>
      ) : query.status === 'error' ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-shop-line px-5 py-9 text-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-shop-soft text-shop"
            aria-hidden="true"
          >
            {tab === 'active' ? (
              <IconWaiting className="h-6 w-6" />
            ) : (
              <IconDone className="h-6 w-6" />
            )}
          </span>
          <p className="text-[15px] font-semibold text-shop-ink">
            {hasNoBookingsAtAll ? t('app.bookings.empty') : t(`app.bookings.emptyTab.${tab}`)}
          </p>
          <p className="max-w-xs text-[13px] leading-relaxed text-shop-ink-soft">
            {hasNoBookingsAtAll
              ? t('app.bookings.emptyHint')
              : t(`app.bookings.emptyTabHint.${tab}`)}
          </p>
          {/*
            The nudge only appears where it is actually the next step. Somebody
            with a live job whose "past" tab is empty does not need to be sent
            shopping — that would read as the app having lost their booking.
          */}
          {hasNoBookingsAtAll || tab === 'active' ? (
            <Link
              to={buildLocalizedHref(locale, '/app')}
              className="min-h-touch mt-1 inline-flex items-center rounded-xl bg-shop px-5 text-sm font-semibold leading-[44px] text-shop-foreground transition-opacity hover:opacity-90"
            >
              {t('app.bookings.browseServices')}
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((booking) => (
            <BookingListItem key={booking.id} booking={booking} />
          ))}
        </div>
      )}
    </div>
  );
}
