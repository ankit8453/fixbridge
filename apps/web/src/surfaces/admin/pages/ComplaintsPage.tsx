import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchComplaints } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { Complaint } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import {
  Badge,
  Card,
  Field,
  Pagination,
  QueryState,
  Select,
  Table,
  type TableColumn,
} from '@/components/ui';

const STATUSES = ['open', 'in_review', 'resolved', 'dismissed'];

/** Ported from `legacy-next-src/app/[locale]/admin/complaints/page.tsx`. */
export default function ComplaintsPage() {
  const filters = useFilters();
  const status = filters.get('status');

  const query = useQuery({
    queryKey: ['admin', 'complaints', { status, page: filters.page }],
    queryFn: () => fetchComplaints({ status, page: filters.page }),
  });

  const columns: TableColumn<Complaint>[] = [
    { key: 'raised', header: 'Raised', render: (row) => <Timestamp value={row.createdAt} /> },
    {
      key: 'category',
      header: 'Category',
      render: (row) =>
        row.category === 'safety' ? <Badge tone="danger">safety</Badge> : row.category,
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'severity', header: 'Severity', render: (row) => row.severity ?? '—' },
    {
      key: 'description',
      header: 'Description',
      render: (row) => <span className="block max-w-md truncate">{row.description}</span>,
    },
    {
      key: 'open',
      header: '',
      render: (row) => (
        <Link className="text-brand hover:underline" to={`/admin/complaints/${row.id}`}>
          Open
        </Link>
      ),
    },
  ];

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
              <Table columns={columns} rows={page.items} rowKey={(row) => row.id} />
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
