import { useQuery } from '@tanstack/react-query';
import { Eye, Filter, ScrollText, ShieldCheck } from 'lucide-react';
import { fetchAuditLogs } from '../lib/api';
import { useFilters } from '../lib/filters';
import { dateInputToIso } from '../lib/time';
import type { AuditRow } from '../lib/types';
import { Timestamp } from '../components/Timestamp';
import { Card, EmptyState, Pill, SectionHeader, SkeletonRows } from '../components/ui';
import { ErrorState, Field, Pagination, Table, TextInput, type TableColumn } from '@/components/ui';

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
          <span className="font-medium text-slate-900">
            {row.actorAdmin?.name ?? row.actor?.name ?? row.actorAdminId ?? row.actorUserId}
          </span>
          <div className="text-xs tabular-nums text-slate-500">
            {row.actorAdmin?.email ?? row.actor?.phone}
          </div>
        </>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      // The action string is the row's identity — an ops user scanning for
      // "provider.suspend" is scanning this column and nothing else.
      render: (row) => <Pill tone="admin">{row.action}</Pill>,
    },
    {
      key: 'target',
      header: 'Target',
      render: (row) => (
        <>
          <span className="text-slate-700">{row.targetType}</span>
          <div className="font-mono text-xs text-slate-500">{row.targetId ?? '—'}</div>
        </>
      ),
    },
    {
      key: 'payload',
      header: 'Payload',
      render: (row) => (
        // Printed raw. The payload carries the substance — before/after, the
        // note, the amount — and summarising it here would defeat the point
        // of storing it. Capped in height so one fat payload cannot push
        // every other row off the screen; it scrolls inside its own box.
        <pre className="max-h-40 max-w-md overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      ),
    },
    {
      key: 'request',
      header: 'Request',
      render: (row) => (
        <span className="font-mono text-[11px] text-slate-500">
          {row.requestId ?? '—'}
          <span className="block">{row.ip ?? ''}</span>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Audit log"
        description="Every ops decision, with the note that was typed at the time. Read-only — no delete, no edit, no export."
      />

      {query.data ? (
        <div
          className={
            query.data.scope === 'all'
              ? 'flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-700'
              : 'flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[13px] text-slate-800'
          }
        >
          {query.data.scope === 'all' ? (
            <ShieldCheck
              className="mt-px h-4 w-4 shrink-0 text-admin"
              aria-hidden="true"
              strokeWidth={2}
            />
          ) : (
            <Eye
              className="mt-px h-4 w-4 shrink-0 text-warning"
              aria-hidden="true"
              strokeWidth={2}
            />
          )}
          <p className="min-w-0 leading-relaxed">
            {query.data.scope === 'all' ? (
              'Showing every action, by everyone — you hold the admin role.'
            ) : (
              <>
                Showing <strong className="font-semibold">only your own actions</strong>. Ops
                accounts see their own history here, not the whole log; ask an admin if you need to
                review someone else&apos;s.
              </>
            )}
          </p>
        </div>
      ) : null}

      <Card padded={false}>
        <div className="border-b border-slate-100 bg-slate-50/60 p-3">
          <div className="mb-2.5 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <Filter className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
            Filters
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
        </div>

        {query.status === 'pending' ? (
          <SkeletonRows rows={8} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.page.items.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit entries match those filters."
            description="Widen the date range, or clear the action and target filters."
          />
        ) : (
          <div className="p-3">
            <Table columns={columns} rows={query.data.page.items} rowKey={(row) => row.id} />
            <div className="mt-3">
              <Pagination
                page={query.data.page.page}
                pageSize={query.data.page.pageSize}
                total={query.data.page.total}
                onChange={filters.setPage}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
