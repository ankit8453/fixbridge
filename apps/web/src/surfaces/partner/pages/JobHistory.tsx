import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { QueryState, StatusPill, type Tone } from '../../../components/ui';
import { formatPaise } from '../../../lib/money';
import { listMyBookings } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { BookingStatus } from '../lib/types';

const TERMINAL_STATUSES: BookingStatus[] = [
  'WORK_DONE',
  'REJECTED',
  'EXPIRED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'CLOSED_QUOTE_DECLINED',
];

const STATUS_TONE: Partial<Record<BookingStatus, Tone>> = {
  WORK_DONE: 'success',
  REJECTED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED_BY_CUSTOMER: 'neutral',
  CANCELLED_BY_PROVIDER: 'danger',
  CLOSED_QUOTE_DECLINED: 'warning',
};

export default function JobHistory() {
  const t = useT();
  const locale = useLocale();

  const bookingsQuery = useQuery({
    queryKey: partnerKeys.bookings('provider'),
    queryFn: () => listMyBookings('provider'),
  });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.jobs.historyTitle')}</h1>

      <QueryState
        status={bookingsQuery.status}
        error={bookingsQuery.error}
        data={bookingsQuery.data}
        onRetry={() => bookingsQuery.refetch()}
        empty={{ title: t('partner.jobs.historyEmpty') }}
        isEmpty={({ bookings }) =>
          bookings.filter((b) => TERMINAL_STATUSES.includes(b.status)).length === 0
        }
      >
        {({ bookings }) => {
          const past = bookings
            .filter((b) => TERMINAL_STATUSES.includes(b.status))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

          return (
            <ul className="flex flex-col gap-2">
              {past.map((booking) => (
                <li key={booking.id}>
                  <Link
                    to={buildLocalizedHref(locale, `/partner/jobs/${booking.id}`)}
                    className="flex min-h-touch items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 transition-colors duration-150 active:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-slate-900">
                        {booking.problemNote ?? t('partner.jobs.noProblemNote')}
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(booking.startsAt).toLocaleDateString(
                          locale === 'hi' ? 'hi-IN' : 'en-IN',
                        )}
                        {booking.payablePaise !== null
                          ? ` · ${formatPaise(booking.payablePaise)}`
                          : ''}
                      </p>
                    </div>
                    <StatusPill tone={STATUS_TONE[booking.status] ?? 'neutral'}>
                      {t(`partner.jobs.status.${booking.status}`)}
                    </StatusPill>
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </div>
  );
}
