import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CheckCircle2,
  Inbox,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  TriangleAlert,
  Webhook,
} from 'lucide-react';
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
import { Timestamp } from '../components/Timestamp';
import { relativeTime } from '../lib/time';
import {
  AdminButton,
  Card,
  EmptyState,
  Pill,
  SectionHeader,
  SkeletonRows,
  type Tone,
} from '../components/ui';
import { ErrorState, Pagination } from '@/components/ui';

type Tab = 'outbox' | 'webhooks' | 'deliveries';

const TABS: { value: Tab; label: string; icon: typeof Inbox; blurb: string }[] = [
  {
    value: 'outbox',
    label: 'Outbox',
    icon: Inbox,
    blurb:
      'Domain events whose retry budget is spent. Every consumer is idempotent, which is what makes a retry button safe to offer at all.',
  },
  {
    value: 'webhooks',
    label: 'Webhooks',
    icon: Webhook,
    blurb:
      'Gateway events the processor could not apply. The gateway webhook is the only source of payment truth, so each of these is money the ledger has not heard about.',
  },
  {
    value: 'deliveries',
    label: 'Deliveries',
    icon: Send,
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
    <div className="space-y-4">
      <SectionHeader title="Parked queues" description={active?.blurb} />

      {/* A segmented control rather than underline tabs: three destinations,
          all of them equally likely, and this reads as one control. */}
      <div
        role="tablist"
        aria-label="Parked queue"
        className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const selected = entry.value === tab;
          return (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(entry.value)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors ${
                selected
                  ? 'bg-admin-soft text-admin-deep'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon
                className={`h-4 w-4 ${selected ? 'text-admin' : 'text-slate-400'}`}
                aria-hidden="true"
                strokeWidth={2}
              />
              {entry.label}
            </button>
          );
        })}
      </div>

      {tab === 'outbox' ? <OutboxList /> : null}
      {tab === 'webhooks' ? <WebhookList /> : null}
      {tab === 'deliveries' ? <DeliveryList /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* "How stuck is this"                                                        */
/* -------------------------------------------------------------------------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Age is the whole judgement on this screen.
 *
 * A webhook parked ten minutes ago is probably a blip somebody is already
 * fixing; the same row three days later is a hole in the ledger nobody has
 * looked at. So every row wears its age as a coloured pill rather than
 * making a reviewer subtract two timestamps in their head.
 */
function ageTone(iso: string): Tone {
  const age = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(age)) return 'neutral';
  if (age >= 3 * DAY) return 'danger';
  if (age >= DAY) return 'warning';
  if (age >= HOUR) return 'info';
  return 'neutral';
}

function StuckFor({ since }: { since: string }) {
  return (
    <span title={since}>
      <Pill tone={ageTone(since)}>stuck {relativeTime(since).replace(/ ago$/, '')}</Pill>
    </span>
  );
}

/**
 * Attempts spent, as a five-pip meter.
 *
 * The retry budget is what separates "the transport hiccuped" from "this will
 * never send" — five filled pips means every automatic retry is gone and the
 * only thing left is a human. The count is printed beside it.
 */
function Attempts({ count }: { count: number }) {
  const pips = 5;
  const filled = Math.min(count, pips);

  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {Array.from({ length: pips }, (_, i) => (
          <span
            key={i}
            className={`block h-3 w-1 rounded-sm ${
              i < filled ? (filled >= pips ? 'bg-danger' : 'bg-warning') : 'bg-slate-200'
            }`}
          />
        ))}
      </span>
      <span className="tabular-nums text-slate-700">{count}</span>
    </span>
  );
}

