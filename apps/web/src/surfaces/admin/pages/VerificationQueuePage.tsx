import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchVerificationQueue } from '../lib/api';
import { useFilters } from '../lib/filters';
import type { VerificationQueueRow } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import {
  Card,
  Field,
  Pagination,
  QueryState,
  Select,
  Table,
  type TableColumn,
} from '@/components/ui';

/** Ported from `legacy-next-src/app/[locale]/admin/verification/page.tsx`. */
const STATUSES = ['submitted', 'in_review', 'needs_info', 'passed', 'failed'];

export default function VerificationQueuePage() {
  const filters = useFilters();
  const status = filters.get('status');
  const level = filters.get('level');

  const query = useQuery({
    queryKey: ['admin', 'verification', 'queue', { status, level, page: filters.page }],
    queryFn: () => fetchVerificationQueue({ status, level, page: filters.page }),
  });

  const columns: TableColumn<VerificationQueueRow>[] = [
    {
      key: 'provider',
      header: 'Technician',
      render: (row) => (
        <Link
          className="font-medium text-brand hover:underline"
          to={`/admin/providers/${row.providerId}`}
        >
          {row.providerName ?? row.providerId}
        </Link>
      ),
    },
    { key: 'level', header: 'Level', render: (row) => row.level },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    { key: 'city', header: 'City', render: (row) => row.cityId },
    {
      key: 'openedAt',
      header: 'Waiting since',
      render: (row) => <Timestamp value={row.openedAt} />,
    },
    {
      key: 'open',
      header: '',
      render: (row) => (
        <Link className="text-brand hover:underline" to={`/admin/verification/${row.caseId}`}>
          Open case
        </Link>
      ),
    },
  ];

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
              <Table columns={columns} rows={page.items} rowKey={(row) => row.caseId} />
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
