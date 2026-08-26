import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, Banknote, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { closePayoutBatch, fetchPayoutBatch, markPayoutFailed, markPayoutPaid } from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import type { Payout } from '../lib/types';
import { ConfirmDialog, noteField } from '../components/ConfirmDialog';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import {
  AdminButton,
  Card,
  DetailRow,
  EmptyState,
  Grid,
  SectionHeader,
  SkeletonRows,
  StatTile,
} from '../components/ui';
import { useAuth } from '@/lib/auth/useAuth';
import { ErrorState, Spinner, Table, type TableColumn } from '@/components/ui';
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

  if (query.status === 'pending') {
    return (
      <div className="space-y-4">
        <Card>
          <Spinner label="Loading the batch and its payouts…" />
        </Card>
        <Card padded={false}>
          <SkeletonRows rows={5} />
        </Card>
      </div>
    );
  }

  if (query.status === 'error' || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { batch } = query.data;
  const lines = batch.payouts ?? [];

  // Counted from the lines themselves rather than from a stored field: the
  // question ops are answering on this screen is "is anything still
  // outstanding", and the lines are the only record of that.
  const paidCount = lines.filter((line) => line.status === 'paid').length;
  const failedCount = lines.filter((line) => line.status === 'failed').length;
  const outstandingCount = lines.length - paidCount - failedCount;
  const paidPaise = lines
    .filter((line) => line.status === 'paid')
    .reduce((sum, line) => sum + line.amountPaise, 0);

  const columns: TableColumn<Payout>[] = [
    {
      key: 'provider',
      header: 'Technician',
      render: (row) => (
        <Link
          className="font-mono text-xs font-semibold text-admin hover:underline"
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
      render: (row) => (
        <span className="text-[13px] font-semibold tabular-nums text-slate-900">
          {formatPaise(row.amountPaise)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'utr',
      header: 'UTR',
      align: 'right',
      render: (row) =>
        row.utrRef ? (
          <span className="font-mono text-xs text-slate-700">{row.utrRef}</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    { key: 'paid', header: 'Paid', render: (row) => <Timestamp value={row.paidAt} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        // Hidden, not disabled, for ops: these two calls are
        // admin-only server-side, and a button that always 403s for
        // a whole role teaches nothing except that the console
        // tried and failed on their behalf.
        row.status !== 'paid' && canRecordPayouts ? (
          <div className="flex justify-end gap-2">
            <AdminButton
              size="sm"
              variant="primary"
              onClick={() => setDialog({ kind: 'paid', payout: row })}
            >
              Mark paid
            </AdminButton>
            <AdminButton
              size="sm"
              variant="secondary"
              onClick={() => setDialog({ kind: 'failed', payout: row })}
            >
              Mark failed
            </AdminButton>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        title={`Batch ${batch.id.slice(0, 8)}…`}
        description="Every line is transferred by hand in the bank portal, then recorded here with its reference."
        action={
          <div className="flex items-center gap-2">
            <Link
              className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              to="/admin/money"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              Back to money
            </Link>
            {batch.status === 'completed' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
                Closed.
              </span>
            ) : (
              <AdminButton variant="danger" onClick={() => setDialog({ kind: 'close' })}>
                Close batch
              </AdminButton>
            )}
          </div>
        }
      />

      <Grid cols={4}>
        <StatTile
          label="Batch total"
          value={formatPaise(batch.totalPaise)}
          hint={`${batch.payoutCount} payout${batch.payoutCount === 1 ? '' : 's'} drafted.`}
          icon={Banknote}
          tone="admin"
        />
        <StatTile
          label="Recorded paid"
          value={formatPaise(paidPaise)}
          hint={`${paidCount} of ${lines.length} lines.`}
          icon={CheckCircle2}
          tone="success"
        />
        <StatTile
          label="Still outstanding"
          value={outstandingCount}
          hint="Lines neither paid nor failed."
          icon={Clock}
          tone={outstandingCount > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Failed at the bank"
          value={failedCount}
          hint="Rolls into the next batch."
          icon={XCircle}
          tone={failedCount > 0 ? 'danger' : 'neutral'}
        />
      </Grid>

      <Card title="Batch">
        <dl>
          <DetailRow label="Batch id">
            <span className="font-mono text-xs">{batch.id}</span>
          </DetailRow>
          <DetailRow label="Status">
            <StatusBadge status={batch.status} />
          </DetailRow>
          <DetailRow label="Payouts">
            <span className="tabular-nums">{batch.payoutCount}</span>
          </DetailRow>
          <DetailRow label="Total">
            <span className="font-semibold tabular-nums">{formatPaise(batch.totalPaise)}</span>
          </DetailRow>
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

      <Card title={`Payouts (${lines.length})`} padded={false}>
        {lines.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="This batch has no payout lines."
            description="Nobody had a balance above the payout minimum when it was drafted."
          />
        ) : (
          <div className="p-3">
            <Table columns={columns} rows={lines} rowKey={(row) => row.id} />
          </div>
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
}
