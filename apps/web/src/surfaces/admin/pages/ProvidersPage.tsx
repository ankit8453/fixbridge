import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchProviders } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { ProviderRow } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { BadgeLevel } from '../components/StatusBadge';
import {
  Badge,
  Card,
  Field,
  Pagination,
  QueryState,
  Select,
  Table,
  TextInput,
  type TableColumn,
} from '@/components/ui';

const TRISTATE = [
  { value: '', label: 'Any' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

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

  const columns: TableColumn<ProviderRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <Link
          className="font-medium text-brand hover:underline"
          to={`/admin/providers/${row.userId}`}
        >
          {row.displayName ?? row.userId}
        </Link>
      ),
    },
    { key: 'phone', header: 'Phone', align: 'right', render: (row) => row.user?.phone ?? '—' },
    {
      key: 'badge',
      header: 'Badge',
      render: (row) => <BadgeLevel badge={row.verification?.badge} />,
    },
    {
      key: 'trust',
      header: 'Trust',
      align: 'right',
      render: (row) => row.stats?.trustScore ?? '—',
    },
    {
      key: 'jobs',
      header: 'Jobs',
      align: 'right',
      render: (row) => row.stats?.settledJobsCount ?? 0,
    },
    {
      key: 'complete',
      header: 'Complete',
      align: 'right',
      render: (row) => row.completenessScore,
    },
    {
      key: 'listed',
      header: 'Listed',
      render: (row) =>
        row.isListed ? (
          <Badge tone="success">listed</Badge>
        ) : (
          <Badge tone="warning">not listed</Badge>
        ),
    },
    {
      key: 'suspended',
      header: 'Suspended until',
      render: (row) =>
        row.suspendedUntil ? (
          <span title={row.suspensionReason ?? undefined}>
            <Timestamp value={row.suspendedUntil} />
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Technicians"
        subtitle="Search by name or phone fragment — whatever the caller read out."
      />

      <Card className="mb-4" title="Filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Name or phone">
            {(id) => (
              <TextInput
                id={id}
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
                {['NONE', 'VERIFIED', 'SILVER', 'GOLD'].map((badge) => (
                  <option key={badge} value={badge}>
                    {badge}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {(
            [
              ['listed', 'Listed'],
              ['suspended', 'Suspended'],
              ['pending_approval', 'Awaiting entry approval'],
            ] as const
          ).map(([name, label]) => (
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

      <Card title="Results">
        <QueryState
          status={query.status}
          error={query.error}
          data={query.data}
          loadingLabel="Searching technicians…"
          isEmpty={(page) => page.items.length === 0}
          empty={{
            title: 'No technician matches those filters.',
            hint: 'A phone fragment matches the stored E.164 number, so try the last few digits.',
          }}
          onRetry={() => void query.refetch()}
        >
          {(page) => (
            <>
              <Table columns={columns} rows={page.items} rowKey={(row) => row.userId} />
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
    </>
  );
}
