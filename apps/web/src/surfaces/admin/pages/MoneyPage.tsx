import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
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
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { ToneStatTile } from '../components/ToneStatTile';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '@/lib/auth/useAuth';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Pagination,
  QueryState,
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
    <>
      <PageHeader
        title="Money"
        subtitle="Payout batches, dues settlement and the ledger. Every figure here is a sum of ledger entries — no balance is stored anywhere."
      />

      <div className="space-y-4">
        <RevenueSummary />
        <PayoutBatches />
        <SettleDues />
        <LedgerBrowser />
      </div>
    </>
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
    <Card title="Position">
      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading the platform position…"
        onRetry={() => void query.refetch()}
      >
        {(summary) => (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ToneStatTile
              label="Revenue (commission)"
              value={formatPaise(summary.money.revenuePaise)}
            />
            <ToneStatTile
              label="Held at the gateway"
              value={formatPaise(summary.money.gatewayCashPaise)}
            />
            <ToneStatTile
              label="Owed to technicians"
              value={formatPaise(summary.money.owedToProvidersPaise)}
            />
            <ToneStatTile
              label="Owed by technicians"
              value={formatPaise(summary.money.owedByProvidersPaise)}
            />
            <ToneStatTile label="GMV today" value={formatPaise(summary.money.gmvTodayPaise)} />
            <ToneStatTile label="GMV 7 days" value={formatPaise(summary.money.gmv7dPaise)} />
            <ToneStatTile label="GMV 30 days" value={formatPaise(summary.money.gmv30dPaise)} />
          </div>
        )}
      </QueryState>
    </Card>
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
          className="font-medium text-brand hover:underline"
          to={`/admin/money/batches/${row.id}`}
        >
          {row.id.slice(0, 8)}…
        </Link>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'payouts', header: 'Payouts', align: 'right', render: (row) => row.payoutCount },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => formatPaise(row.totalPaise),
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
    <Card
      title="Payout batches"
      actions={
        <Button variant="primary" onClick={() => setConfirming(true)}>
          Draft a new batch
        </Button>
      }
    >
      {create.data ? (
        <div className="mb-3 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm">
          {create.data.batchId ? (
            <>
              Drafted{' '}
              <Link
                className="text-brand hover:underline"
                to={`/admin/money/batches/${create.data.batchId}`}
              >
                batch {create.data.batchId.slice(0, 8)}…
              </Link>{' '}
              — {create.data.payoutCount ?? 0} payouts, {formatPaise(create.data.totalPaise ?? 0)}.
            </>
          ) : (
            'Nobody was eligible for a payout, so no batch was created.'
          )}
          {create.data.skipped?.length ? (
            <ul className="mt-1 list-inside list-disc text-xs text-muted">
              {create.data.skipped.map((skip) => (
                <li key={skip.providerId}>
                  {skip.providerId} — {skip.reason}
                  {skip.netPaise === undefined ? '' : ` (${formatPaise(skip.netPaise)})`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {create.error ? <ErrorState error={create.error} /> : null}

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading payout batches…"
        isEmpty={(page) => page.items.length === 0}
        empty={{
          title: 'No payout batches yet.',
          hint: 'Drafting a batch collects every positive balance above the configured minimum.',
        }}
        onRetry={() => void query.refetch()}
      >
        {(page) => (
          <>
            <Table columns={columns} rows={page.items} rowKey={(row) => row.id} />
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              onChange={filters.setPage}
            />
          </>
        )}
      </QueryState>

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
    </Card>
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
    <Card
      title="Settle dues"
      actions={
        canSettle ? (
          <Button variant="primary" onClick={() => setOpen(true)}>
            Record a repayment
          </Button>
        ) : null
      }
    >
      <p className="text-sm text-slate-600">
        When a technician repays the commission they owe on cash jobs, record it here. It posts a
        balanced <code>dues_settled</code> journal; it is not an adjustment and it cannot be edited
        afterwards.
        {canSettle ? null : ' Only an admin account can record a settlement.'}
      </p>
      {settle.isSuccess ? (
        <p className="mt-2 text-sm text-green-800">Recorded. The ledger has been refetched.</p>
      ) : null}

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
    </Card>
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
          className="font-medium text-brand hover:underline"
          to={`/admin/money/journals/${row.id}`}
        >
          {row.id.slice(0, 8)}…
        </Link>
      ),
    },
    { key: 'type', header: 'Type', render: (row) => row.journalType },
    {
      key: 'entries',
      header: 'Entries',
      align: 'right',
      render: (row) => row._count?.entries ?? '—',
    },
    {
      key: 'booking',
      header: 'Booking',
      render: (row) =>
        row.bookingId ? (
          <Link className="text-brand hover:underline" to={`/admin/bookings/${row.bookingId}`}>
            {row.bookingId.slice(0, 8)}…
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'memo',
      header: 'Memo',
      render: (row) => <span className="block max-w-sm truncate">{row.memo ?? '—'}</span>,
    },
    { key: 'posted', header: 'Posted', render: (row) => <Timestamp value={row.createdAt} /> },
  ];

  return (
    <Card
      title="Ledger"
      actions={
        <div className="grid grid-cols-3 gap-2">
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
      }
    >
      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading ledger journals…"
        isEmpty={(page) => page.items.length === 0}
        empty={{ title: 'No journals match those filters.' }}
        onRetry={() => void query.refetch()}
      >
        {(page) => (
          <>
            <Table columns={columns} rows={page.items} rowKey={(row) => row.id} />
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              onChange={filters.setPage}
            />
          </>
        )}
      </QueryState>
    </Card>
  );
}
