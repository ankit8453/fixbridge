import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { History, Inbox, Loader2, Wrench } from 'lucide-react';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { ErrorState } from '../../../components/ui';
import { EmptyState, Grid, PageHeader, SkeletonRows, StatTile } from '../components/ui';
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

  const bookings = bookingsQuery.data?.bookings ?? [];
  const requested = bookings.filter((b) => b.status === 'REQUESTED');
  const active = bookings.filter((b) => ACTIVE_STATUSES.includes(b.status));

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {/* The shell already prints "Jobs" in the top bar, so this header exists
          only for the description and the history link beside it. */}
      <PageHeader
        title={t('partner.jobs.title')}
        description={t('partner.jobs.inboxDescription')}
        action={
          <Link
            to={buildLocalizedHref(locale, '/partner/jobs/history')}
            className="inline-flex min-h-touch items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <History className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
            {t('partner.jobs.historyLink')}
          </Link>
        }
      />

      {/* Counts sit above the lists so the two numbers that decide what a
          technician does next are readable without scrolling either list. */}
      <Grid cols={2}>
        <StatTile
          label={t('partner.jobs.requestedSection')}
          value={bookingsQuery.isPending ? '—' : requested.length}
          icon={Inbox}
          tone={requested.length > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label={t('partner.jobs.activeSection')}
          value={bookingsQuery.isPending ? '—' : active.length}
          icon={Wrench}
          tone={active.length > 0 ? 'brand' : 'neutral'}
        />
      </Grid>

      {bookingsQuery.status === 'error' || (bookingsQuery.isSuccess && !bookingsQuery.data) ? (
        <ErrorState error={bookingsQuery.error} onRetry={() => bookingsQuery.refetch()} />
      ) : bookingsQuery.isPending ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          {active.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeading
                title={t('partner.jobs.activeSection')}
                count={active.length}
                busy={bookingsQuery.isFetching}
              />
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {active.map((booking) => (
                  <JobCard key={booking.id} booking={booking} variant="status" />
                ))}
              </div>
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <SectionHeading
              title={t('partner.jobs.requestedSection')}
              count={requested.length}
              busy={bookingsQuery.isFetching}
            />
            {requested.length === 0 ? (
              /* A blank space here used to be indistinguishable from a failed
                 load — the error branch above is now the only thing that can
                 render nothing. */
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <EmptyState
                  icon={Inbox}
                  title={t('partner.jobs.emptyInbox')}
                  description={t('partner.jobs.emptyInboxHint')}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {requested.map((booking) => (
                  <JobCard key={booking.id} booking={booking} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * A list heading with its count and a quiet spinner while the 20s poll is in
 * flight — the poll replaces a pull-to-refresh, so it needs to be visible
 * enough that a stale-looking list is obviously about to update.
 */
function SectionHeading({ title, count, busy }: { title: string; count: number; busy: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
        {count}
      </span>
      {busy ? (
        <Loader2
          className="h-3.5 w-3.5 animate-spin text-slate-400"
          aria-hidden="true"
          strokeWidth={2.5}
        />
      ) : null}
    </div>
  );
}
