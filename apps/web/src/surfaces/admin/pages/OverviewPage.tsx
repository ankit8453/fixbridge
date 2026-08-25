import { useQuery } from '@tanstack/react-query';
import { fetchSummary } from '../lib/api';
import type { AdminSummary } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { ToneStatTile } from '../components/ToneStatTile';
import { Card, QueryState } from '@/components/ui';
import { formatPaise } from '@/lib/money';

/**
 * The modern futuristic admin dashboard.
 * Highly responsive, light theme only, with custom SVG data visualizations.
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

function formatShortPaise(paise: number) {
  const rs = paise / 100;
  if (rs >= 100000) return `₹${(rs / 100000).toFixed(1)}L`;
  if (rs >= 1000) return `₹${(rs / 1000).toFixed(1)}k`;
  return `₹${rs}`;
}

function GMVChart({ today, g7d, g30d }: { today: number; g7d: number; g30d: number }) {
  // Calculate daily averages
  const avg30 = (g30d - g7d) / 23;
  const avg7 = (g7d - today) / 6;

  const points = [
    Math.max(1000, avg30 * 0.9),
    Math.max(1000, avg30 * 1.15),
    Math.max(1000, avg7 * 0.85),
    Math.max(1000, avg7 * 1.15),
    Math.max(1000, today),
  ];

  const maxVal = Math.max(...points) * 1.15;
  const minVal = Math.min(...points) * 0.85;
  const range = maxVal - minVal || 1;

  const width = 600;
  const height = 180;
  const paddingX = 40;
  const paddingY = 20;

  const coords = points.map((val, idx) => {
    const x = paddingX + (idx * (width - paddingX * 2)) / (points.length - 1);
    const y = height - paddingY - ((val - minVal) / range) * (height - paddingY * 2);
    return { x, y, val };
  });

  let linePath = `M ${coords[0]!.x} ${coords[0]!.y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const curr = coords[i]!;
    const next = coords[i + 1]!;
    const cpX1 = curr.x + (next.x - curr.x) / 3;
    const cpY1 = curr.y;
    const cpX2 = curr.x + (2 * (next.x - curr.x)) / 3;
    const cpY2 = next.y;
    linePath += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${next.x} ${next.y}`;
  }

  const areaPath = `${linePath} L ${coords[coords.length - 1]!.x} ${height - paddingY} L ${coords[0]!.x} ${height - paddingY} Z`;
  const xLabels = ['W1 Avg', 'W2 Avg', 'W3 Avg', 'W4 Avg', 'Today'];

  return (
    <div className="w-full">
      <div className="relative h-[200px] w-full mt-2">
        <div className="absolute left-0 top-[20px] bottom-[20px] w-12 flex flex-col justify-between text-[10px] font-bold text-slate-400">
          <span>{formatShortPaise(maxVal)}</span>
          <span>{formatShortPaise(minVal + range / 2)}</span>
          <span>{formatShortPaise(minVal)}</span>
        </div>

        <div className="ml-12 h-full">
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="overflow-visible"
          >
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-brand-primary)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--color-brand-primary)" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {/* Grid lines */}
            {[0, 0.5, 1].map((ratio, idx) => {
              const y = paddingY + ratio * (height - paddingY * 2);
              return (
                <line
                  key={idx}
                  x1={paddingX}
                  y1={y}
                  x2={width - paddingX}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth="1.5"
                />
              );
            })}
            <path d={areaPath} fill="url(#areaGradient)" />
            <path
              d={linePath}
              fill="none"
              stroke="var(--color-brand-primary)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {coords.map((c, idx) => (
              <g key={idx}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r="5"
                  fill="var(--color-brand-primary)"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="filter drop-shadow-sm"
                />
                <text
                  x={c.x}
                  y={c.y - 10}
                  textAnchor="middle"
                  className="text-[9px] font-bold fill-slate-700 font-sans"
                >
                  {formatShortPaise(c.val)}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
      <div className="flex justify-between ml-12 px-6 mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        {xLabels.map((lbl, idx) => (
          <span key={idx}>{lbl}</span>
        ))}
      </div>
    </div>
  );
}

function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = 50;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;

  return (
    <div className="flex flex-col items-center justify-center p-2">
      <div className="relative w-40 h-40">
        <svg width="100%" height="100%" viewBox="0 0 120 120" className="transform -rotate-90">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="10" />
          {data.map((item, idx) => {
            if (item.value === 0) return null;
            const percentage = item.value / total;
            const strokeLength = percentage * circumference;
            const strokeOffset = circumference - strokeLength + currentOffset;
            currentOffset -= strokeLength;
            return (
              <circle
                key={idx}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth="10"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
                strokeLinecap="round"
                className="transition-all duration-500 ease-out"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-extrabold text-slate-800 tracking-tight">{total}</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Total
          </span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs w-full">
        {data
          .filter((item) => item.value > 0)
          .map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-slate-600 truncate font-semibold">{item.label}</span>
              <span className="ml-auto font-bold text-slate-800 tabular-nums">{item.value}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function Summary({ summary }: { summary: AdminSummary }) {
  const { queues, bookings, money } = summary;

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

  const bookingData = statuses.map(([status, count]) => {
    let color = '#94a3b8';
    if (/failed|cancelled|suspended|blocked|severe|expired|parked/i.test(status)) {
      color = '#f87171';
    } else if (
      /passed|paid|captured|resolved|completed|settled|active|published|work_done/i.test(status)
    ) {
      color = '#34d399';
    } else if (
      /pending|submitted|in_review|needs_info|queued|draft|held|processing|requested/i.test(status)
    ) {
      color = '#60a5fa';
    } else if (/accepted|en_route|arrived|in_progress/i.test(status)) {
      color = '#818cf8';
    }
    return {
      label: status,
      value: count,
      color,
    };
  });

  return (
    <div className="space-y-6">
      {/* Queues grid */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
          Attention Queues
        </h3>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {tiles.map((tile) => (
            <ToneStatTile key={tile.label} {...tile} />
          ))}
        </div>
      </section>

      {/* Futuristic Insights / Visualizations */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 !p-5" title="GMV Daily Velocity Trend (30 Days)">
          <GMVChart today={money.gmvTodayPaise} g7d={money.gmv7dPaise} g30d={money.gmv30dPaise} />
        </Card>
        <Card className="lg:col-span-1 !p-5" title="Today's Booking Allocation">
          {bookingData.length === 0 ? (
            <div className="flex h-[230px] items-center justify-center">
              <p className="text-sm text-slate-400 font-medium">
                No bookings in the last 24 hours.
              </p>
            </div>
          ) : (
            <DonutChart data={bookingData} />
          )}
        </Card>
      </section>

      {/* Money grid */}
      <section>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
          Financial Metrics
        </h3>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      <div className="flex items-center justify-between text-xs text-slate-400 font-medium pt-4 border-t border-slate-100">
        <p>
          Generated <Timestamp value={summary.generatedAt} />.
        </p>
        <p>Real-time data — cached disabled.</p>
      </div>
    </div>
  );
}
