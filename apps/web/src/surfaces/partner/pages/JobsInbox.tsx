import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { QueryState, StatusPill } from '../../../components/ui';
import { JobCard } from '../components/JobCard';
import { listMyBookings } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import type { BookingStatus } from '../lib/types';

const ACTIVE_STATUSES: BookingStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];

/** The REQUESTED inbox plus any job already in flight. */
export default function JobsInbox() {
  const t = useT();
  const locale = useLocale();

  const bookingsQuery = useQuery({
    queryKey: partnerKeys.bookings('provider'),
    queryFn: () => listMyBookings('provider'),
    refetchInterval: 20_000, // a new request landing is worth noticing without a manual pull-to-refresh
  });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">{t('partner.jobs.title')}</h1>
        <Link
          to={buildLocalizedHref(locale, '/partner/jobs/history')}
          className="min-h-touch text-sm font-medium text-brand"
        >
          {t('partner.jobs.historyLink')}
        </Link>
      </div>

      <QueryState
        status={bookingsQuery.status}
        error={bookingsQuery.error}
        data={bookingsQuery.data}
        onRetry={() => bookingsQuery.refetch()}
      >
        {({ bookings }) => {
          const requested = bookings.filter((b) => b.status === 'REQUESTED');
          const active = bookings.filter((b) => ACTIVE_STATUSES.includes(b.status));

          return (
            <>
              {active.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-slate-600">
                    {t('partner.jobs.activeSection')}
                  </h2>
                  {active.map((booking) => (
                    <Link
                      key={booking.id}
                      to={buildLocalizedHref(locale, `/partner/jobs/${booking.id}`)}
                      className="flex min-h-touch items-center justify-between gap-2 rounded-xl border border-brand bg-white p-4 transition-colors duration-150 active:bg-slate-50"
                    >
                      <span className="text-base font-medium text-slate-900">
                        {booking.problemNote ?? t('partner.jobs.noProblemNote')}
                      </span>
                      <StatusPill tone="info">
                        {t(`partner.jobs.status.${booking.status}`)}
                      </StatusPill>
                    </Link>
                  ))}
                </section>
              ) : null}

              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-slate-600">
                  {t('partner.jobs.requestedSection')}
                </h2>
                {requested.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-muted">
                    {t('partner.jobs.emptyInbox')}
                  </p>
                ) : (
                  requested.map((booking) => <JobCard key={booking.id} booking={booking} />)
                )}
              </section>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
