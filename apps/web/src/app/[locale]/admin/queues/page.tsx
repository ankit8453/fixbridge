'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import {
  discardDelivery,
  discardOutbox,
  discardWebhook,
  fetchParkedDeliveries,
  fetchParkedOutbox,
  fetchParkedWebhooks,
  reprocessWebhook,
  retryDelivery,
  retryOutbox,
} from '@/components/admin/lib/api';
import { useAdminMutation } from '@/components/admin/lib/mutations';
import { useFilters } from '@/components/admin/lib/filters';
import { ConfirmDialog, reasonField } from '@/components/admin/ConfirmDialog';
import { PageHeader } from '@/components/admin/Shell';
import { Timestamp } from '@/components/admin/Timestamp';
import { Button, Card, Pagination, QueryState, Spinner, Table, Td, Th, Tr } from '@/components/ui';

type Tab = 'outbox' | 'webhooks' | 'deliveries';

const TABS: { id: Tab; label: string; blurb: string }[] = [
  {
    id: 'outbox',
    label: 'Outbox',
    blurb:
      'Domain events whose retry budget is spent. Every consumer is idempotent, which is what makes a retry button safe to offer at all.',
  },
  {
    id: 'webhooks',
    label: 'Webhooks',
    blurb:
      'Gateway events the processor could not apply. The gateway webhook is the only source of payment truth, so each of these is money the ledger has not heard about.',
  },
  {
    id: 'deliveries',
    label: 'Deliveries',
    blurb:
      'Notifications that could not be sent. Parked, never dropped — a message nobody could send is a fact for a human.',
  },
];

/**
 * The three parked lists, and the reason they exist at all. Ported from
 * apps/admin/src/pages/QueuesPage.tsx.
 *
 * Phases 6, 8 and 10 each chose to keep their failures rather than delete
 * them, on the argument that a human would eventually need to see them.
 * This page is that human finally getting to. Discarding is therefore never
 * a delete: the row is marked processed with the reason recorded against
 * it. All three lists (and the discard dialog inside each) are ops-
 * accessible — "parked-queue retries" is explicitly judgment work in the
 * Phase 12 permission split, and none of these three routes appear in
 * `ADMIN_ONLY_ROUTES`.
 */
