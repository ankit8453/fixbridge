import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Banknote,
  Landmark,
  Layers,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  createPayoutBatch,
  fetchJournals,
  fetchPayoutBatches,
  fetchSummary,
  settleDues,
} from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import { useFilters } from '../lib/filters';
import type { JournalRow, PayoutBatchRow } from '../lib/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import {
  AdminButton,
  Card,
  EmptyState,
  Grid,
  Pill,
  SectionHeader,
  SkeletonRows,
  StatTile,
} from '../components/ui';
import { useAuth } from '@/lib/auth/useAuth';
import {
  ErrorState,
  Field,
  Pagination,
  Select,
  Table,
  TextInput,
  type TableColumn,
} from '@/components/ui';
import { formatPaise, parseRupeesToPaise } from '@/lib/money';

const JOURNAL_TYPES = [
  'payment_captured',
  'cash_collected',
  'refund',
  'payout',
  'dues_settled',
  'adjustment',
];

/** Ported from `legacy-next-src/app/[locale]/admin/money/page.tsx`. */
export default function MoneyPage() {
  return (
    <div className="space-y-6">
      <RevenueSummary />
      <PayoutBatches />
      <SettleDues />
      <LedgerBrowser />
    </div>
  );
}

/**
 * The share of GMV the platform keeps, as a donut.
 *
 * Two numbers whose ratio is the business — one slice each, so the split is
 * read rather than computed. Integer paise throughout: the arc is a
 * proportion of a circle, not a rounded rupee figure, so nothing here can
 * disagree with the tile beside it.
 */
