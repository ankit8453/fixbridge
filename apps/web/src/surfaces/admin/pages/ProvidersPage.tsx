import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Filter, Search, UserRoundSearch, Users } from 'lucide-react';
import { fetchProviders } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { ProviderRow } from '../lib/types';
import { Timestamp } from '../components/Timestamp';
import { BadgeLevel } from '../components/StatusBadge';
import { AdminButton, Card, EmptyState, Pill, SectionHeader, SkeletonRows } from '../components/ui';
import { ErrorState, Field, Pagination, Select, TextInput } from '@/components/ui';

const TRISTATE = [
  { value: '', label: 'Any' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

const BADGES = ['NONE', 'VERIFIED', 'SILVER', 'GOLD'];

const FLAG_FILTERS = [
  ['listed', 'Listed'],
  ['suspended', 'Suspended'],
  ['pending_approval', 'Awaiting entry approval'],
] as const;

/** Ported from `legacy-next-src/app/[locale]/admin/providers/page.tsx`. */
export default function ProvidersPage() {
  const filters = useFilters();

  const params = {
    q: filters.get('q'),
    city_id: filters.get('city_id'),
    badge: filters.get('badge'),
    listed: filters.get('listed'),
    suspended: filters.get('suspended'),
    pending_approval: filters.get('pending_approval'),
    page: filters.page,
  };

  const query = useQuery({
    queryKey: ['admin', 'providers', params],
    queryFn: () => fetchProviders(params),
  });

  const active = [
    params.q,
    params.city_id,
    params.badge,
    params.listed,
    params.suspended,
    params.pending_approval,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Technicians"
        description="Search by name or phone fragment — whatever the caller read out."
        action={
          query.data ? (
            <Pill tone="admin">
              {query.data.total} match{query.data.total === 1 ? '' : 'es'}
            </Pill>
          ) : null
        }
      />

      <Card
        title="Filters"
        action={
          active > 0 ? (
            <AdminButton
              size="sm"
              variant="ghost"
              onClick={() => {
                for (const name of [
                  'q',
                  'city_id',
                  'badge',
                  'listed',
                  'suspended',
                  'pending_approval',
                ]) {
                  filters.set(name, undefined);
                }
              }}
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
              Clear {active}
            </AdminButton>
          ) : null
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Field label="Name or phone">
            {(id) => (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                  strokeWidth={2}
                />
                <TextInput
                  id={id}
                  className="pl-9"
                  defaultValue={params.q ?? ''}
                  placeholder="Ramesh, or 98765"
                  // Applied on blur or Enter rather than per keystroke: each change
                  // is a request, and a search box that fires nine of them while
                  // somebody types a phone number is nine chances to rate limit.
                  onBlur={(event) => filters.set('q', event.target.value.trim() || undefined)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      filters.set('q', event.currentTarget.value.trim() || undefined);
                    }
                  }}
                />
              </div>
            )}
          </Field>

          <Field label="City id">
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                defaultValue={params.city_id ?? ''}
                onBlur={(event) => filters.set('city_id', event.target.value.trim() || undefined)}
              />
            )}
          </Field>

          <Field label="Badge">
            {(id) => (
              <Select
                id={id}
                value={params.badge ?? ''}
                onChange={(event) => filters.set('badge', event.target.value || undefined)}
              >
                <option value="">Any</option>
                {BADGES.map((badge) => (
                  <option key={badge} value={badge}>
                    {badge}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {FLAG_FILTERS.map(([name, label]) => (
            <Field key={name} label={label}>
              {(id) => (
                <Select
                  id={id}
                  value={filters.get(name) ?? ''}
                  onChange={(event) => filters.set(name, event.target.value || undefined)}
                >
                  {TRISTATE.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
        </div>
      </Card>

      <Card padded={false}>
        {query.status === 'pending' ? (
          <SkeletonRows rows={10} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={active > 0 ? UserRoundSearch : Users}
            title="No technician matches those filters."
            description="A phone fragment matches the stored E.164 number, so try the last few digits rather than the whole number."
          />
        ) : (
          <>
            <ProviderTable rows={query.data.items} />
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

/**
 * A completeness bar rather than a bare number.
 *
 * The score is only interesting relative to the listing threshold, and
 * "62 / 100 and not listed" is a sentence a bar tells faster than digits do.
 * The number is printed beside it, so the bar itself is decorative.
 */
function Completeness({ score, listed }: { score: number; listed: boolean }) {
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-slate-100"
      >
        <span
          className={`block h-full rounded-full ${listed ? 'bg-admin' : 'bg-warning'}`}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="tabular-nums text-slate-700">{score}</span>
    </span>
  );
}

function ProviderTable({ rows }: { rows: ProviderRow[] }) {
  const headers = [
    { key: 'name', label: 'Name', align: 'left' as const },
    { key: 'phone', label: 'Phone', align: 'right' as const },
    { key: 'badge', label: 'Badge', align: 'left' as const },
    { key: 'trust', label: 'Trust', align: 'right' as const },
    { key: 'jobs', label: 'Jobs', align: 'right' as const },
    { key: 'complete', label: 'Complete', align: 'left' as const },
    { key: 'listed', label: 'Listed', align: 'left' as const },
    { key: 'suspended', label: 'Suspended until', align: 'left' as const },
  ];

  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              {headers.map((header) => (
                <th
                  key={header.key}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
                    header.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.userId} className="transition-colors hover:bg-slate-50">
                <td className="px-3 py-2.5">
                  <Link
                    to={`/admin/providers/${row.userId}`}
                    className="font-semibold text-admin hover:underline"
                  >
                    {row.displayName ?? row.userId}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                  {row.user?.phone ?? '—'}
                </td>
                <td className="px-3 py-2.5">
                  <BadgeLevel badge={row.verification?.badge} />
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                  {row.stats?.trustScore ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                  {row.stats?.settledJobsCount ?? 0}
                </td>
                <td className="px-3 py-2.5">
                  <Completeness score={row.completenessScore} listed={row.isListed} />
                </td>
                <td className="px-3 py-2.5">
                  {row.isListed ? (
                    <Pill tone="success">listed</Pill>
                  ) : (
                    <Pill tone="warning">not listed</Pill>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {row.suspendedUntil ? (
                    <span
                      title={row.suspensionReason ?? undefined}
                      className="inline-flex items-center gap-1.5"
                    >
                      <Pill tone="danger">suspended</Pill>
                      <span className="text-slate-600">
                        <Timestamp value={row.suspendedUntil} />
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 sm:hidden">
        {rows.map((row) => (
          <li key={row.userId}>
            <Link to={`/admin/providers/${row.userId}`} className="block px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">
                  {row.displayName ?? row.userId}
                </span>
                <BadgeLevel badge={row.verification?.badge} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span className="tabular-nums">{row.user?.phone ?? '—'}</span>
                <span className="tabular-nums">Trust {row.stats?.trustScore ?? '—'}</span>
                <span className="tabular-nums">{row.stats?.settledJobsCount ?? 0} jobs</span>
                {row.isListed ? (
                  <Pill tone="success">listed</Pill>
                ) : (
                  <Pill tone="warning">not listed</Pill>
                )}
                {row.suspendedUntil ? <Pill tone="danger">suspended</Pill> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
