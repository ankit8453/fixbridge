import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ScaleIcon } from 'lucide-react';
import { fetchJournal } from '../lib/api';
import { Timestamp } from '../components/Timestamp';
import { Card, DetailRow, Pill, SectionHeader, SkeletonRows } from '../components/ui';
import { ErrorState, Spinner } from '@/components/ui';
import { formatPaise } from '@/lib/money';

/**
 * One journal, with its debits and credits and the proof they agree. Ported
 * from `legacy-next-src/app/[locale]/admin/money/journals/[journalId]/page.tsx`.
 *
 * The totals line at the bottom is not decoration. A deferred constraint
 * trigger in Postgres refuses any journal that does not balance, so the two
 * numbers can only ever be equal — showing them is how an ops user learns
 * to trust that, and how they would notice the day something impossible
 * happened.
 *
 * Laid out as two money columns rather than one column plus a direction
 * badge: an accountant reads a journal by running an eye down the debit
 * column and then down the credit column, and a single amount column with
 * the direction hidden in a badge makes that impossible.
 */
export default function JournalDetailPage() {
  const params = useParams<{ journalId: string }>();
  const journalId = params.journalId ?? '';

  const query = useQuery({
    queryKey: ['admin', 'ledger', 'journal', journalId],
    queryFn: () => fetchJournal(journalId),
  });

  if (query.status === 'pending') {
    return (
      <div className="space-y-4">
        <Card>
          <Spinner label="Loading the journal and its entries…" />
        </Card>
        <Card padded={false}>
          <SkeletonRows rows={4} />
        </Card>
      </div>
    );
  }

  if (query.status === 'error' || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { journal } = query.data;

  const debits = journal.entries
    .filter((entry) => entry.direction === 'debit')
    .reduce((sum, entry) => sum + entry.amountPaise, 0);

  const credits = journal.entries
    .filter((entry) => entry.direction === 'credit')
    .reduce((sum, entry) => sum + entry.amountPaise, 0);

  const balanced = debits === credits;

  return (
    <div className="space-y-5">
      <SectionHeader
        title={`Journal ${journal.id.slice(0, 8)}…`}
        description="A ledger journal and the entries that make it up. Debits must equal credits."
        action={
          <Link
            className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            to="/admin/money"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
            Back to money
          </Link>
        }
      />

      {/* The verdict, before the arithmetic that produced it. An unbalanced
          journal is a database-level impossibility, so if this ever reads
          red the reader must not have to find that out by adding up columns. */}
      <div
        className={
          balanced
            ? 'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-success/20 bg-success/5 px-4 py-3.5'
            : 'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3.5'
        }
      >
        <span
          className={
            balanced
              ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success'
              : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger'
          }
        >
          {balanced ? (
            <ScaleIcon className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
          ) : (
            <AlertTriangle className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
          )}
        </span>

        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Total debits
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-slate-900">
            {formatPaise(debits)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Total credits
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-slate-900">
            {formatPaise(credits)}
          </p>
        </div>

        <div className="ml-auto">
          {balanced ? (
            <Pill tone="success">balanced</Pill>
          ) : (
            <Pill tone="danger">does not balance — report this</Pill>
          )}
        </div>
      </div>

      <Card title="Entries" padded={false}>
        {journal.entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-slate-500">
            This journal has no entries, which should not be possible.
          </p>
        ) : (
          <>
            {/* Desktop: a real two-money-column ledger. Hand-rolled rather
                than the shared `Table` because that one renders a single
                value per column, and the whole point here is that an
                amount sits in the debit column *or* the credit column. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 text-left font-semibold">Account</th>
                    <th className="px-4 py-2 text-left font-semibold">Owner</th>
                    <th className="px-4 py-2 text-right font-semibold">Debit</th>
                    <th className="border-l border-slate-200 px-4 py-2 text-right font-semibold">
                      Credit
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {journal.entries.map((entry) => {
                    const debit = entry.direction === 'debit';
                    return (
                      <tr key={entry.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {entry.account?.accountType ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {entry.account?.ownerType === 'provider' && entry.account.ownerId ? (
                            <Link
                              className="font-mono text-xs text-admin hover:underline"
                              to={`/admin/providers/${entry.account.ownerId}`}
                            >
                              {entry.account.ownerId.slice(0, 8)}…
                            </Link>
                          ) : (
                            (entry.account?.ownerType ?? 'platform')
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {debit ? (
                            <span className="font-semibold text-slate-900">
                              {formatPaise(entry.amountPaise)}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="border-l border-slate-100 px-4 py-2.5 text-right tabular-nums">
                          {debit ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <span className="font-semibold text-slate-900">
                              {formatPaise(entry.amountPaise)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 text-[13px]">
                    <td
                      className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                      colSpan={2}
                    >
                      Totals
                    </td>
                    <td className="px-4 py-3 text-right text-[15px] font-semibold tabular-nums text-slate-900">
                      {formatPaise(debits)}
                    </td>
                    <td className="border-l border-slate-200 px-4 py-3 text-right text-[15px] font-semibold tabular-nums text-slate-900">
                      {formatPaise(credits)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Phone: one card per entry. Two columns do not fit, so the
                direction becomes the card's own colour and label instead. */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {journal.entries.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-900">
                      {entry.account?.accountType ?? '—'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.account?.ownerType === 'provider' && entry.account.ownerId
                        ? `provider ${entry.account.ownerId.slice(0, 8)}…`
                        : (entry.account?.ownerType ?? 'platform')}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Pill tone={entry.direction === 'debit' ? 'info' : 'admin'}>
                      {entry.direction}
                    </Pill>
                    <p className="mt-1 text-[13px] font-semibold tabular-nums text-slate-900">
                      {formatPaise(entry.amountPaise)}
                    </p>
                  </div>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 border-t-2 border-slate-300 bg-slate-50 px-4 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Totals
                </span>
                <span className="text-right text-[13px] font-semibold tabular-nums text-slate-900">
                  {formatPaise(debits)} / {formatPaise(credits)}
                </span>
              </li>
            </ul>
          </>
        )}
      </Card>

      <Card title="Journal">
        <dl>
          <DetailRow label="Journal id">
            <span className="font-mono text-xs">{journal.id}</span>
          </DetailRow>
          <DetailRow label="Type">
            <Pill tone="admin">{journal.journalType}</Pill>
          </DetailRow>
          <DetailRow label="Memo">{journal.memo ?? '—'}</DetailRow>
          <DetailRow label="Booking">
            {journal.bookingId ? (
              <Link
                className="font-mono text-xs text-admin hover:underline"
                to={`/admin/bookings/${journal.bookingId}`}
              >
                {journal.bookingId}
              </Link>
            ) : (
              '—'
            )}
          </DetailRow>
          <DetailRow label="Payment">
            {journal.paymentId ? (
              <span className="font-mono text-xs">{journal.paymentId}</span>
            ) : (
              '—'
            )}
          </DetailRow>
          <DetailRow label="Posted">
            <Timestamp value={journal.createdAt} />
          </DetailRow>
        </dl>
      </Card>
    </div>
  );
}