function CommissionDonut({ revenuePaise, gmvPaise }: { revenuePaise: number; gmvPaise: number }) {
  const technicianPaise = Math.max(0, gmvPaise - revenuePaise);
  const share = gmvPaise > 0 ? revenuePaise / gmvPaise : 0;

  // A circle of r=42 has a circumference of 2πr ≈ 263.89. Drawing the
  // commission slice as a dash of `share × circumference` avoids arc-path
  // maths and stays exact at 0% and 100%.
  const circumference = 2 * Math.PI * 42;
  const filled = circumference * share;

  const percentLabel = gmvPaise > 0 ? `${Math.round(share * 100)}%` : '—';

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="h-[104px] w-[104px] shrink-0" role="img">
        {/* The data is also in the legend below, but a chart with no text
            equivalent is unreadable to a screen reader on its own. */}
        <title>
          Commission is {percentLabel} of 30-day GMV — {formatPaise(revenuePaise)} of{' '}
          {formatPaise(gmvPaise)}; {formatPaise(technicianPaise)} goes to technicians.
        </title>
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="13" className="stroke-slate-200" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          strokeWidth="13"
          strokeLinecap="butt"
          className="stroke-admin"
          strokeDasharray={`${filled} ${circumference - filled}`}
          // Start at twelve o'clock rather than three — a proportion read
          // clockwise from the top is the convention every reader already has.
          transform="rotate(-90 50 50)"
        />
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-slate-900 text-[19px] font-semibold tabular-nums"
        >
          {percentLabel}
        </text>
      </svg>

      <dl className="min-w-0 space-y-2.5">
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-admin" />
            Commission
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
            {formatPaise(revenuePaise)}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-slate-300" />
            To technicians
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
            {formatPaise(technicianPaise)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * GMV over the three windows the summary reports, as a bar per window.
 *
 * Not a time series — the API returns three cumulative windows (today, 7d,
 * 30d), which are nested rather than sequential, so a sparkline would draw a
 * trend line that does not exist. Three bars scaled to the largest window
 * say what is actually true: how today sits inside the month.
 */
function GmvBars({
  todayPaise,
  weekPaise,
  monthPaise,
}: {
  todayPaise: number;
  weekPaise: number;
  monthPaise: number;
}) {
  const rows = [
    { label: 'Today', paise: todayPaise },
    { label: '7 days', paise: weekPaise },
    { label: '30 days', paise: monthPaise },
  ];

  const peak = Math.max(todayPaise, weekPaise, monthPaise, 1);

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {row.label}
            </span>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {formatPaise(row.paise)}
            </span>
          </div>
          {/* Decorative: the figure it scales is printed immediately above. */}
          <div
            aria-hidden="true"
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className="h-full rounded-full bg-admin-alt"
              style={{ width: `${(row.paise / peak) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The platform position, taken from the same summary endpoint the overview
 * uses. Deliberately not a second endpoint: two ways to ask "what is our
 * position" eventually disagree by a rounding, and the one thing this
 * screen cannot afford is two different answers to a money question on two
 * different pages.
 */
function RevenueSummary() {
  const query = useQuery({ queryKey: ['admin', 'summary'], queryFn: fetchSummary });

  return (
    <section>
      <SectionHeader
        title="Position"
        description="Every figure here is a sum of ledger entries — no balance is stored anywhere."
      />

      {query.status === 'pending' ? (
        <Grid cols={4}>
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="h-[104px] animate-pulse rounded-xl border border-slate-200 bg-white"
              aria-hidden="true"
            />
          ))}
        </Grid>
      ) : query.status === 'error' || query.data === undefined ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="space-y-3">
          <Grid cols={4}>
            <StatTile
              label="Revenue (commission)"
              value={formatPaise(query.data.money.revenuePaise)}
              hint="What the platform has kept, all time."
              icon={TrendingUp}
              tone="admin"
            />
            <StatTile
              label="Held at the gateway"
              value={formatPaise(query.data.money.gatewayCashPaise)}
              hint="Captured online, not yet settled out."
              icon={Landmark}
              tone="info"
            />
            <StatTile
              label="Owed to technicians"
              value={formatPaise(query.data.money.owedToProvidersPaise)}
              hint="Clears through a payout batch."
              icon={ArrowUpRight}
              tone="warning"
            />
            <StatTile
              label="Owed by technicians"
              value={formatPaise(query.data.money.owedByProvidersPaise)}
              hint="Commission on cash jobs, repaid by hand."
              icon={ArrowDownLeft}
              tone="danger"
            />
          </Grid>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card title="Gross merchandise value" description="Cumulative windows, not a trend.">
              <GmvBars
                todayPaise={query.data.money.gmvTodayPaise}
                weekPaise={query.data.money.gmv7dPaise}
                monthPaise={query.data.money.gmv30dPaise}
              />
            </Card>
            <Card
              title="Where the money goes"
              description="All-time commission against the last 30 days of GMV."
            >
              <CommissionDonut
                revenuePaise={query.data.money.revenuePaise}
                gmvPaise={query.data.money.gmv30dPaise}
              />
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}

function PayoutBatches() {
  const filters = useFilters('batchPage');
  const [confirming, setConfirming] = useState(false);

  const query = useQuery({
    queryKey: ['admin', 'payouts', 'batches', filters.page],
    queryFn: () => fetchPayoutBatches({ page: filters.page }),
  });

  // Drafting a batch is judgment work ("payout batch create/review" — ops-
  // accessible per the permission split), unlike marking a line paid/failed
  // inside it (PayoutBatchPage) or settling dues below.
  const create = useAdminMutation(() => createPayoutBatch(), {
    invalidate: [
      ['admin', 'payouts'],
      ['admin', 'summary'],
    ],
    onDone: () => setConfirming(false),
  });

  const columns: TableColumn<PayoutBatchRow>[] = [
    {
      key: 'id',
      header: 'Batch',
      render: (row) => (
        <Link
          className="font-mono text-xs font-semibold text-admin hover:underline"
          to={`/admin/money/batches/${row.id}`}
        >
          {row.id.slice(0, 8)}…
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'payouts',
      header: 'Payouts',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.payoutCount}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => (
        <span className="font-semibold tabular-nums text-slate-900">
          {formatPaise(row.totalPaise)}
        </span>
      ),
    },
    { key: 'window', header: 'Window end', render: (row) => <Timestamp value={row.windowEnd} /> },
    { key: 'created', header: 'Created', render: (row) => <Timestamp value={row.createdAt} /> },
    {
      key: 'completed',
      header: 'Completed',
      render: (row) => <Timestamp value={row.completedAt} />,
    },
  ];

  return (
    <section>
      <SectionHeader
        title="Payout batches"
        description="Drafting a batch collects every positive balance above the payout minimum. No money moves until each line is marked paid by hand."
        action={
          <AdminButton variant="primary" onClick={() => setConfirming(true)}>
            <Layers className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
            Draft a new batch
          </AdminButton>
        }
      />

      {create.data ? (
        <div className="mb-3 rounded-xl border border-admin/20 bg-admin-soft px-4 py-3 text-[13px] text-admin-deep">
          {create.data.batchId ? (
            <>
              Drafted{' '}
              <Link
                className="font-semibold text-admin underline"
                to={`/admin/money/batches/${create.data.batchId}`}
              >
                batch {create.data.batchId.slice(0, 8)}…
              </Link>{' '}
              — {create.data.payoutCount ?? 0} payouts,{' '}
              <span className="font-semibold tabular-nums">
                {formatPaise(create.data.totalPaise ?? 0)}
              </span>
              .
            </>
          ) : (
            'Nobody was eligible for a payout, so no batch was created.'
          )}
          {create.data.skipped?.length ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {create.data.skipped.map((skip) => (
                <li key={skip.providerId} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-mono">{skip.providerId.slice(0, 8)}…</span>
                  <span>— {skip.reason}</span>
                  {skip.netPaise === undefined ? null : (
                    <span className="tabular-nums">({formatPaise(skip.netPaise)})</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {create.error ? (
        <div className="mb-3">
          <ErrorState error={create.error} />
        </div>
      ) : null}

      <Card padded={false}>
        {query.status === 'pending' ? (
          <SkeletonRows rows={4} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No payout batches yet."
            description="Drafting a batch collects every positive balance above the configured minimum."
            action={
              <AdminButton variant="primary" onClick={() => setConfirming(true)}>
                Draft a new batch
              </AdminButton>
            }
          />
        ) : (
          <div className="p-3">
            <Table columns={columns} rows={query.data.items} rowKey={(row) => row.id} />
            <div className="mt-3">
              <Pagination
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onChange={filters.setPage}
              />
            </div>
          </div>
        )}
      </Card>

      {confirming ? (
        <ConfirmDialog
          title="Draft a payout batch"
          description="This collects every technician with a positive balance above the payout minimum into a new draft batch. It does not move any money — each payout is still marked paid by hand, with its bank reference."
          confirmLabel="Draft batch"
          pending={create.isPending}
          error={create.error}
          onClose={() => setConfirming(false)}
          onConfirm={() => create.mutate(undefined)}
        />
      ) : null}
    </section>
  );
}

/**
 * Recording that a technician repaid what they owe on cash jobs.
 *
 * admin-only per the platform's permission split (`ADMIN_ONLY_ROUTES` in
 * `apps/api/src/core/audit.ts` includes `/admin/payments/dues/settle`) —
 * the "Record a repayment" control only renders for a token holding
 * `admin`. Hidden, not disabled: an ops user who can see a button that will
 * 403 has learned nothing except that the console tried and failed on
 * their behalf.
 *
 * Typed in rupees and converted once, here, because ops read the amount off
 * a bank statement in rupees and the ledger stores paise. The conversion
 * goes through `parseRupeesToPaise` rather than `* 100` — this number
 * becomes a ledger row and floating-point drift in one is not recoverable.
 */
function SettleDues() {
  const { roles } = useAuth();
  const canSettle = roles.includes('admin');
  const [open, setOpen] = useState(false);

  const settle = useAdminMutation(
    (input: { providerId: string; amountPaise: number; memo: string }) => settleDues(input),
    {
      invalidate: [
        ['admin', 'providers'],
        ['admin', 'ledger'],
        ['admin', 'summary'],
      ],
      onDone: () => setOpen(false),
    },
  );

  const [amountError, setAmountError] = useState<string | null>(null);

  return (
    <section>
      <SectionHeader
        title="Settle dues"
        action={
          canSettle ? (
            <AdminButton variant="primary" onClick={() => setOpen(true)}>
              <Banknote className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              Record a repayment
            </AdminButton>
          ) : null
        }
      />

      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-admin-soft text-admin">
            <Wallet className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] leading-relaxed text-slate-600">
              When a technician repays the commission they owe on cash jobs, record it here. It
              posts a balanced{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">
                dues_settled
              </code>{' '}
              journal; it is not an adjustment and it cannot be edited afterwards.
              {canSettle ? null : ' Only an admin account can record a settlement.'}
            </p>
            {settle.isSuccess ? (
              <p className="mt-2 text-[13px] font-medium text-success">
                Recorded. The ledger has been refetched.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {open && canSettle ? (
        <ConfirmDialog
          title="Record a dues repayment"
          description="This posts to the ledger immediately."
          confirmLabel="Record repayment"
          tone="danger"
          pending={settle.isPending}
          error={settle.error}
          fields={[
            {
              name: 'providerId',
              label: 'Technician id',
              required: true,
              hint: 'The UUID from their page.',
            },
            {
              name: 'amount',
              label: 'Amount in rupees',
              required: true,
              placeholder: '1250.50',
              hint: amountError ?? 'Digits and at most two decimal places.',
            },
            {
              name: 'memo',
              label: 'Memo',
              type: 'textarea',
              required: true,
              minLength: 3,
              hint: 'How it was repaid — cash at the office, UPI reference, and so on.',
            },
          ]}
          onClose={() => {
            setOpen(false);
            setAmountError(null);
          }}
          onConfirm={(values) => {
            const paise = parseRupeesToPaise(values.amount ?? '');

            if (paise === null || paise <= 0) {
              setAmountError('Enter a positive rupee amount, e.g. 1250.50.');
              return;
            }

            setAmountError(null);
            settle.mutate({
              providerId: values.providerId ?? '',
              amountPaise: paise,
              memo: values.memo ?? '',
            });
          }}
        />
      ) : null}
    </section>
  );
}

function LedgerBrowser() {
  const filters = useFilters('journalPage');

  const params = {
    journal_type: filters.get('journal_type'),
    booking_id: filters.get('booking_id'),
    provider_id: filters.get('provider_id'),
    page: filters.page,
  };

  const query = useQuery({
    queryKey: ['admin', 'ledger', params],
    queryFn: () => fetchJournals(params),
  });

  const columns: TableColumn<JournalRow>[] = [
    {
      key: 'id',
      header: 'Journal',
      render: (row) => (
        <Link
          className="font-mono text-xs font-semibold text-admin hover:underline"
          to={`/admin/money/journals/${row.id}`}
        >
          {row.id.slice(0, 8)}…
        </Link>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => <Pill tone="admin">{row.journalType}</Pill>,
    },
    {
      key: 'entries',
      header: 'Entries',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row._count?.entries ?? '—'}</span>,
    },
    {
      key: 'booking',
      header: 'Booking',
      render: (row) =>
        row.bookingId ? (
          <Link
            className="font-mono text-xs text-admin hover:underline"
            to={`/admin/bookings/${row.bookingId}`}
          >
            {row.bookingId.slice(0, 8)}…
          </Link>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'memo',
      header: 'Memo',
      render: (row) => (
        <span className="block max-w-sm truncate text-slate-600">{row.memo ?? '—'}</span>
      ),
    },
    { key: 'posted', header: 'Posted', render: (row) => <Timestamp value={row.createdAt} /> },
  ];

  return (
    <section>
      <SectionHeader
        title="Ledger"
        description="Double-entry journals, newest first. Open one to see its debits and credits agree."
      />

      <Card padded={false}>
        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-3">
          <Field label="Type">
            {(id) => (
              <Select
                id={id}
                value={params.journal_type ?? ''}
                onChange={(event) => filters.set('journal_type', event.target.value || undefined)}
              >
                <option value="">All</option>
                {JOURNAL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Booking id">
            {(id) => (
              <TextInput
                id={id}
                defaultValue={params.booking_id ?? ''}
                onBlur={(event) =>
                  filters.set('booking_id', event.target.value.trim() || undefined)
                }
              />
            )}
          </Field>
          <Field label="Technician id">
            {(id) => (
              <TextInput
                id={id}
                defaultValue={params.provider_id ?? ''}
                onBlur={(event) =>
                  filters.set('provider_id', event.target.value.trim() || undefined)
                }
              />
            )}
          </Field>
        </div>

        {query.status === 'pending' ? (
          <SkeletonRows rows={6} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No journals match those filters."
            description="Clear a filter, or paste a booking or technician id to trace one job's money."
          />
        ) : (
          <div className="p-3">
            <Table columns={columns} rows={query.data.items} rowKey={(row) => row.id} />
            <div className="mt-3">
              <Pagination
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onChange={filters.setPage}
              />
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
