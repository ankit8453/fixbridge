import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createPayoutBatch,
  fetchJournals,
  fetchPayoutBatches,
  fetchSummary,
  settleDues,
} from '../api/endpoints';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/Layout';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, StatTile } from '../components/ui/Card';
import { Field, Select, TextInput } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { ErrorState, QueryState } from '../components/ui/States';
import { Table, Td, Th, Tr } from '../components/ui/Table';
import { useFilters } from '../lib/filters';
import { formatPaise, parseRupeesToPaise } from '../lib/money';
import { useAdminMutation } from '../lib/mutations';

const JOURNAL_TYPES = [
  'payment_captured',
  'cash_collected',
  'refund',
  'payout',
  'dues_settled',
  'adjustment',
];

export function MoneyPage() {
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
 * The platform position, taken from the same summary endpoint the overview uses.
 *
 * Deliberately not a second endpoint: two ways to ask "what is our position"
 * eventually disagree by a rounding, and the one thing this screen cannot afford
 * is two different answers to a money question on two different pages.
 */
function RevenueSummary() {
  const query = useQuery({ queryKey: ['summary'], queryFn: fetchSummary });

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
            <StatTile
              label="Revenue (commission)"
              value={formatPaise(summary.money.revenuePaise)}
            />
            <StatTile
              label="Held at the gateway"
              value={formatPaise(summary.money.gatewayCashPaise)}
            />
            <StatTile
              label="Owed to technicians"
              value={formatPaise(summary.money.owedToProvidersPaise)}
            />
            <StatTile
              label="Owed by technicians"
              value={formatPaise(summary.money.owedByProvidersPaise)}
            />
            <StatTile label="GMV today" value={formatPaise(summary.money.gmvTodayPaise)} />
            <StatTile label="GMV 7 days" value={formatPaise(summary.money.gmv7dPaise)} />
            <StatTile label="GMV 30 days" value={formatPaise(summary.money.gmv30dPaise)} />
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
    queryKey: ['payouts', 'batches', filters.page],
    queryFn: () => fetchPayoutBatches({ page: filters.page }),
  });

  const create = useAdminMutation(() => createPayoutBatch(), {
    invalidate: [['payouts'], ['summary']],
    onDone: () => setConfirming(false),
  });

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
        <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {create.data.batchId ? (
            <>
              Drafted{' '}
              <Link
                className="text-blue-700 hover:underline"
                to={`/money/batches/${create.data.batchId}`}
              >
                batch {create.data.batchId.slice(0, 8)}…
              </Link>{' '}
              — {create.data.payoutCount ?? 0} payouts, {formatPaise(create.data.totalPaise ?? 0)}.
            </>
          ) : (
            'Nobody was eligible for a payout, so no batch was created.'
          )}
          {create.data.skipped?.length ? (
            <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
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
            <Table
              head={
                <tr>
                  <Th>Batch</Th>
                  <Th>Status</Th>
                  <Th>Payouts</Th>
                  <Th>Total</Th>
                  <Th>Window end</Th>
                  <Th>Created</Th>
                  <Th>Completed</Th>
                </tr>
              }
            >
              {page.items.map((batch) => (
                <Tr key={batch.id}>
                  <Td>
                    <Link
                      className="font-medium text-blue-700 hover:underline"
                      to={`/money/batches/${batch.id}`}
                    >
                      {batch.id.slice(0, 8)}…
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={batch.status} />
                  </Td>
                  <Td className="tabular-nums">{batch.payoutCount}</Td>
                  <Td className="tabular-nums">{formatPaise(batch.totalPaise)}</Td>
                  <Td>
                    <Timestamp value={batch.windowEnd} />
                  </Td>
                  <Td>
                    <Timestamp value={batch.createdAt} />
                  </Td>
                  <Td>
                    <Timestamp value={batch.completedAt} />
                  </Td>
                </Tr>
              ))}
            </Table>
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
 * Typed in rupees and converted once, here, because ops read the amount off a
 * bank statement in rupees and the ledger stores paise. The conversion goes
 * through `parseRupeesToPaise` rather than `* 100` — this number becomes a
 * ledger row and floating-point drift in one is not recoverable.
 */
function SettleDues() {
  const [open, setOpen] = useState(false);

  const settle = useAdminMutation(
    (input: { providerId: string; amountPaise: number; memo: string }) => settleDues(input),
    { invalidate: [['providers'], ['ledger'], ['summary']], onDone: () => setOpen(false) },
  );

  const [amountError, setAmountError] = useState<string | null>(null);

  return (
    <Card
      title="Settle dues"
      actions={
        <Button variant="primary" onClick={() => setOpen(true)}>
          Record a repayment
        </Button>
      }
    >
      <p className="text-sm text-slate-600">
        When a technician repays the commission they owe on cash jobs, record it here. It posts a
        balanced <code>dues_settled</code> journal; it is not an adjustment and it cannot be edited
        afterwards.
      </p>
      {settle.isSuccess ? (
        <p className="mt-2 text-sm text-green-800">Recorded. The ledger has been refetched.</p>
      ) : null}

      {open ? (
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

  const query = useQuery({ queryKey: ['ledger', params], queryFn: () => fetchJournals(params) });

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
            <Table
              head={
                <tr>
                  <Th>Journal</Th>
                  <Th>Type</Th>
                  <Th>Entries</Th>
                  <Th>Booking</Th>
                  <Th>Memo</Th>
                  <Th>Posted</Th>
                </tr>
              }
            >
              {page.items.map((journal) => (
                <Tr key={journal.id}>
                  <Td>
                    <Link
                      className="font-medium text-blue-700 hover:underline"
                      to={`/money/journals/${journal.id}`}
                    >
                      {journal.id.slice(0, 8)}…
                    </Link>
                  </Td>
                  <Td>{journal.journalType}</Td>
                  <Td className="tabular-nums">{journal._count?.entries ?? '—'}</Td>
                  <Td>
                    {journal.bookingId ? (
                      <Link
                        className="text-blue-700 hover:underline"
                        to={`/bookings/${journal.bookingId}`}
                      >
                        {journal.bookingId.slice(0, 8)}…
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="max-w-sm truncate">{journal.memo ?? '—'}</Td>
                  <Td>
                    <Timestamp value={journal.createdAt} />
                  </Td>
                </Tr>
              ))}
            </Table>
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
