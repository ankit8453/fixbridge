import { useQuery } from '@tanstack/react-query';
import { fetchAuditLogs } from '../lib/api';
import { useFilters } from '../lib/filters';
import { dateInputToIso } from '../lib/time';
import type { AuditRow } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import {
  Card,
  Field,
  Pagination,
  QueryState,
  Table,
  TextInput,
  type TableColumn,
} from '@/components/ui';

/**
 * The audit log. Read-only, and it will stay that way. Ported from
 * `legacy-next-src/app/[locale]/admin/audit/page.tsx`.
 *
 * Every mutation in this surface writes one of these rows in the same
 * transaction as the change itself, so this list is the record of what ops
 * did — including what the person reading it did. There is deliberately no
 * delete, no edit and no export: a log somebody can tidy is not a log.
 *
 * The server forces the filter server-side — an ops token only ever gets
 * rows it authored (`scope: 'own'`), admin gets everything (`scope: 'all'`,
 * see `apps/api/src/modules/admin/routes.ts`). The banner below says which
 * one the viewer is looking at; an ops user scrolling their own five
 * actions must not read that list as "nothing else happened today".
 */
export default function AuditPage() {
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

  const query = useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () => fetchAuditLogs(params),
  });

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

  const columns: TableColumn<AuditRow>[] = [
    { key: 'when', header: 'When', render: (row) => <Timestamp value={row.createdAt} /> },
    {
      key: 'actor',
      header: 'Actor',
      render: (row) => (
        <>
          {row.actor?.name ?? row.actorUserId}
          <div className="text-xs text-muted">{row.actor?.phone}</div>
        </>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => <span className="font-medium">{row.action}</span>,
    },
    {
      key: 'target',
      header: 'Target',
      render: (row) => (
        <>
          {row.targetType}
          <div className="text-xs text-muted">{row.targetId ?? '—'}</div>
        </>
      ),
    },
    {
      key: 'payload',
      header: 'Payload',
      render: (row) => (
        // Printed raw. The payload carries the substance — before/after, the
        // note, the amount — and summarising it here would defeat the point
        // of storing it.
        <pre className="max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      ),
    },
    {
      key: 'request',
      header: 'Request',
      render: (row) => (
        <span className="text-xs text-muted">
          {row.requestId ?? '—'}
          <div>{row.ip ?? ''}</div>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every ops decision, with the note that was typed at the time. Read-only."
      />

      {query.data ? (
        <div
          className={`mb-4 rounded-xl border px-4 py-2.5 text-sm ${
            query.data.scope === 'all'
              ? 'border-border bg-surface text-slate-700'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {query.data.scope === 'all' ? (
            'Showing every action, by everyone — you hold the admin role.'
          ) : (
            <>
              Showing <strong>only your own actions</strong>. Ops accounts see their own history
              here, not the whole log; ask an admin if you need to review someone else's.
            </>
          )}
        </div>
      ) : null}

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
          isEmpty={(data) => data.page.items.length === 0}
          empty={{ title: 'No audit entries match those filters.' }}
          onRetry={() => void query.refetch()}
        >
          {(data) => (
            <>
              <Table columns={columns} rows={data.page.items} rowKey={(row) => row.id} />
              <Pagination
                page={data.page.page}
                pageSize={data.page.pageSize}
                total={data.page.total}
                onChange={filters.setPage}
              />
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
}
