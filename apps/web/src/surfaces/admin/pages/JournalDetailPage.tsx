import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { fetchJournal } from '../lib/api';
import type { JournalDetail } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { Badge, Card, DetailRow, QueryState, Table, type TableColumn } from '@/components/ui';
import { formatPaise } from '@/lib/money';

type Entry = JournalDetail['entries'][number];

/**
 * One journal, with its debits and credits and the proof they agree. Ported
 * from `legacy-next-src/app/[locale]/admin/money/journals/[journalId]/page.tsx`.
 *
 * The totals line at the bottom is not decoration. A deferred constraint
 * trigger in Postgres refuses any journal that does not balance, so the two
 * numbers can only ever be equal — showing them is how an ops user learns
 * to trust that, and how they would notice the day something impossible
 * happened.
 */
export default function JournalDetailPage() {
  const params = useParams<{ journalId: string }>();
  const journalId = params.journalId ?? '';

  const query = useQuery({
    queryKey: ['admin', 'ledger', 'journal', journalId],
    queryFn: () => fetchJournal(journalId),
  });

  return (
    <>
      <PageHeader
        title="Ledger journal"
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
        loadingLabel="Loading the journal and its entries…"
        onRetry={() => void query.refetch()}
      >
        {({ journal }) => {
          const debits = journal.entries
            .filter((entry) => entry.direction === 'debit')
            .reduce((sum, entry) => sum + entry.amountPaise, 0);

          const credits = journal.entries
            .filter((entry) => entry.direction === 'credit')
            .reduce((sum, entry) => sum + entry.amountPaise, 0);

          const columns: TableColumn<Entry>[] = [
            { key: 'account', header: 'Account', render: (row) => row.account?.accountType ?? '—' },
            {
              key: 'owner',
              header: 'Owner',
              render: (row) =>
                row.account?.ownerType === 'provider' && row.account.ownerId ? (
                  <Link
                    className="text-brand hover:underline"
                    to={`/admin/providers/${row.account.ownerId}`}
                  >
                    {row.account.ownerId.slice(0, 8)}…
                  </Link>
                ) : (
                  (row.account?.ownerType ?? 'platform')
                ),
            },
            {
              key: 'direction',
              header: 'Direction',
              render: (row) => (
                <Badge tone={row.direction === 'debit' ? 'info' : 'success'}>{row.direction}</Badge>
              ),
            },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              render: (row) => formatPaise(row.amountPaise),
            },
          ];

          return (
            <div className="space-y-4">
              <Card title={`Journal ${journal.id}`}>
                <dl>
                  <DetailRow label="Type">{journal.journalType}</DetailRow>
                  <DetailRow label="Memo">{journal.memo ?? '—'}</DetailRow>
                  <DetailRow label="Booking">
                    {journal.bookingId ? (
                      <Link
                        className="text-brand hover:underline"
                        to={`/admin/bookings/${journal.bookingId}`}
                      >
                        {journal.bookingId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </DetailRow>
                  <DetailRow label="Payment">{journal.paymentId ?? '—'}</DetailRow>
                  <DetailRow label="Posted">
                    <Timestamp value={journal.createdAt} />
                  </DetailRow>
                </dl>
              </Card>

              <Card title="Entries">
                <Table columns={columns} rows={journal.entries} rowKey={(row) => row.id} />

                <div className="mt-3 flex justify-end gap-6 border-t border-border pt-3 text-sm">
                  <span>
                    Debits <strong className="tabular-nums">{formatPaise(debits)}</strong>
                  </span>
                  <span>
                    Credits <strong className="tabular-nums">{formatPaise(credits)}</strong>
                  </span>
                  <span>
                    {debits === credits ? (
                      <Badge tone="success">balanced</Badge>
                    ) : (
                      <Badge tone="danger">does not balance — report this</Badge>
                    )}
                  </span>
                </div>
              </Card>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
