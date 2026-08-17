'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { fetchComplaints } from '@/components/admin/lib/api';
import { useFilters } from '@/components/admin/lib/filters';
import { AdminLink } from '@/components/admin/AdminLink';
import { PageHeader } from '@/components/admin/Shell';
import { Timestamp } from '@/components/admin/Timestamp';
import { StatusBadge } from '@/components/admin/ui/Badge';
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
  Th,
  Tr,
} from '@/components/ui';

const STATUSES = ['open', 'in_review', 'resolved', 'dismissed'];

/** Ported from apps/admin/src/pages/ComplaintsPage.tsx. */
export default function ComplaintsPage() {
  return (
    <Suspense fallback={<Spinner label="Loading the complaints queue…" />}>
      <ComplaintsContent />
    </Suspense>
  );
}

function ComplaintsContent() {
  const filters = useFilters();
  const status = filters.get('status');

  const query = useQuery({
    queryKey: ['admin', 'complaints', { status, page: filters.page }],
    queryFn: () => fetchComplaints({ status, page: filters.page }),
  });

  return (
    <>
      <PageHeader
        title="Complaints"
        subtitle="Oldest first. A safety complaint from a customer has already suspended the technician — your decision either stands it up or lifts it."
      />

      <Card
        title="Queue"
        actions={
          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={status ?? ''}
                onChange={(event) => filters.set('status', event.target.value || undefined)}
              >
                <option value="">All</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        }
      >
        <QueryState
          status={query.status}
          error={query.error}
          data={query.data}
          loadingLabel="Loading the complaints queue…"
          isEmpty={(page) => page.items.length === 0}
          empty={{ title: 'Nothing in the queue.', hint: 'No complaint matches this filter.' }}
          onRetry={() => void query.refetch()}
        >
          {(page) => (
            <>
              <Table
                head={
                  <tr>
                    <Th>Raised</Th>
                    <Th>Category</Th>
                    <Th>Status</Th>
                    <Th>Severity</Th>
                    <Th>Description</Th>
                    <Th />
                  </tr>
                }
              >
                {page.items.map((complaint) => (
                  <Tr key={complaint.id}>
                    <Td>
                      <Timestamp value={complaint.createdAt} />
                    </Td>
                    <Td>
                      {complaint.category === 'safety' ? (
                        <Badge tone="bad">safety</Badge>
                      ) : (
                        complaint.category
                      )}
                    </Td>
                    <Td>
                      <StatusBadge status={complaint.status} />
                    </Td>
                    <Td>{complaint.severity ?? '—'}</Td>
                    <Td className="max-w-md truncate">{complaint.description}</Td>
                    <Td>
                      <AdminLink
                        className="text-blue-700 hover:underline"
                        href={`/complaints/${complaint.id}`}
                      >
                        Open
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
