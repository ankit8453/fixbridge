import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  closePayoutBatch,
  fetchPayoutBatch,
  markPayoutFailed,
  markPayoutPaid,
} from '../api/endpoints';
import type { Payout } from '../api/types';
import { ConfirmDialog, noteField } from '../components/ConfirmDialog';
import { PageHeader } from '../components/Layout';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, DetailRow } from '../components/ui/Card';
import { QueryState } from '../components/ui/States';
import { Table, Td, Th, Tr } from '../components/ui/Table';
import { formatPaise } from '../lib/money';
import { useAdminMutation } from '../lib/mutations';

type Dialog =
  { kind: 'paid'; payout: Payout } | { kind: 'failed'; payout: Payout } | { kind: 'close' };

/**
 * One payout batch, and the only screen that moves payout money.
 *
 * Transfers happen by hand in a bank portal; this records what happened. That is
 * why "mark paid" demands the UTR — the ledger posts here and only here, and the
 * one time anybody needs that reference is the one time a technician says they
 * were never paid.
 */
export function PayoutBatchPage() {
  const { batchId = '' } = useParams();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const query = useQuery({
    queryKey: ['payouts', 'batch', batchId],
    queryFn: () => fetchPayoutBatch(batchId),
  });

  const invalidate = [['payouts'], ['ledger'], ['summary']];
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
          <Link className="text-sm text-blue-700 hover:underline" to="/money">
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
        {({ batch }) => (
          <div className="space-y-4">
            <Card
              title={`Batch ${batch.id}`}
              actions={
                batch.status === 'completed' ? (
                  <span className="text-xs text-slate-500">Closed.</span>
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
                <p className="text-sm text-slate-500">This batch has no payout lines.</p>
              ) : (
                <Table
                  head={
                    <tr>
                      <Th>Technician</Th>
                      <Th>Amount</Th>
                      <Th>Status</Th>
                      <Th>UTR</Th>
                      <Th>Paid</Th>
                      <Th />
                    </tr>
                  }
                >
                  {batch.payouts.map((payout) => (
                    <Tr key={payout.id}>
                      <Td>
                        <Link
                          className="text-blue-700 hover:underline"
                          to={`/providers/${payout.providerId}`}
                        >
                          {payout.providerId.slice(0, 8)}…
                        </Link>
                      </Td>
                      <Td className="tabular-nums font-medium">
                        {formatPaise(payout.amountPaise)}
                      </Td>
                      <Td>
                        <StatusBadge status={payout.status} />
                      </Td>
                      <Td className="tabular-nums">{payout.utrRef ?? '—'}</Td>
                      <Td>
                        <Timestamp value={payout.paidAt} />
                      </Td>
                      <Td>
                        {payout.status === 'paid' ? null : (
                          <div className="flex gap-2">
                            <Button
                              variant="primary"
                              onClick={() => setDialog({ kind: 'paid', payout })}
                            >
                              Mark paid
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setDialog({ kind: 'failed', payout })}
                            >
                              Mark failed
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Table>
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
        )}
      </QueryState>
    </>
  );
}
