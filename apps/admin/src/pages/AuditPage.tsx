import { useQuery } from '@tanstack/react-query';
import { fetchAuditLogs } from '../api/endpoints';
import { PageHeader } from '../components/Layout';
import { Timestamp } from '../components/Timestamp';
import { Card } from '../components/ui/Card';
import { Field, TextInput } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { QueryState } from '../components/ui/States';
import { Table, Td, Th, Tr } from '../components/ui/Table';
import { useFilters } from '../lib/filters';
import { dateInputToIso } from '../lib/time';

/**
 * The audit log. Read-only, and it will stay that way.
 *
 * Every mutation in this console writes one of these rows in the same
 * transaction as the change itself, so this list is the record of what ops did —
 * including what the person reading it did. There is deliberately no delete, no
 * edit and no export: a log somebody can tidy is not a log.
 */
export function AuditPage() {
  const filters = useFilters();

  const from = filters.get('from');
  const to = filters.get('to');

  const params = {
    actor_user_id: filters.get('actor_user_id'),
    action: filters.get('action'),
    target_type: filters.get('target_type'),
    target_id: filters.get('target_id'),
    from: dateInputToIso(from ?? '', 'start'),
    to: dateInputToIso(to ?? '', 'end'),
    page: filters.page,
  };

  const query = useQuery({ queryKey: ['audit', params], queryFn: () => fetchAuditLogs(params) });

  const text = (name: string, label: string, placeholder?: string) => (
    <Field key={name} label={label}>
      {(id) => (
        <TextInput
          id={id}
          defaultValue={filters.get(name) ?? ''}
          placeholder={placeholder}
          onBlur={(event) => filters.set(name, event.target.value.trim() || undefined)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              filters.set(name, event.currentTarget.value.trim() || undefined);
            }
          }}
        />
      )}
    </Field>
  );

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every ops decision, with the note that was typed at the time. Read-only."
      />

      <Card className="mb-4" title="Filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {text('actor_user_id', 'Actor user id')}
          {text('action', 'Action', 'provider.suspend')}
          {text('target_type', 'Target type', 'booking')}
          {text('target_id', 'Target id')}
          <Field label="From">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={from ?? ''}
                onChange={(event) => filters.set('from', event.target.value || undefined)}
              />
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={to ?? ''}
                onChange={(event) => filters.set('to', event.target.value || undefined)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title="Entries">
        <QueryState
          status={query.status}
          error={query.error}
          data={query.data}
          loadingLabel="Loading audit entries…"
          isEmpty={(page) => page.items.length === 0}
          empty={{ title: 'No audit entries match those filters.' }}
          onRetry={() => void query.refetch()}
        >
          {(page) => (
            <>
              <Table
                head={
                  <tr>
                    <Th>When</Th>
                    <Th>Actor</Th>
                    <Th>Action</Th>
                    <Th>Target</Th>
                    <Th>Payload</Th>
                    <Th>Request</Th>
                  </tr>
                }
              >
                {page.items.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Timestamp value={row.createdAt} />
                    </Td>
                    <Td>
                      {row.actor?.name ?? row.actorUserId}
                      <div className="text-xs text-slate-500">{row.actor?.phone}</div>
                    </Td>
                    <Td className="font-medium">{row.action}</Td>
                    <Td>
                      {row.targetType}
                      <div className="text-xs text-slate-500">{row.targetId ?? '—'}</div>
                    </Td>
                    <Td>
                      {/* Printed raw. The payload carries the substance —
                          before/after, the note, the amount — and summarising it
                          here would defeat the point of storing it. */}
                      <pre className="max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                        {JSON.stringify(row.payload, null, 2)}
                      </pre>
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {row.requestId ?? '—'}
                      <div>{row.ip ?? ''}</div>
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
