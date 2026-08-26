import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Filter, ShieldCheck } from 'lucide-react';
import { fetchVerificationQueue } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { VerificationQueueRow } from '../lib/types';
import { Timestamp } from '../components/Timestamp';
import {
  AdminButton,
  Card,
  EmptyState,
  Pill,
  SectionHeader,
  SkeletonRows,
  type Tone,
} from '../components/ui';
import { ErrorState, Field, Pagination, Select, TextInput } from '@/components/ui';

/** Ported from `legacy-next-src/app/[locale]/admin/verification/page.tsx`. */
const STATUSES = ['submitted', 'in_review', 'needs_info', 'passed', 'failed'];

/**
 * The case state is the whole point of this screen, so it is coloured the same
 * way everywhere in this surface: amber is waiting on us, green is decided
 * pass, red is decided fail. An unknown status stays neutral rather than being
 * guessed at — a wrong colour on a queue is worse than none.
 */
export function caseTone(status: string): Tone {
  if (/^passed$/i.test(status)) return 'success';
  if (/^failed$/i.test(status)) return 'danger';
  if (/^needs_info$/i.test(status)) return 'warning';
  if (/^in_review$/i.test(status)) return 'info';
  if (/^submitted$/i.test(status)) return 'admin';
  return 'neutral';
}

/** Level 0 is a self-declaration; 3 is the full background check. */
const LEVELS = [0, 1, 2, 3];

export default function VerificationQueuePage() {
  const filters = useFilters();
  const status = filters.get('status');
  const level = filters.get('level');
  const cityId = filters.get('cityId');

  const query = useQuery({
    queryKey: ['admin', 'verification', 'queue', { status, level, cityId, page: filters.page }],
    queryFn: () => fetchVerificationQueue({ status, level, cityId, page: filters.page }),
  });

  const filtered = Boolean(status || level || cityId);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Verification queue"
        description="Oldest first — a newest-first queue starves whoever has waited longest."
        action={
          query.data ? (
            <Pill tone={query.data.total > 0 ? 'warning' : 'success'}>
              {query.data.total} case{query.data.total === 1 ? '' : 's'}
            </Pill>
          ) : null
        }
      />

      <Card
        title="Filters"
        action={
          filtered ? (
            <AdminButton
              size="sm"
              variant="ghost"
              onClick={() => {
                filters.set('status', undefined);
                filters.set('level', undefined);
                filters.set('cityId', undefined);
              }}
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
              Clear
            </AdminButton>
          ) : null
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={status ?? ''}
                onChange={(event) => filters.set('status', event.target.value || undefined)}
              >
                <option value="">Open cases</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Level">
            {(id) => (
              <Select
                id={id}
                value={level ?? ''}
                onChange={(event) => filters.set('level', event.target.value || undefined)}
              >
                <option value="">All levels</option>
                {LEVELS.map((value) => (
                  <option key={value} value={String(value)}>
                    Level {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="City id">
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                value={cityId ?? ''}
                onChange={(event) => filters.set('cityId', event.target.value || undefined)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card padded={false}>
        {query.status === 'pending' ? (
          <SkeletonRows rows={8} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={filtered ? ShieldCheck : CheckCircle2}
            title={filtered ? 'Nothing matches those filters.' : 'Nobody is waiting.'}
            description={
              filtered
                ? 'No verification case matches these filters right now. Widen them, or clear them to see every open case.'
                : 'Every submitted case has been decided. Nobody is waiting on this console to find out whether they can earn.'
            }
          />
        ) : (
          <>
            <QueueTable rows={query.data.items} />
            <div className="px-4 pb-3">
              <Pagination
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onChange={filters.setPage}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function QueueTable({ rows }: { rows: VerificationQueueRow[] }) {
  return (
    <>
      {/* Desktop: a real table. This audience is at a desk all day and reads
          these rows by scanning one column at a time. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              {['Technician', 'Level', 'Status', 'City', 'Waiting since', ''].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="whitespace-nowrap px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.caseId} className="transition-colors hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link
                    to={`/admin/providers/${row.providerId}`}
                    className="font-semibold text-admin hover:underline"
                  >
                    {row.providerName ?? row.providerId}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-slate-100 px-1.5 text-[11px] font-semibold tabular-nums text-slate-700">
                    L{row.level}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Pill tone={caseTone(row.status)}>{row.status}</Pill>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-600">{row.cityId}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  <Timestamp value={row.openedAt} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    to={`/admin/verification/${row.caseId}`}
                    className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-admin hover:underline"
                  >
                    Open case
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per case. Ops on a phone is inconvenienced, not locked out. */}
      <ul className="divide-y divide-slate-100 sm:hidden">
        {rows.map((row) => (
          <li key={row.caseId}>
            <Link to={`/admin/verification/${row.caseId}`} className="block px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">
                  {row.providerName ?? row.providerId}
                </span>
                <Pill tone={caseTone(row.status)}>{row.status}</Pill>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                <span className="tabular-nums">Level {row.level}</span>
                <span className="tabular-nums">City {row.cityId}</span>
                <Timestamp value={row.openedAt} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
