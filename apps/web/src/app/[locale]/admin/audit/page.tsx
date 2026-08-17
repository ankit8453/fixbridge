'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { fetchAuditLogs } from '@/components/admin/lib/api';
import { useFilters } from '@/components/admin/lib/filters';
import { dateInputToIso } from '@/components/admin/lib/time';
import { PageHeader } from '@/components/admin/Shell';
import { Timestamp } from '@/components/admin/Timestamp';
import {
  Card,
  ErrorState,
  Field,
  Pagination,
  Spinner,
  Table,
  Td,
  Th,
  TextInput,
  Tr,
} from '@/components/ui';

/**
 * The audit log. Read-only, and it will stay that way. Ported from
 * apps/admin/src/pages/AuditPage.tsx.
 *
 * Every mutation in this surface writes one of these rows in the same
 * transaction as the change itself, so this list is the record of what ops
 * did — including what the person reading it did. There is deliberately no
 * delete, no edit and no export: a log somebody can tidy is not a log.
 *
 * **Phase 12 correction:** the server now forces the filter server-side —
 * an ops token only ever gets rows it authored (`scope: 'own'`), admin gets
 * everything (`scope: 'all'`, see apps/api/src/modules/admin/routes.ts).
 * The banner below says which one the viewer is looking at; an ops user
 * scrolling their own five actions must not read that list as "nothing
 * else happened today".
 */
export default function AuditPage() {
  return (
    <Suspense fallback={<Spinner label="Loading audit entries…" />}>
      <AuditContent />
    </Suspense>
  );
}

function AuditContent() {
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
              ? 'border-slate-200 bg-white text-slate-700'
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
        {query.status === 'pending' ? (
          <Spinner label="Loading audit entries…" />
        ) : query.status === 'error' || !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data.page.items.length === 0 ? (
          <p className="text-sm text-slate-500">No audit entries match those filters.</p>
        ) : (
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
              {query.data.page.items.map((row) => (
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
              page={query.data.page.page}
              pageSize={query.data.page.pageSize}
              total={query.data.page.total}
              onChange={filters.setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
