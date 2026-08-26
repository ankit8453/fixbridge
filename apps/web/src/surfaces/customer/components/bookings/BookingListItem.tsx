import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { istDateLabel, istTime } from '@/surfaces/customer/data/ist-date';
import { BookingStatusIcon } from './BookingIcons';
import { statusTheme } from './status-theme';
import type { BookingDetail } from '@/surfaces/customer/data/types';

/**
 * One booking in the list.
 *
 * The status is the thing a customer is scanning for, so it is carried three
 * ways rather than one: a coloured rail down the leading edge (readable in
 * peripheral vision while the thumb is still moving), the status glyph in a
 * tinted chip, and the translated words. All three come from the single
 * `statusTheme` vocabulary so this card can never disagree with the detail
 * screen it opens — which is exactly what happened when this file owned its
 * own `STATUS_TONE` map and `BookingDetail` hardcoded `tone="info"`.
 *
 * A live job also gets a slow pulse on the rail. It is the only animation on
 * the page and it means one specific thing: somebody is on their way to you, or
 * already at your door, right now.
 */
export function BookingListItem({ booking }: { booking: BookingDetail }) {
  const t = useT();
  const locale = useLocale();
  const theme = statusTheme(booking.status);

  return (
    <Link
      to={buildLocalizedHref(locale, `/app/bookings/${booking.id}`)}
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-shop-line bg-white py-3 pl-4 pr-3 transition-colors hover:border-shop/30 active:bg-shop-soft/40"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${theme.rail} ${theme.live ? 'animate-pulse' : ''}`}
      />

      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${theme.chip} ${theme.ink}`}
      >
        <BookingStatusIcon status={booking.status} className="h-[21px] w-[21px]" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-[15px] font-bold leading-tight tracking-tight text-shop-ink">
            {booking.counterpart.name ?? t('app.find.unnamedProvider')}
          </span>
        </span>
        <span className={`mt-0.5 block text-[13px] font-semibold leading-tight ${theme.ink}`}>
          {t(`app.bookingStatus.${booking.status}`)}
        </span>
        <span className="mt-0.5 block text-xs text-shop-ink-soft">
          {istDateLabel(booking.startsAt)} · {istTime(booking.startsAt)}
        </span>
      </span>

      <ChevronRight
        className="h-4 w-4 shrink-0 text-shop-line transition-colors group-hover:text-shop"
        aria-hidden="true"
      />
    </Link>
  );
}