export default function QueuesPage() {
  const [tab, setTab] = useState<Tab>('outbox');
  const active = TABS.find((entry) => entry.id === tab) ?? TABS[0];

  return (
    <>
      <PageHeader title="Parked queues" subtitle={active?.blurb} />

      <div className="mb-4 flex gap-2">
        {TABS.map((entry) => (
          <Button
            key={entry.id}
            variant={entry.id === tab ? 'primary' : 'secondary'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <Suspense fallback={<Spinner label="Loading…" />}>
        {tab === 'outbox' ? <OutboxList /> : null}
        {tab === 'webhooks' ? <WebhookList /> : null}
        {tab === 'deliveries' ? <DeliveryList /> : null}
      </Suspense>
    </>
  );
}

/** The discard dialog is identical in all three lists; only the endpoint differs. */
function DiscardDialog({
  what,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  what: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  return (
    <ConfirmDialog
      title={`Discard this ${what}`}
      description="The row is kept and marked processed with your reason on it — it is evidence that something was published and never delivered. Nothing is deleted."
      confirmLabel="Discard"
      tone="danger"
      pending={pending}
      error={error}
      fields={[reasonField('Reason', 'Why it is acceptable that this never went out.')]}
      onClose={onClose}
      onConfirm={(values) => onConfirm(values.reason ?? '')}
    />
  );
}

function OutboxList() {
  const filters = useFilters();
  const [discarding, setDiscarding] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'queues', 'outbox', filters.page],
    queryFn: () => fetchParkedOutbox(filters.page),
  });

  const invalidate = [
    ['admin', 'queues'],
    ['admin', 'summary'],
  ];
  const retry = useAdminMutation((id: string) => retryOutbox(id), { invalidate });
  const discard = useAdminMutation(
    (input: { id: string; reason: string }) => discardOutbox(input.id, input.reason),
    { invalidate, onDone: () => setDiscarding(null) },
  );

  return (
    <Card title="Parked outbox events">
      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading parked outbox events…"
        isEmpty={(page) => page.items.length === 0}
        empty={{ title: 'Nothing parked.', hint: 'Every published event has been delivered.' }}
        onRetry={() => void query.refetch()}
      >
        {(page) => (
          <>
            <Table
              head={
                <tr>
                  <Th>Topic</Th>
                  <Th>Aggregate</Th>
                  <Th>Attempts</Th>
                  <Th>Last error</Th>
                  <Th>Published</Th>
                  <Th />
                </tr>
              }
            >
              {page.items.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium">{row.topic}</Td>
                  <Td>
                    {row.aggregateType}
                    <div className="text-xs text-slate-500">{row.aggregateId ?? '—'}</div>
                  </Td>
                  <Td className="tabular-nums">{row.attempts}</Td>
                  <Td className="max-w-sm truncate text-xs text-red-800">{row.lastError ?? '—'}</Td>
                  <Td>
                    <Timestamp value={row.createdAt} />
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(row.id)}
                      >
                        Retry
                      </Button>
                      <Button variant="danger" onClick={() => setDiscarding(row.id)}>
                        Discard
                      </Button>
                    </div>
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

      {discarding ? (
        <DiscardDialog
          what="outbox event"
          pending={discard.isPending}
          error={discard.error}
          onClose={() => setDiscarding(null)}
          onConfirm={(reason) => discard.mutate({ id: discarding, reason })}
        />
      ) : null}
    </Card>
  );
}

function WebhookList() {
  const filters = useFilters();
  const [discarding, setDiscarding] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'queues', 'webhooks', filters.page],
    queryFn: () => fetchParkedWebhooks(filters.page),
  });

  const invalidate = [
    ['admin', 'queues'],
    ['admin', 'summary'],
    ['admin', 'ledger'],
  ];
  const reprocess = useAdminMutation((id: string) => reprocessWebhook(id), { invalidate });
  const discard = useAdminMutation(
    (input: { id: string; reason: string }) => discardWebhook(input.id, input.reason),
    { invalidate, onDone: () => setDiscarding(null) },
  );

  return (
    <Card title="Unprocessed webhook events">
      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading webhook events…"
        isEmpty={(page) => page.items.length === 0}
        empty={{ title: 'Nothing stuck.', hint: 'Every gateway event has been applied.' }}
        onRetry={() => void query.refetch()}
      >
        {(page) => (
          <>
            <Table
              head={
                <tr>
                  <Th>Event type</Th>
                  <Th>Gateway id</Th>
                  <Th>Error</Th>
                  <Th>Received</Th>
                  <Th />
                </tr>
              }
            >
              {page.items.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium">{row.eventType}</Td>
                  <Td className="text-xs">{row.gatewayEventId}</Td>
                  <Td className="max-w-sm truncate text-xs text-red-800">
                    {row.processingError ?? 'never processed'}
                  </Td>
                  <Td>
                    <Timestamp value={row.receivedAt} />
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={reprocess.isPending}
                        onClick={() => reprocess.mutate(row.id)}
                      >
                        Reprocess
                      </Button>
                      <Button variant="danger" onClick={() => setDiscarding(row.id)}>
                        Discard
                      </Button>
                    </div>
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

      {discarding ? (
        <DiscardDialog
          what="webhook event"
          pending={discard.isPending}
          error={discard.error}
          onClose={() => setDiscarding(null)}
          onConfirm={(reason) => discard.mutate({ id: discarding, reason })}
        />
      ) : null}
    </Card>
  );
}

function DeliveryList() {
  const filters = useFilters();
  const [discarding, setDiscarding] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'queues', 'deliveries', filters.page],
    queryFn: () => fetchParkedDeliveries(filters.page),
  });

  const invalidate = [
    ['admin', 'queues'],
    ['admin', 'summary'],
  ];
  const retry = useAdminMutation((id: string) => retryDelivery(id), { invalidate });
  const discard = useAdminMutation(
    (input: { id: string; reason: string }) => discardDelivery(input.id, input.reason),
    { invalidate, onDone: () => setDiscarding(null) },
  );

  return (
    <Card title="Parked notification deliveries">
      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading parked deliveries…"
        isEmpty={(page) => page.items.length === 0}
        empty={{ title: 'Nothing parked.', hint: 'Every message reached its transport.' }}
        onRetry={() => void query.refetch()}
      >
        {(page) => (
          <>
            <Table
              head={
                <tr>
                  <Th>Recipient</Th>
                  <Th>Topic</Th>
                  <Th>Channel</Th>
                  <Th>Attempts</Th>
                  <Th>Last error</Th>
                  <Th>Queued</Th>
                  <Th />
                </tr>
              }
            >
              {page.items.map((row) => (
                <Tr key={row.id}>
                  <Td>{row.recipient?.name ?? row.recipient?.id ?? '—'}</Td>
                  <Td>{row.notification?.topic ?? row.topic}</Td>
                  <Td>{row.channel}</Td>
                  <Td className="tabular-nums">{row.attempts}</Td>
                  <Td className="max-w-sm truncate text-xs text-red-800">{row.lastError ?? '—'}</Td>
                  <Td>
                    <Timestamp value={row.createdAt} />
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(row.id)}
                      >
                        Send again
                      </Button>
                      <Button variant="danger" onClick={() => setDiscarding(row.id)}>
                        Discard
                      </Button>
                    </div>
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

      {discarding ? (
        <DiscardDialog
          what="delivery"
          pending={discard.isPending}
          error={discard.error}
          onClose={() => setDiscarding(null)}
          onConfirm={(reason) => discard.mutate({ id: discarding, reason })}
        />
      ) : null}
    </Card>
  );
}
