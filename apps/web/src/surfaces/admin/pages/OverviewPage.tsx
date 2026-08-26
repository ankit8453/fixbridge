import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Ban,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Clock,
  Inbox,
  KeyRound,
  MessageSquareWarning,
  Moon,
  RefreshCw,
  ShieldCheck,
  Star,
  TrendingUp,
  UserPlus,
  Wallet,
  Webhook,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { fetchSummary } from '../lib/api';
import type { AdminSummary } from '../lib/types';
import { Timestamp } from '../components/Timestamp';
import { Card, Grid, Pill, SectionHeader, StatTile, type Tone } from '../components/ui';
import { QueryState } from '@/components/ui';
import { formatPaise } from '@/lib/money';

/**
 * The console's front door.
 *
 * The question this screen answers is "what needs a human today", and it has
 * three seconds to answer it. So the ordering is by consequence, not by
 * source: the work queues that block a person come first, the money position
 * second, today's booking mix last. `AdminShell` already renders the page
 * title, so there is deliberately no `<h1>`/`PageHeader` here.
 */
export default function OverviewPage() {
  const query = useQuery({ queryKey: ['admin', 'summary'], queryFn: fetchSummary });

  return (
    <QueryState
      status={query.status}
      error={query.error}
      data={query.data}
      loadingLabel="Loading the queue depths…"
      onRetry={() => void query.refetch()}
    >
      {(summary) => <Summary summary={summary} />}
    </QueryState>
  );
}

/* -------------------------------------------------------------------------- */
/* Queue model                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A queue's tone is a judgement about consequence, not about size.
 *
 * `danger` means somebody or something is stuck right now — a technician at a
 * door who cannot start, a gateway event the ledger never saw. `warning` is a
 * pile that will become a problem if nobody works it. `neutral` at zero, always:
 * an empty queue is good news and should look calm rather than green-shouting.
 */
interface QueueEntry {
  label: string;
  value: number;
  href: string;
  icon: ComponentType<LucideProps>;
  /** The tone used when the count is above zero. */
  hot: Tone;
  hint?: string;
}

function queueEntries(queues: AdminSummary['queues']): QueueEntry[] {
  return [
    {
      label: 'Verification pending',
      value: queues.verificationPending,
      href: '/admin/verification',
      icon: ShieldCheck,
      hot: 'warning',
      hint: 'Cases submitted or in review',
    },
    {
      label: 'OTP-locked bookings',
      value: queues.otpLockedBookings,
      href: '/admin/bookings',
      icon: KeyRound,
      hot: 'danger',
      hint: 'A technician is at a door and cannot start',
    },
    {
      label: 'Parked webhooks',
      value: queues.parkedWebhooks,
      href: '/admin/queues',
      icon: Webhook,
      hot: 'danger',
      hint: 'Gateway events the ledger never saw',
    },
    {
      label: 'Open complaints',
      value: queues.complaintsOpen,
      href: '/admin/complaints',
      icon: MessageSquareWarning,
      hot: 'danger',
    },
    {
      label: 'Parked outbox',
      value: queues.parkedOutbox,
      href: '/admin/queues',
      icon: Inbox,
      hot: 'danger',
      hint: 'Published events nobody consumed',
    },
    {
      label: 'Parked deliveries',
      value: queues.parkedDeliveries,
      href: '/admin/queues',
      icon: RefreshCw,
      hot: 'warning',
      hint: 'Messages that never reached a transport',
    },
    {
      label: 'Review reports',
      value: queues.reviewReports,
      href: '/admin/reviews',
      icon: Star,
      hot: 'warning',
    },
    {
      label: 'Pending payout batches',
      value: queues.pendingBatches,
      href: '/admin/money',
      icon: Banknote,
      hot: 'warning',
    },
    {
      label: 'Suspended technicians',
      value: queues.suspendedProviders,
      href: '/admin/providers?suspended=true',
      icon: Ban,
      hot: 'warning',
    },
    {
      label: 'Pending entry approvals',
      value: queues.pendingEntryApproval,
      href: '/admin/providers?pending_approval=true',
      icon: UserPlus,
      hot: 'warning',
    },
    {
      label: 'Held for quiet hours',
      value: queues.heldDeliveries,
      href: '/admin/queues',
      icon: Moon,
      // Waiting is not failing — this one never turns red however tall it gets.
      hot: 'info',
      hint: 'Waiting, not failed',
    },
  ];
}

const TONE_ROW: Record<Tone, { bar: string; chip: string; icon: string }> = {
  neutral: { bar: 'bg-slate-200', chip: 'bg-slate-100 text-slate-600', icon: 'text-slate-400' },
  admin: { bar: 'bg-admin', chip: 'bg-admin-soft text-admin', icon: 'text-admin' },
  success: { bar: 'bg-success', chip: 'bg-success/10 text-success', icon: 'text-success' },
  warning: { bar: 'bg-warning', chip: 'bg-warning/10 text-warning', icon: 'text-warning' },
  danger: { bar: 'bg-danger', chip: 'bg-danger/10 text-danger', icon: 'text-danger' },
  info: { bar: 'bg-admin-alt', chip: 'bg-admin-alt/10 text-admin-alt', icon: 'text-admin-alt' },
};

