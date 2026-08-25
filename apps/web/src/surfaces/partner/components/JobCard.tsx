import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Clock, MapPin, Timer, User } from 'lucide-react';
import { useT, useLocale } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { formatPaise } from '../../../lib/money';
import { StatusPill, type Tone } from './ui';
import { BOOKING_REQUEST_TTL_MINUTES } from '../lib/constants';
import type { BookingDetail, BookingStatus } from '../lib/types';

function secondsRemaining(createdAt: string): number {
  const deadline = new Date(createdAt).getTime() + BOOKING_REQUEST_TTL_MINUTES * 60 * 1000;
  return Math.max(0, Math.round((deadline - Date.now()) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Status → tone for every state a job card can be rendered in.
 *
 * One map rather than one per page: the inbox, the active list and the
 * history list all render the same statuses, and three separate mappings is
 * how "work done" ends up green on one screen and grey on another.
 */
const STATUS_TONE: Record<BookingStatus, Tone> = {
  REQUESTED: 'warning',
  ACCEPTED: 'brand',
  EN_ROUTE: 'brand',
  ARRIVED: 'brand',
  IN_PROGRESS: 'brand',
  WORK_DONE: 'success',
  REJECTED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED_BY_CUSTOMER: 'neutral',
  CANCELLED_BY_PROVIDER: 'danger',
  CLOSED_QUOTE_DECLINED: 'warning',
};

/**
 * How the card presents itself:
 *
 *   - `countdown` — a REQUESTED job in the inbox. The pill is the live
 *     time-left counter, because on this card the deadline is the single
 *     most decision-relevant fact and the status ("New request") is not.
 *   - `status` — anything else. The pill is the booking status.
 */
type Variant = 'countdown' | 'status';

/**
 * One job in a list — the inbox, the active strip, the history.
 *
 * Previously three pages each hand-rolled their own row and drifted apart:
 * the inbox showed a countdown but no customer, history showed money but no
 * address, the active strip showed neither. This is that row once, so a job
 * reads the same wherever it appears.
 */
export function JobCard({
  booking,
  variant = 'countdown',
}: {
  booking: BookingDetail;
  variant?: Variant;
}) {
  const t = useT();
  const locale = useLocale();
  const intlLocale = locale === 'hi' ? 'hi-IN' : 'en-IN';

  // The timer only exists for the countdown variant; a settled job in the
  // history list has no deadline to tick towards, and mounting an interval
  // per row there would be a wakeup a second for nothing.
  const [remaining, setRemaining] = useState(() => secondsRemaining(booking.createdAt));

  useEffect(() => {
    if (variant !== 'countdown') return;
    const timer = window.setInterval(() => setRemaining(secondsRemaining(booking.createdAt)), 1000);
    return () => window.clearInterval(timer);
  }, [booking.createdAt, variant]);

  const urgent = remaining < 120;

  return (
    <Link
      to={buildLocalizedHref(locale, `/partner/jobs/${booking.id}`)}
      className="group flex min-h-touch items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-150 hover:border-slate-300 hover:shadow-md active:bg-slate-50 lg:p-5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {variant === 'countdown' ? (
            <StatusPill tone={urgent ? 'danger' : 'warning'}>
              <Timer className="mr-1 h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
              {remaining > 0 ? formatCountdown(remaining) : t('partner.jobs.expiring')}
            </StatusPill>
          ) : (
            <StatusPill tone={STATUS_TONE[booking.status]}>
              {t(`partner.jobs.status.${booking.status}`)}
            </StatusPill>
          )}
          {booking.payablePaise !== null ? (
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {formatPaise(booking.payablePaise)}
            </span>
          ) : null}
        </div>

        <p
          className={`mt-2 truncate text-base font-semibold ${
            booking.problemNote ? 'text-slate-900' : 'text-muted'
          }`}
        >
          {booking.problemNote ?? t('partner.jobs.noProblemNote')}
        </p>

        <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">{t('partner.job.timeLabel')}</dt>
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={1.75} />
            <dd>
              {new Date(booking.startsAt).toLocaleString(intlLocale, {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </dd>
          </div>

          {booking.counterpart.name ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <dt className="sr-only">{t('partner.job.customerLabel')}</dt>
              <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={1.75} />
              <dd className="truncate">{booking.counterpart.name}</dd>
            </div>
          ) : null}

          {booking.address ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <dt className="sr-only">{t('partner.job.addressLabel')}</dt>
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={1.75} />
              <dd className="truncate">{booking.address.addressText}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <ChevronRight
        className="hidden h-5 w-5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-400 sm:block"
        aria-hidden="true"
        strokeWidth={2}
      />
    </Link>
  );
}
