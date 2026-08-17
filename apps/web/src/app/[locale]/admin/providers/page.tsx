'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { fetchProviders } from '@/components/admin/lib/api';
import { useFilters } from '@/components/admin/lib/filters';
import { AdminLink } from '@/components/admin/AdminLink';
import { PageHeader } from '@/components/admin/Shell';
import { Timestamp } from '@/components/admin/Timestamp';
import { BadgeLevel } from '@/components/admin/ui/Badge';
import {
  Badge,
  Card,
  Field,
  Pagination,
  QueryState,
  Select,
  Spinner,
  Table,
  Td,
  TextInput,
  Th,
  Tr,
} from '@/components/ui';

const TRISTATE = [
  { value: '', label: 'Any' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

/** Ported from apps/admin/src/pages/ProvidersPage.tsx. */
export default function ProvidersPage() {
  return (
    <Suspense fallback={<Spinner label="Searching technicians…" />}>
      <ProvidersContent />
    </Suspense>
  );
}

function ProvidersContent() {
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
              <Table
                head={
                  <tr>
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Badge</Th>
                    <Th>Trust</Th>
                    <Th>Jobs</Th>
                    <Th>Complete</Th>
                    <Th>Listed</Th>
                    <Th>Suspended until</Th>
                  </tr>
                }
              >
                {page.items.map((row) => (
                  <Tr key={row.userId}>
                    <Td>
                      <AdminLink
                        className="font-medium text-blue-700 hover:underline"
                        href={`/providers/${row.userId}`}
                      >
                        {row.displayName ?? row.userId}
                      </AdminLink>
                    </Td>
                    <Td className="tabular-nums">{row.user?.phone ?? '—'}</Td>
                    <Td>
                      <BadgeLevel badge={row.verification?.badge} />
                    </Td>
                    <Td className="tabular-nums">{row.stats?.trustScore ?? '—'}</Td>
                    <Td className="tabular-nums">{row.stats?.settledJobsCount ?? 0}</Td>
                    <Td className="tabular-nums">{row.completenessScore}</Td>
                    <Td>
                      {row.isListed ? (
                        <Badge tone="good">listed</Badge>
                      ) : (
                        <Badge tone="warn">not listed</Badge>
                      )}
                    </Td>
                    <Td>
                      {row.suspendedUntil ? (
                        <span title={row.suspensionReason ?? undefined}>
                          <Timestamp value={row.suspendedUntil} />
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
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
    </>
  );
}
