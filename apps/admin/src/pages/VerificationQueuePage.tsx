import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchVerificationQueue } from '../api/endpoints';
import { PageHeader } from '../components/Layout';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Field, Select } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { QueryState } from '../components/ui/States';
import { Table, Td, Th, Tr } from '../components/ui/Table';
import { useFilters } from '../lib/filters';

const STATUSES = ['submitted', 'in_review', 'needs_info', 'passed', 'failed'];

export function VerificationQueuePage() {
  const filters = useFilters();
  const status = filters.get('status');
  const level = filters.get('level');

  const query = useQuery({
    queryKey: ['verification', 'queue', { status, level, page: filters.page }],
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
                      <Link
                        className="font-medium text-blue-700 hover:underline"
                        to={`/providers/${row.providerId}`}
                      >
                        {row.providerName ?? row.providerId}
                      </Link>
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
                      <Link
                        className="text-blue-700 hover:underline"
                        to={`/verification/${row.caseId}`}
                      >
                        Open case
                      </Link>
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