/* -------------------------------------------------------------------------- */
/* Inline SVG                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * GMV as three cumulative windows, drawn as a bar per window.
 *
 * Deliberately NOT a trend line: the API returns three overlapping totals
 * (today, 7d, 30d), not a daily series, and interpolating a "daily velocity"
 * curve out of them — which the previous version of this screen did — invents
 * data points that were never measured. Three bars compared against the widest
 * window is the honest shape of what is actually known.
 */
function GmvWindows({ today, d7, d30 }: { today: number; d7: number; d30: number }) {
  const rows = [
    { label: 'Today', value: today },
    { label: 'Last 7 days', value: d7 },
    { label: 'Last 30 days', value: d30 },
  ];
  const max = Math.max(today, d7, d30, 1);

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const share = Math.max(row.value <= 0 ? 0 : 0.015, row.value / max);
        return (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {row.label}
              </span>
              <span className="text-[13px] font-semibold tabular-nums text-slate-900">
                {formatPaise(row.value)}
              </span>
            </div>
            {/* Decorative: every value it encodes is printed as text above it. */}
            <div
              aria-hidden="true"
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className="h-full rounded-full bg-admin"
                style={{ width: `${(share * 100).toFixed(2)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Today's bookings as a ring, sliced by status.
 *
 * A donut is the right shape here because the question is a mix — "how much of
 * today is already done versus still moving versus gone wrong" — and a mix is
 * what a ring reads out at a glance. The legend below carries every number as
 * text, so the ring itself is `aria-hidden`.
 */
function BookingRing({ slices, total }: { slices: BookingSlice[]; total: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  let consumed = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-[132px] w-[132px] shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            className="stroke-slate-100"
            strokeWidth="12"
          />
          {slices.map((slice) => {
            const length = (slice.value / total) * circumference;
            const offset = -consumed;
            consumed += length;
            return (
              <circle
                key={slice.label}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                strokeWidth="12"
                className={slice.stroke}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={offset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[26px] font-semibold leading-none tabular-nums tracking-tight text-slate-900">
            {total}
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Bookings
          </span>
        </div>
      </div>

      <ul className="grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-baseline gap-2 text-[13px]">
            <span
              aria-hidden="true"
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${slice.dot}`}
            />
            <span className="min-w-0 flex-1 truncate text-slate-600">{slice.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BookingSlice {
  label: string;
  value: number;
  stroke: string;
  dot: string;
}

/**
 * Booking statuses coloured by what they mean to ops, mirroring
 * `StatusBadge`'s mapping — an unrecognised status stays slate rather than
 * being guessed at, because a wrong colour is worse than none.
 */
function sliceStyle(status: string): { stroke: string; dot: string } {
  if (/failed|cancelled|suspended|blocked|severe|expired|parked/i.test(status))
    return { stroke: 'stroke-danger', dot: 'bg-danger' };
  if (/passed|paid|captured|resolved|completed|settled|active|published|work_done/i.test(status))
    return { stroke: 'stroke-success', dot: 'bg-success' };
  if (/pending|submitted|in_review|needs_info|queued|draft|held|processing|requested/i.test(status))
    return { stroke: 'stroke-warning', dot: 'bg-warning' };
  if (/accepted|en_route|arrived|in_progress/i.test(status))
    return { stroke: 'stroke-admin', dot: 'bg-admin' };
  return { stroke: 'stroke-slate-300', dot: 'bg-slate-300' };
}

/* -------------------------------------------------------------------------- */
/* Page body                                                                  */
/* -------------------------------------------------------------------------- */

function Summary({ summary }: { summary: AdminSummary }) {
  const { queues, bookings, money } = summary;

  const entries = queueEntries(queues);

  // Sorted by what is on fire, then by depth — an ops user works this list top
  // down, and the top of it should be the thing that costs the most to ignore.
  const severity: Record<Tone, number> = {
    danger: 0,
    warning: 1,
    admin: 2,
    info: 2,
    success: 3,
    neutral: 4,
  };
  const needsAttention = entries
    .filter((entry) => entry.value > 0)
    .sort((a, b) => severity[a.hot] - severity[b.hot] || b.value - a.value);

  const clear = entries.filter((entry) => entry.value === 0);

  const blocking = entries
    .filter((entry) => entry.hot === 'danger' && entry.value > 0)
    .reduce((sum, entry) => sum + entry.value, 0);

  const waiting = entries
    .filter((entry) => entry.hot === 'warning' && entry.value > 0)
    .reduce((sum, entry) => sum + entry.value, 0);

  const slices = Object.entries(bookings.today)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ label: status, value: count, ...sliceStyle(status) }));

  const ringTotal = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div className="space-y-6">
      {/* ------------------------------ Stat row ------------------------------ */}
      <section>
        <Grid cols={4}>
          <StatTile
            label="Blocking now"
            value={blocking}
            hint={
              blocking === 0
                ? 'Nothing is stuck on a human'
                : 'Somebody or some money is waiting on ops'
            }
            icon={AlertTriangle}
            tone={blocking > 0 ? 'danger' : 'success'}
          />
          <StatTile
            label="Waiting for review"
            value={waiting}
            hint="Piles that grow if nobody works them"
            icon={Clock}
            tone={waiting > 0 ? 'warning' : 'success'}
          />
          <StatTile
            label="Bookings today"
            value={bookings.todayTotal}
            hint={`GMV ${formatPaise(money.gmvTodayPaise)}`}
            icon={CalendarClock}
            tone="admin"
          />
          <StatTile
            label="Revenue (commission)"
            value={formatPaise(money.revenuePaise)}
            hint="Platform take, all time"
            icon={TrendingUp}
            tone="info"
          />
        </Grid>
      </section>

      {/* --------------------------- Attention queues -------------------------- */}
      <section>
        <SectionHeader
          title="Needs attention"
          description="Ordered by consequence, then by depth. Everything here is somebody waiting."
          action={
            <Pill tone={needsAttention.length > 0 ? 'warning' : 'success'}>
              {needsAttention.length} of {entries.length} queues open
            </Pill>
          }
        />

        {needsAttention.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-success/10">
                <CheckCircle2
                  className="h-5 w-5 text-success"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
              </span>
              <p className="text-sm font-semibold text-slate-900">Every queue is empty.</p>
              <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">
                Nothing is waiting on a human right now — no cases, no complaints, no parked events.
                That is the good outcome, not a broken screen.
              </p>
            </div>
          </Card>
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-slate-100">
              {needsAttention.map((entry) => {
                const style = TONE_ROW[entry.hot];
                const Icon = entry.icon;
                return (
                  <li key={entry.label}>
                    <Link
                      to={entry.href}
                      className="group flex min-h-touch items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                    >
                      <span
                        aria-hidden="true"
                        className={`h-8 w-0.5 shrink-0 rounded-full ${style.bar}`}
                      />
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.chip}`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-slate-900">
                          {entry.label}
                        </span>
                        {entry.hint ? (
                          <span className="block truncate text-xs text-slate-500">
                            {entry.hint}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-lg font-semibold tabular-nums tracking-tight text-slate-900">
                        {entry.value}
                      </span>
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-admin"
                        aria-hidden="true"
                        strokeWidth={2}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>

            {clear.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                  Clear
                </span>
                {clear.map((entry) => (
                  <span key={entry.label} className="text-[11px] text-slate-500">
                    {entry.label}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        )}
      </section>

      {/* ------------------------------- Money -------------------------------- */}
      <section>
        <SectionHeader
          title="Platform position"
          description="Every figure is a sum of ledger entries in paise. No balance is stored."
        />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card title="Gross merchandise value" className="lg:col-span-1">
            <GmvWindows today={money.gmvTodayPaise} d7={money.gmv7dPaise} d30={money.gmv30dPaise} />
          </Card>

          <Card title="Today's bookings by status" className="lg:col-span-2">
            {ringTotal === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
                  <CalendarClock
                    className="h-5 w-5 text-slate-400"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                </span>
                <p className="text-sm font-semibold text-slate-900">No bookings yet today.</p>
                <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">
                  Nothing has been booked in the last twenty-four hours.
                </p>
              </div>
            ) : (
              <BookingRing slices={slices} total={ringTotal} />
            )}
          </Card>
        </div>

        <div className="mt-3">
          <Grid cols={4}>
            <StatTile
              label="Held at the gateway"
              value={formatPaise(money.gatewayCashPaise)}
              hint="Captured, not yet settled out"
              icon={Wallet}
              tone="info"
            />
            <StatTile
              label="Owed to technicians"
              value={formatPaise(money.owedToProvidersPaise)}
              hint="Payable, before the next batch"
              icon={Banknote}
              tone="admin"
            />
            <StatTile
              label="Owed by technicians"
              value={formatPaise(money.owedByProvidersPaise)}
              hint="Commission on cash jobs"
              icon={BadgeCheck}
              tone={money.owedByProvidersPaise > 0 ? 'warning' : 'neutral'}
            />
            <StatTile
              label="GMV last 30 days"
              value={formatPaise(money.gmv30dPaise)}
              hint={`${formatPaise(money.gmv7dPaise)} in the last 7`}
              icon={TrendingUp}
              tone="neutral"
            />
          </Grid>
        </div>
      </section>

      <p className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <RefreshCw className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" strokeWidth={2} />
        Generated <Timestamp value={summary.generatedAt} /> — read live, never cached.
      </p>
    </div>
  );
}