/** The last error, kept short on the row and complete in the tooltip. */
function LastError({ message }: { message: string | null }) {
  if (!message) return <span className="text-slate-400">—</span>;

  return (
    <span
      title={message}
      className="flex max-w-sm items-start gap-1.5 text-xs leading-relaxed text-danger"
    >
      <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={2} />
      <span className="line-clamp-2 min-w-0 break-words">{message}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared list scaffolding                                                    */
/* -------------------------------------------------------------------------- */

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

function RowActions({
  retryLabel,
  retryIcon: RetryIcon,
  retrying,
  onRetry,
  onDiscard,
}: {
  retryLabel: string;
  retryIcon: typeof RotateCcw;
  retrying: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex justify-end gap-1.5">
      <AdminButton size="sm" variant="secondary" disabled={retrying} onClick={onRetry}>
        <RetryIcon className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        {retryLabel}
      </AdminButton>
      <AdminButton size="sm" variant="danger" onClick={onDiscard}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        Discard
      </AdminButton>
    </div>
  );
}

/**
 * Loading / error / empty around one parked list, so all three read the same.
 *
 * `oldest` is deliberately not computed from the whole table — only the page
 * on screen — because that is the only data this screen has, and implying
 * otherwise would be a lie about the queue's real depth.
 */
function ListShell<T>({
  title,
  description,
  query,
  filters,
  empty,
  children,
  summary,
}: {
  title: string;
  description: string;
  query: ReturnType<typeof useQuery<{ items: T[]; page: number; pageSize: number; total: number }>>;
  filters: { setPage: (page: number) => void };
  empty: { title: string; description: string };
  children: (items: T[]) => React.ReactNode;
  summary?: (items: T[]) => React.ReactNode;
}) {
  const data = query.data;

  return (
    <Card
      title={title}
      description={description}
      action={
        data ? <Pill tone={data.total > 0 ? 'danger' : 'success'}>{data.total} parked</Pill> : null
      }
      padded={false}
    >
      {query.status === 'pending' ? (
        <SkeletonRows rows={6} />
      ) : query.status === 'error' || data === undefined ? (
        <div className="p-4">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={empty.title} description={empty.description} />
      ) : (
        <>
          {summary ? summary(data.items) : null}
          {children(data.items)}
          <div className="px-4 pb-3">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onChange={filters.setPage}
            />
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The age distribution of everything on this page, as one bar.
 *
 * A queue of thirty rows all parked in the last hour is an incident in
 * progress; thirty rows spread over a week is a backlog nobody owns. That
 * distinction is invisible in a table sorted by time and obvious in one bar,
 * which is why this is drawn rather than listed. Every band's count is
 * printed in the legend, so the bar carries no information the text does not.
 */
function AgeBar({ timestamps }: { timestamps: string[] }) {
  const bands = [
    { label: 'Under an hour', tone: 'bg-slate-300', count: 0 },
    { label: 'Today', tone: 'bg-admin-alt', count: 0 },
    { label: 'Over a day', tone: 'bg-warning', count: 0 },
    { label: 'Over three days', tone: 'bg-danger', count: 0 },
  ];

  for (const iso of timestamps) {
    const age = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(age)) continue;
    if (age >= 3 * DAY) bands[3]!.count += 1;
    else if (age >= DAY) bands[2]!.count += 1;
    else if (age >= HOUR) bands[1]!.count += 1;
    else bands[0]!.count += 1;
  }

  const total = timestamps.length || 1;

  return (
    <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Age of this page
        </p>
        <p className="text-xs text-slate-500">{timestamps.length} rows shown</p>
      </div>

      <div
        aria-hidden="true"
        className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-200"
      >
        {bands
          .filter((band) => band.count > 0)
          .map((band) => (
            <span
              key={band.label}
              className={band.tone}
              style={{ width: `${((band.count / total) * 100).toFixed(2)}%` }}
            />
          ))}
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {bands.map((band) => (
          <li key={band.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${band.tone}`} />
            {band.label}
            <span className="font-semibold tabular-nums text-slate-900">{band.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableHead({ headers }: { headers: { label: string; align?: 'right' }[] }) {
  return (
    <thead>
      <tr className="border-b border-slate-200 bg-slate-50 text-left">
        {headers.map((header) => (
          <th
            key={header.label || 'actions'}
            scope="col"
            className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
              header.align === 'right' ? 'text-right' : ''
            }`}
          >
            {header.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/* -------------------------------------------------------------------------- */
/* Outbox                                                                     */
/* -------------------------------------------------------------------------- */

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
    <>
      <ListShell<OutboxRow>
        title="Parked outbox events"
        description="Published, never consumed. Retrying is safe — every consumer is idempotent."
        query={query}
        filters={filters}
        empty={{
          title: 'Nothing parked.',
          description: 'Every published event has been delivered to its consumers.',
        }}
        summary={(items) => <AgeBar timestamps={items.map((row) => row.createdAt)} />}
      >
        {(items) => (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <TableHead
                headers={[
                  { label: 'Topic' },
                  { label: 'Aggregate' },
                  { label: 'Attempts' },
                  { label: 'Last error' },
                  { label: 'Stuck for' },
                  { label: '', align: 'right' },
                ]}
              />
              <tbody className="divide-y divide-slate-100">
                {items.map((row) => (
                  <tr key={row.id} className="align-top transition-colors hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{row.topic}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {row.aggregateType}
                      <span className="block text-xs tabular-nums text-slate-400">
                        {row.aggregateId ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Attempts count={row.attempts} />
                    </td>
                    <td className="px-3 py-2.5">
                      <LastError message={row.lastError} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StuckFor since={row.createdAt} />
                      <span className="mt-0.5 block text-xs text-slate-400">
                        <Timestamp value={row.createdAt} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        retryLabel="Retry"
                        retryIcon={RotateCcw}
                        retrying={retry.isPending}
                        onRetry={() => retry.mutate(row.id)}
                        onDiscard={() => setDiscarding(row.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListShell>

      {discarding ? (
        <DiscardDialog
          what="outbox event"
          pending={discard.isPending}
          error={discard.error}
          onClose={() => setDiscarding(null)}
          onConfirm={(reason) => discard.mutate({ id: discarding, reason })}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

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
    <>
      <ListShell<WebhookRow>
        title="Unprocessed webhook events"
        description="Each of these is money the ledger has not heard about — the gateway webhook is the only source of payment truth."
        query={query}
        filters={filters}
        empty={{
          title: 'Nothing stuck.',
          description: 'Every gateway event has been applied to the ledger.',
        }}
        summary={(items) => <AgeBar timestamps={items.map((row) => row.receivedAt)} />}
      >
        {(items) => (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <TableHead
                headers={[
                  { label: 'Event type' },
                  { label: 'Gateway id' },
                  { label: 'Error' },
                  { label: 'Stuck for' },
                  { label: '', align: 'right' },
                ]}
              />
              <tbody className="divide-y divide-slate-100">
                {items.map((row) => (
                  <tr key={row.id} className="align-top transition-colors hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-semibold text-slate-900">{row.eventType}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">
                      {row.gatewayEventId}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.processingError ? (
                        <LastError message={row.processingError} />
                      ) : (
                        <Pill tone="warning">never processed</Pill>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StuckFor since={row.receivedAt} />
                      <span className="mt-0.5 block text-xs text-slate-400">
                        <Timestamp value={row.receivedAt} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        retryLabel="Reprocess"
                        retryIcon={RefreshCw}
                        retrying={reprocess.isPending}
                        onRetry={() => reprocess.mutate(row.id)}
                        onDiscard={() => setDiscarding(row.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListShell>

      {discarding ? (
        <DiscardDialog
          what="webhook event"
          pending={discard.isPending}
          error={discard.error}
          onClose={() => setDiscarding(null)}
          onConfirm={(reason) => discard.mutate({ id: discarding, reason })}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Deliveries                                                                 */
/* -------------------------------------------------------------------------- */

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
    <>
      <ListShell<DeliveryRow>
        title="Parked notification deliveries"
        description="Parked, never dropped — a message nobody could send is a fact for a human."
        query={query}
        filters={filters}
        empty={{
          title: 'Nothing parked.',
          description: 'Every message reached its transport.',
        }}
        summary={(items) => <AgeBar timestamps={items.map((row) => row.createdAt)} />}
      >
        {(items) => (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <TableHead
                headers={[
                  { label: 'Recipient' },
                  { label: 'Topic' },
                  { label: 'Channel' },
                  { label: 'Attempts' },
                  { label: 'Last error' },
                  { label: 'Stuck for' },
                  { label: '', align: 'right' },
                ]}
              />
              <tbody className="divide-y divide-slate-100">
                {items.map((row) => (
                  <tr key={row.id} className="align-top transition-colors hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-semibold text-slate-900">
                      {row.recipient?.name ?? row.recipient?.id ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {row.notification?.topic ?? row.topic}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone="neutral">{row.channel}</Pill>
                    </td>
                    <td className="px-3 py-2.5">
                      <Attempts count={row.attempts} />
                    </td>
                    <td className="px-3 py-2.5">
                      <LastError message={row.lastError} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StuckFor since={row.createdAt} />
                      <span className="mt-0.5 block text-xs text-slate-400">
                        <Timestamp value={row.createdAt} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        retryLabel="Send again"
                        retryIcon={Send}
                        retrying={retry.isPending}
                        onRetry={() => retry.mutate(row.id)}
                        onDiscard={() => setDiscarding(row.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListShell>

      {discarding ? (
        <DiscardDialog
          what="delivery"
          pending={discard.isPending}
          error={discard.error}
          onClose={() => setDiscarding(null)}
          onConfirm={(reason) => discard.mutate({ id: discarding, reason })}
        />
      ) : null}
    </>
  );
}
