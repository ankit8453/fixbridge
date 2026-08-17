import { useQuery } from '@tanstack/react-query';
import { fetchSummary } from '../lib/api';
import type { AdminSummary } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import { ToneStatTile } from '../components/ToneStatTile';
import { Card, QueryState } from '@/components/ui';
import { formatPaise } from '@/lib/money';

/**
 * The "what needs my attention" wall. Ported from
 * `legacy-next-src/app/[locale]/admin/page.tsx`.
 *
 * Queues first, money last, and every queue depth is a link to the list
 * behind it. A dashboard that opens on last month's GMV is a dashboard ops
 * close and never reopen — the number that matters at 9am is how many
 * people are waiting.
 */
export default function OverviewPage() {
  const query = useQuery({ queryKey: ['admin', 'summary'], queryFn: fetchSummary });

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          query.data ? undefined : 'Queue depths, today’s bookings and the platform position.'
        }
      />

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading the queue depths…"
        onRetry={() => void query.refetch()}
      >
        {(summary) => <Summary summary={summary} />}
      </QueryState>
    </>
  );
}

function Summary({ summary }: { summary: AdminSummary }) {
  const { queues, bookings, money } = summary;

  /**
   * Tone is a judgement about consequence, not size.
   *
   * A parked webhook means money the ledger has not heard about, so one is
   * already red. A pending verification is somebody waiting, which is amber
   * until it is a pile.
   */
  const tiles = [
    {
      label: 'Verification pending',
      value: queues.verificationPending,
      href: '/admin/verification',
      tone: queues.verificationPending > 0 ? ('warn' as const) : ('neutral' as const),
      hint: 'Cases submitted or in review',
    },
    {
      label: 'Open complaints',
      value: queues.complaintsOpen,
      href: '/admin/complaints',
      tone: queues.complaintsOpen > 0 ? ('alert' as const) : ('neutral' as const),
    },
    {
      label: 'Review reports',
      value: queues.reviewReports,
      href: '/admin/reviews',
      tone: queues.reviewReports > 0 ? ('warn' as const) : ('neutral' as const),
    },
    {
      label: 'OTP-locked bookings',
      value: queues.otpLockedBookings,
      href: '/admin/bookings',
      tone: queues.otpLockedBookings > 0 ? ('alert' as const) : ('neutral' as const),
      hint: 'A technician is at a door and cannot start',
    },
    {
      label: 'Parked outbox',
      value: queues.parkedOutbox,
      href: '/admin/queues',
      tone: queues.parkedOutbox > 0 ? ('alert' as const) : ('neutral' as const),
    },
    {
      label: 'Parked webhooks',
      value: queues.parkedWebhooks,
      href: '/admin/queues',
      tone: queues.parkedWebhooks > 0 ? ('alert' as const) : ('neutral' as const),
      hint: 'Gateway events the ledger never saw',
    },
    {
      label: 'Parked deliveries',
      value: queues.parkedDeliveries,
      href: '/admin/queues',
      tone: queues.parkedDeliveries > 0 ? ('warn' as const) : ('neutral' as const),
    },
    {
      label: 'Held for quiet hours',
      value: queues.heldDeliveries,
      href: '/admin/queues',
      hint: 'Waiting, not failed',
    },
    {
      label: 'Pending payout batches',
      value: queues.pendingBatches,
      href: '/admin/money',
      tone: queues.pendingBatches > 0 ? ('warn' as const) : ('neutral' as const),
    },
    {
      label: 'Suspended technicians',
      value: queues.suspendedProviders,
      href: '/admin/providers?suspended=true',
      tone: queues.suspendedProviders > 0 ? ('warn' as const) : ('neutral' as const),
    },
    {
      label: 'Pending entry approvals',
      value: queues.pendingEntryApproval,
      href: '/admin/providers?pending_approval=true',
      tone: queues.pendingEntryApproval > 0 ? ('warn' as const) : ('neutral' as const),
    },
  ];

  const statuses = Object.entries(bookings.today).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Queues</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <ToneStatTile key={tile.label} {...tile} />
          ))}
        </div>
      </section>

      <Card title={`Bookings in the last 24 hours — ${bookings.todayTotal} total`}>
        {statuses.length === 0 ? (
          <p className="text-sm text-muted">No bookings were created in the last 24 hours.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {statuses.map(([status, count]) => (
              <li
                key={status}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1"
              >
                <StatusBadge status={status} />
                <span className="text-sm font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Money</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ToneStatTile label="GMV today" value={formatPaise(money.gmvTodayPaise)} />
          <ToneStatTile label="GMV 7 days" value={formatPaise(money.gmv7dPaise)} />
          <ToneStatTile label="GMV 30 days" value={formatPaise(money.gmv30dPaise)} />
          <ToneStatTile
            label="Revenue (commission)"
            value={formatPaise(money.revenuePaise)}
            href="/admin/money"
          />
          <ToneStatTile label="Held at the gateway" value={formatPaise(money.gatewayCashPaise)} />
          <ToneStatTile
            label="Owed to technicians"
            value={formatPaise(money.owedToProvidersPaise)}
            href="/admin/money"
            hint="Payable, before the next batch"
          />
          <ToneStatTile
            label="Owed by technicians"
            value={formatPaise(money.owedByProvidersPaise)}
            href="/admin/money"
            hint="Commission on cash jobs"
          />
        </div>
      </section>

      <p className="text-xs text-muted">
        Generated <Timestamp value={summary.generatedAt} />. Nothing on this page is cached
        server-side.
      </p>
    </div>
  );
}
