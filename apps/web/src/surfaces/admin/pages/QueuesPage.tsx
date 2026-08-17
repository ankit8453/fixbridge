import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
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
} from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import { useFilters } from '../lib/filters';
import type { DeliveryRow, OutboxRow, WebhookRow } from '../lib/types';
import { ConfirmDialog, reasonField } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import {
  Button,
  Card,
  Pagination,
  QueryState,
  Table,
  Tabs,
  type TableColumn,
} from '@/components/ui';

type Tab = 'outbox' | 'webhooks' | 'deliveries';

const TABS: { value: Tab; label: string; blurb: string }[] = [
  {
    value: 'outbox',
    label: 'Outbox',
    blurb:
      'Domain events whose retry budget is spent. Every consumer is idempotent, which is what makes a retry button safe to offer at all.',
  },
  {
    value: 'webhooks',
    label: 'Webhooks',
    blurb:
      'Gateway events the processor could not apply. The gateway webhook is the only source of payment truth, so each of these is money the ledger has not heard about.',
  },
  {
    value: 'deliveries',
    label: 'Deliveries',
    blurb:
      'Notifications that could not be sent. Parked, never dropped — a message nobody could send is a fact for a human.',
  },
];

/**
 * The three parked lists, and the reason they exist at all. Ported from
 * `legacy-next-src/app/[locale]/admin/queues/page.tsx`.
 *
 * Several phases each chose to keep their failures rather than delete them,
 * on the argument that a human would eventually need to see them. This page
 * is that human finally getting to. Discarding is therefore never a delete:
 * the row is marked processed with the reason recorded against it. All
 * three lists (and the discard dialog inside each) are ops-accessible —
 * "parked-queue retries" is explicitly judgment work in the permission
 * split, and none of these three routes appear in `ADMIN_ONLY_ROUTES`.
 */
export default function QueuesPage() {
  const [tab, setTab] = useState<Tab>('outbox');
  const active = TABS.find((entry) => entry.value === tab) ?? TABS[0];

  return (
    <>
      <PageHeader title="Parked queues" subtitle={active?.blurb} />

      <div className="mb-4">
        <Tabs tabs={TABS} value={tab} onChange={(value) => setTab(value as Tab)} />
      </div>

      {tab === 'outbox' ? <OutboxList /> : null}
      {tab === 'webhooks' ? <WebhookList /> : null}
      {tab === 'deliveries' ? <DeliveryList /> : null}
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

  const columns: TableColumn<OutboxRow>[] = [
    {
      key: 'topic',
      header: 'Topic',
      render: (row) => <span className="font-medium">{row.topic}</span>,
    },
    {
      key: 'aggregate',
      header: 'Aggregate',
      render: (row) => (
        <>
          {row.aggregateType}
          <div className="text-xs text-muted">{row.aggregateId ?? '—'}</div>
        </>
      ),
    },
    { key: 'attempts', header: 'Attempts', align: 'right', render: (row) => row.attempts },
    {
      key: 'lastError',
      header: 'Last error',
      render: (row) => (
        <span className="block max-w-sm truncate text-xs text-red-800">{row.lastError ?? '—'}</span>
      ),
    },
    { key: 'published', header: 'Published', render: (row) => <Timestamp value={row.createdAt} /> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
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
      ),
    },
  ];

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

  const columns: TableColumn<WebhookRow>[] = [
    {
      key: 'eventType',
      header: 'Event type',
      render: (row) => <span className="font-medium">{row.eventType}</span>,
    },
    {
      key: 'gatewayId',
      header: 'Gateway id',
      render: (row) => <span className="text-xs">{row.gatewayEventId}</span>,
    },
    {
      key: 'error',
      header: 'Error',
      render: (row) => (
        <span className="block max-w-sm truncate text-xs text-red-800">
          {row.processingError ?? 'never processed'}
        </span>
      ),
    },
    { key: 'received', header: 'Received', render: (row) => <Timestamp value={row.receivedAt} /> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
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
      ),
    },
  ];

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

  const columns: TableColumn<DeliveryRow>[] = [
    {
      key: 'recipient',
      header: 'Recipient',
      render: (row) => row.recipient?.name ?? row.recipient?.id ?? '—',
    },
    { key: 'topic', header: 'Topic', render: (row) => row.notification?.topic ?? row.topic },
    { key: 'channel', header: 'Channel', render: (row) => row.channel },
    { key: 'attempts', header: 'Attempts', align: 'right', render: (row) => row.attempts },
    {
      key: 'lastError',
      header: 'Last error',
      render: (row) => (
        <span className="block max-w-sm truncate text-xs text-red-800">{row.lastError ?? '—'}</span>
      ),
    },
    { key: 'queued', header: 'Queued', render: (row) => <Timestamp value={row.createdAt} /> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
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
      ),
    },
  ];

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
