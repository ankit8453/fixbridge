'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { fetchJournal } from '@/components/admin/lib/api';
import { AdminLink } from '@/components/admin/AdminLink';
import { PageHeader } from '@/components/admin/Shell';
import { Timestamp } from '@/components/admin/Timestamp';
import { Badge, Card, DetailRow, QueryState, Table, Td, Th, Tr } from '@/components/ui';
import { formatPaise } from '@/lib/money';

/**
 * One journal, with its debits and credits and the proof they agree. Ported
 * from apps/admin/src/pages/JournalDetailPage.tsx.
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
          <AdminLink className="text-sm text-blue-700 hover:underline" href="/money">
            ← Back to money
          </AdminLink>
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

          return (
            <div className="space-y-4">
              <Card title={`Journal ${journal.id}`}>
                <dl>
                  <DetailRow label="Type">{journal.journalType}</DetailRow>
                  <DetailRow label="Memo">{journal.memo ?? '—'}</DetailRow>
                  <DetailRow label="Booking">
                    {journal.bookingId ? (
                      <AdminLink
                        className="text-blue-700 hover:underline"
                        href={`/bookings/${journal.bookingId}`}
                      >
                        {journal.bookingId}
                      </AdminLink>
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
                <Table
                  head={
                    <tr>
                      <Th>Account</Th>
                      <Th>Owner</Th>
                      <Th>Direction</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  }
                >
                  {journal.entries.map((entry) => (
                    <Tr key={entry.id}>
                      <Td>{entry.account?.accountType ?? '—'}</Td>
                      <Td>
                        {entry.account?.ownerType === 'provider' && entry.account.ownerId ? (
                          <AdminLink
                            className="text-blue-700 hover:underline"
                            href={`/providers/${entry.account.ownerId}`}
                          >
                            {entry.account.ownerId.slice(0, 8)}…
                          </AdminLink>
                        ) : (
                          (entry.account?.ownerType ?? 'platform')
                        )}
                      </Td>
                      <Td>
                        <Badge tone={entry.direction === 'debit' ? 'info' : 'good'}>
                          {entry.direction}
                        </Badge>
                      </Td>
                      <Td className="text-right tabular-nums">{formatPaise(entry.amountPaise)}</Td>
                    </Tr>
                  ))}
                </Table>

                <div className="mt-3 flex justify-end gap-6 border-t border-slate-200 pt-3 text-sm">
                  <span>
                    Debits <strong className="tabular-nums">{formatPaise(debits)}</strong>
                  </span>
                  <span>
                    Credits <strong className="tabular-nums">{formatPaise(credits)}</strong>
                  </span>
                  <span>
                    {debits === credits ? (
                      <Badge tone="good">balanced</Badge>
                    ) : (
                      <Badge tone="bad">does not balance — report this</Badge>
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
