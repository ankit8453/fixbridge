import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { closePayoutBatch, fetchPayoutBatch, markPayoutFailed, markPayoutPaid } from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import type { Payout } from '../lib/types';
import { ConfirmDialog, noteField } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '@/lib/auth/useAuth';
import { Button, Card, DetailRow, QueryState, Table, type TableColumn } from '@/components/ui';
import { formatPaise } from '@/lib/money';

type Dialog =
  { kind: 'paid'; payout: Payout } | { kind: 'failed'; payout: Payout } | { kind: 'close' };

/**
 * One payout batch, and the only screen that moves payout money. Ported
 * from `legacy-next-src/app/[locale]/admin/money/batches/[batchId]/page.tsx`.
 *
 * Transfers happen by hand in a bank portal; this records what happened.
 * That is why "mark paid" demands the UTR — the ledger posts here and only
 * here, and the one time anybody needs that reference is the one time a
 * technician says they were never paid.
 *
 * **Permission split:** marking a line paid or failed is admin-only
 * (`ADMIN_ONLY_ROUTES` in `apps/api/src/core/audit.ts` lists both
 * `/admin/payments/payouts/:payoutId/paid` and `.../failed`). Closing the
 * batch is not on that list — "payout batch create/review" stays judgment
 * work ops may do — so "Close batch" renders for both roles while the
 * per-row actions render only for admin.
 */
export default function PayoutBatchPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params.batchId ?? '';
  const { roles } = useAuth();
  const canRecordPayouts = roles.includes('admin');
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'payouts', 'batch', batchId],
    queryFn: () => fetchPayoutBatch(batchId),
  });

  const invalidate = [
    ['admin', 'payouts'],
    ['admin', 'ledger'],
    ['admin', 'summary'],
  ];
  const close = () => setDialog(null);

  const paid = useAdminMutation(
    (input: { payoutId: string; utrRef: string }) => markPayoutPaid(input.payoutId, input.utrRef),
    { invalidate, onDone: close },
  );

  const failed = useAdminMutation(
    (input: { payoutId: string; note: string }) => markPayoutFailed(input.payoutId, input.note),
    { invalidate, onDone: close },
  );

  const closeBatch = useAdminMutation(() => closePayoutBatch(batchId), {
    invalidate,
    onDone: close,
  });

  return (
    <>
      <PageHeader
        title="Payout batch"
        actions={
          <Link className="text-sm text-brand hover:underline" to="/admin/money">
            ← Back to money
          </Link>
        }
      />

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading the batch and its payouts…"
        onRetry={() => void query.refetch()}
      >
        {({ batch }) => {
          const columns: TableColumn<Payout>[] = [
            {
              key: 'provider',
              header: 'Technician',
              render: (row) => (
                <Link
                  className="text-brand hover:underline"
                  to={`/admin/providers/${row.providerId}`}
                >
                  {row.providerId.slice(0, 8)}…
                </Link>
              ),
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              render: (row) => <span className="font-medium">{formatPaise(row.amountPaise)}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => <StatusBadge status={row.status} />,
            },
            { key: 'utr', header: 'UTR', align: 'right', render: (row) => row.utrRef ?? '—' },
            { key: 'paid', header: 'Paid', render: (row) => <Timestamp value={row.paidAt} /> },
            {
              key: 'actions',
              header: '',
              render: (row) =>
                // Hidden, not disabled, for ops: these two calls are
                // admin-only server-side, and a button that always 403s for
                // a whole role teaches nothing except that the console
                // tried and failed on their behalf.
                row.status !== 'paid' && canRecordPayouts ? (
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => setDialog({ kind: 'paid', payout: row })}
                    >
                      Mark paid
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setDialog({ kind: 'failed', payout: row })}
                    >
                      Mark failed
                    </Button>
                  </div>
                ) : null,
            },
          ];

          return (
            <div className="space-y-4">
              <Card
                title={`Batch ${batch.id}`}
                actions={
                  batch.status === 'completed' ? (
                    <span className="text-xs text-muted">Closed.</span>
                  ) : (
                    <Button variant="danger" onClick={() => setDialog({ kind: 'close' })}>
                      Close batch
                    </Button>
                  )
                }
              >
                <dl>
                  <DetailRow label="Status">
                    <StatusBadge status={batch.status} />
                  </DetailRow>
                  <DetailRow label="Payouts">{batch.payoutCount}</DetailRow>
                  <DetailRow label="Total">{formatPaise(batch.totalPaise)}</DetailRow>
                  <DetailRow label="Window end">
                    <Timestamp value={batch.windowEnd} />
                  </DetailRow>
                  <DetailRow label="Created">
                    <Timestamp value={batch.createdAt} />
                  </DetailRow>
                  <DetailRow label="Completed">
                    <Timestamp value={batch.completedAt} />
                  </DetailRow>
                </dl>
              </Card>

              <Card title={`Payouts (${batch.payouts?.length ?? 0})`}>
                {!batch.payouts || batch.payouts.length === 0 ? (
                  <p className="text-sm text-muted">This batch has no payout lines.</p>
                ) : (
                  <Table columns={columns} rows={batch.payouts} rowKey={(row) => row.id} />
                )}
              </Card>

              {dialog?.kind === 'paid' ? (
                <ConfirmDialog
                  title={`Mark ${formatPaise(dialog.payout.amountPaise)} as paid`}
                  description="This posts the payout to the ledger. It is the only place payout money moves, and it cannot be undone from this console."
                  // Distinct from the row's "Mark paid" on purpose: two buttons
                  // with the same words, one of which actually moves money, is a
                  // misclick waiting for a bad afternoon.
                  confirmLabel="Record as paid"
                  tone="danger"
                  pending={paid.isPending}
                  error={paid.error}
                  fields={[
                    {
                      name: 'utrRef',
                      label: 'UTR / bank reference',
                      required: true,
                      placeholder: 'e.g. N123456789012345',
                      // A database CHECK refuses a paid payout without one. Asking
                      // here saves a round trip; the constraint is the real rule.
                      hint: 'Required. A payout marked paid with no bank reference is unauditable.',
                    },
                  ]}
                  onClose={close}
                  onConfirm={(values) =>
                    paid.mutate({ payoutId: dialog.payout.id, utrRef: values.utrRef ?? '' })
                  }
                />
              ) : null}

              {dialog?.kind === 'failed' ? (
                <ConfirmDialog
                  title={`Mark ${formatPaise(dialog.payout.amountPaise)} as failed`}
                  description="Nothing is posted to the ledger. The balance simply rolls into the next batch."
                  confirmLabel="Record as failed"
                  tone="danger"
                  pending={failed.isPending}
                  error={failed.error}
                  fields={[noteField('Note', 'What the bank said.')]}
                  onClose={close}
                  onConfirm={(values) =>
                    failed.mutate({ payoutId: dialog.payout.id, note: values.note ?? '' })
                  }
                />
              ) : null}

              {dialog?.kind === 'close' ? (
                <ConfirmDialog
                  title="Close this batch"
                  description="Only close a batch once every line in it has been marked paid or failed."
                  confirmLabel="Close batch"
                  tone="danger"
                  pending={closeBatch.isPending}
                  error={closeBatch.error}
                  onClose={close}
                  onConfirm={() => closeBatch.mutate(undefined)}
                />
              ) : null}
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
