import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, History, Wallet } from 'lucide-react';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { ErrorState } from '../../../components/ui';
import { formatPaise } from '../../../lib/money';
import { EmptyState, Grid, PageHeader, SkeletonRows, StatTile } from '../components/ui';
import { JobCard } from '../components/JobCard';
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

export default function JobHistory() {
  const t = useT();
  const locale = useLocale();

  const bookingsQuery = useQuery({
    queryKey: partnerKeys.bookings('provider'),
    queryFn: () => listMyBookings('provider'),
  });

  const past = (bookingsQuery.data?.bookings ?? [])
    .filter((b) => TERMINAL_STATUSES.includes(b.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Only completed work counts towards either figure. A rejected or expired
  // request is in this list but was never earnings, and counting it would
  // make this screen disagree with the earnings page.
  const completed = past.filter((b) => b.status === 'WORK_DONE');
  const earnedPaise = completed.reduce((sum, b) => sum + (b.payablePaise ?? 0), 0);

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title={t('partner.jobs.historyTitle')}
        description={t('partner.jobs.historyDescription')}
        action={
          <Link
            to={buildLocalizedHref(locale, '/partner/jobs')}
            className="inline-flex min-h-touch items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {t('partner.jobs.backToInbox')}
          </Link>
        }
      />

      {bookingsQuery.status === 'error' || (bookingsQuery.isSuccess && !bookingsQuery.data) ? (
        <ErrorState error={bookingsQuery.error} onRetry={() => bookingsQuery.refetch()} />
      ) : bookingsQuery.isPending ? (
        <SkeletonRows rows={4} />
      ) : past.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon={History}
            title={t('partner.jobs.historyEmpty')}
            description={t('partner.jobs.historyEmptyHint')}
            action={
              <Link
                to={buildLocalizedHref(locale, '/partner/jobs')}
                className="inline-flex min-h-touch items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-90"
              >
                {t('partner.jobs.backToInbox')}
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Grid cols={2}>
            <StatTile
              label={t('partner.jobs.completedCount')}
              value={completed.length}
              hint={t('partner.jobs.completedHint', { total: past.length })}
              icon={CheckCircle2}
              tone="success"
            />
            <StatTile
              label={t('partner.jobs.lifetimeEarned')}
              value={formatPaise(earnedPaise)}
              hint={t('partner.jobs.lifetimeEarnedHint')}
              icon={Wallet}
              tone="brand"
            />
          </Grid>

          <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {past.map((booking) => (
              <li key={booking.id} className="flex">
                <div className="w-full">
                  <JobCard booking={booking} variant="status" />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
