'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { fetchVerificationQueue } from '@/components/admin/lib/api';
import { useFilters } from '@/components/admin/lib/filters';
import { AdminLink } from '@/components/admin/AdminLink';
import { PageHeader } from '@/components/admin/Shell';
import { Timestamp } from '@/components/admin/Timestamp';
import { StatusBadge } from '@/components/admin/ui/Badge';
import {
  Card,
  Field,
  Pagination,
  QueryState,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';

/**
 * Ported from apps/admin/src/pages/VerificationQueuePage.tsx.
 *
 * Wrapped in `<Suspense>` because `useFilters` reads `useSearchParams()` —
 * required by Next so this route does not force the whole `/admin` segment
 * out of static optimisation at build time (it would already be dynamic via
 * the auth gate, but this keeps each page's opt-in explicit and local).
 */
export default function VerificationQueuePage() {
  return (
    <Suspense fallback={<Spinner label="Loading the verification queue…" />}>
      <VerificationQueueContent />
    </Suspense>
  );
}

const STATUSES = ['submitted', 'in_review', 'needs_info', 'passed', 'failed'];

function VerificationQueueContent() {
  const filters = useFilters();
  const status = filters.get('status');
  const level = filters.get('level');

  const query = useQuery({
    queryKey: ['admin', 'verification', 'queue', { status, level, page: filters.page }],
    queryFn: () => fetchVerificationQueue({ status, level, page: filters.page }),
  });

  return (
    <>
      <PageHeader
        title="Verification queue"
        subtitle="Oldest first — a newest-first queue starves whoever has waited longest."
      />

      <Card
        className="mb-4"
        title="Filters"
        actions={
          <div className="grid grid-cols-2 gap-3">
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
                  {[0, 1, 2, 3].map((value) => (
                    <option key={value} value={String(value)}>
                      Level {value}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        }
      >
        <QueryState
          status={query.status}
          error={query.error}
          data={query.data}
          loadingLabel="Loading the verification queue…"
          isEmpty={(page) => page.items.length === 0}
          empty={{
            title: 'Nothing waiting.',
            hint: 'No verification case matches these filters right now.',
          }}
          onRetry={() => void query.refetch()}
        >
          {(page) => (
            <>
              <Table
                head={
                  <tr>
                    <Th>Technician</Th>
                    <Th>Level</Th>
                    <Th>Status</Th>
                    <Th>City</Th>
                    <Th>Waiting since</Th>
                    <Th />
                  </tr>
                }
              >
                {page.items.map((row) => (
                  <Tr key={row.caseId}>
                    <Td>
                      <AdminLink
                        className="font-medium text-blue-700 hover:underline"
                        href={`/providers/${row.providerId}`}
                      >
                        {row.providerName ?? row.providerId}
                      </AdminLink>
                    </Td>
                    <Td>{row.level}</Td>
                    <Td>
                      <StatusBadge status={row.status} />
                    </Td>
                    <Td>{row.cityId}</Td>
                    <Td>
                      <Timestamp value={row.openedAt} />
                    </Td>
                    <Td>
                      <AdminLink
                        className="text-blue-700 hover:underline"
                        href={`/verification/${row.caseId}`}
                      >
                        Open case
                      </AdminLink>
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
