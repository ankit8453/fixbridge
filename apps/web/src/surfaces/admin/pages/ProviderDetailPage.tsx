import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  Check,
  CircleCheck,
  CircleX,
  Eye,
  EyeOff,
  Gauge,
  ShieldCheck,
  Star,
  Undo2,
  Wallet as WalletIcon,
  X,
} from 'lucide-react';
import {
  approveProviderEntry,
  blockUser,
  fetchProvider,
  reinstateProvider,
  suspendProvider,
  unblockUser,
} from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import type { ProviderDetail } from '../lib/types';
import { ConfirmDialog, reasonField } from '../components/ConfirmDialog';
import { Timestamp } from '../components/Timestamp';
import { BadgeLevel, StatusBadge } from '../components/StatusBadge';
import {
  AdminButton,
  Card,
  DetailRow,
  EmptyState,
  Grid,
  Pill,
  StatTile,
  type Tone,
} from '../components/ui';
import { QueryState } from '@/components/ui';
import { formatPaise } from '@/lib/money';

type Action = 'suspend' | 'reinstate' | 'block' | 'unblock' | 'approve';

type RecentBooking = ProviderDetail['recentBookings'][number];

/**
 * The page most ops phone calls get answered on. Ported from
 * `legacy-next-src/app/[locale]/admin/providers/[providerId]/page.tsx`.
 *
 * A technician rings up asking why they are not getting work. There are
 * five independent reasons that could be true at once, so this page answers
 * all five separately and never makes ops deduce which gate is failing.
 */
export default function ProviderDetailPage() {
  const params = useParams<{ providerId: string }>();
  const providerId = params.providerId ?? '';
  const [action, setAction] = useState<Action | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'providers', 'detail', providerId],
    queryFn: () => fetchProvider(providerId),
  });

  const invalidate = [
    ['admin', 'providers'],
    ['admin', 'summary'],
  ];
  const close = () => setAction(null);

  const suspend = useAdminMutation(
    (values: { reason: string; days: string }) =>
      suspendProvider({
        providerId,
        reason: values.reason,
        days: values.days ? Number(values.days) : undefined,
      }),
    { invalidate, onDone: close },
  );

  const reinstate = useAdminMutation(
    (values: { reason: string }) => reinstateProvider(providerId, values.reason),
    { invalidate, onDone: close },
  );

  const approve = useAdminMutation(
    (values: { note: string }) => approveProviderEntry(providerId, values.note),
    { invalidate, onDone: close },
  );

  const block = useAdminMutation(
    (values: { userId: string; reason: string }) => blockUser(values.userId, values.reason),
    { invalidate, onDone: close },
  );

  const unblock = useAdminMutation(
    (values: { userId: string; reason: string }) => unblockUser(values.userId, values.reason),
    { invalidate, onDone: close },
  );

  return (
    <div className="space-y-4">
      <Link
        to="/admin/providers"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-admin hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
        Back to the list
      </Link>

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading the technician, their visibility gates, wallet and recent jobs…"
        onRetry={() => void query.refetch()}
      >
        {({ provider }) => (
          <div className="space-y-4">
            <Identity provider={provider} onAction={setAction} />

            <div className="grid gap-4 lg:grid-cols-2">
              <Visibility provider={provider} />
              <TrustInputs provider={provider} />
            </div>

            <Wallet provider={provider} />
            <RecentBookings provider={provider} />

            {action === 'suspend' ? (
              <ConfirmDialog
                title="Suspend this technician"
                description="They stop appearing in search immediately and cannot accept new work. Suspension is reversible and separate from verification."
                confirmLabel="Suspend"
                tone="danger"
                pending={suspend.isPending}
                error={suspend.error}
                fields={[
                  reasonField('Reason', 'Recorded in the audit log and quoted if they appeal.'),
                  {
                    name: 'days',
                    label: 'Days (optional)',
                    type: 'number',
                    required: false,
                    hint: 'Leave blank to use the configured default suspension length.',
                  },
                ]}
                onClose={close}
                onConfirm={(values) =>
                  suspend.mutate({ reason: values.reason ?? '', days: values.days ?? '' })
                }
              />
            ) : null}

            {action === 'reinstate' ? (
              <ConfirmDialog
                title="Lift this suspension"
                description="They become visible in search again as soon as the other gates pass."
                confirmLabel="Reinstate"
                pending={reinstate.isPending}
                error={reinstate.error}
                fields={[reasonField('Reason')]}
                onClose={close}
                onConfirm={(values) => reinstate.mutate({ reason: values.reason ?? '' })}
              />
            ) : null}

            {action === 'approve' ? (
              <ConfirmDialog
                title="Approve entry"
                description="This city requires a human to wave new technicians onto the platform."
                confirmLabel="Approve"
                pending={approve.isPending}
                error={approve.error}
                fields={[reasonField('Note', 'What you checked before approving.')]}
                onClose={close}
                onConfirm={(values) => approve.mutate({ note: values.reason ?? '' })}
              />
            ) : null}

            {action === 'block' ? (
              <ConfirmDialog
                title="Block this account"
                description="Blocking revokes every session immediately — they are signed out of the app, not merely hidden. This is heavier than a suspension."
                confirmLabel="Block account"
                tone="danger"
                pending={block.isPending}
                error={block.error}
                fields={[reasonField('Reason')]}
                onClose={close}
                onConfirm={(values) =>
                  block.mutate({ userId: provider.user.id, reason: values.reason ?? '' })
                }
              />
            ) : null}

            {action === 'unblock' ? (
              <ConfirmDialog
                title="Unblock this account"
                confirmLabel="Unblock account"
                pending={unblock.isPending}
                error={unblock.error}
                fields={[reasonField('Reason')]}
                onClose={close}
                onConfirm={(values) =>
                  unblock.mutate({ userId: provider.user.id, reason: values.reason ?? '' })
                }
              />
            ) : null}
          </div>
        )}
      </QueryState>
    </div>
  );
}

/**
 * Completeness against the listing threshold, as a ring.
 *
 * "Why am I not in search" is often just this number, and a ring says
 * "nearly there" or "barely started" faster than two digits do. The score is
 * printed inside it, so the ring carries no information the text does not.
 */
function CompletenessRing({ score, listed }: { score: number; listed: boolean }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const length = (clamped / 100) * circumference;

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[76px] w-[76px] shrink-0">
        <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle
            cx="38"
            cy="38"
            r={radius}
            fill="none"
            className="stroke-slate-100"
            strokeWidth="8"
          />
          <circle
            cx="38"
            cy="38"
            r={radius}
            fill="none"
            className={listed ? 'stroke-admin' : 'stroke-warning'}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${length} ${circumference - length}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[17px] font-semibold leading-none tabular-nums text-slate-900">
            {score}
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Profile completeness
        </p>
        <p className="mt-0.5 text-[13px] text-slate-900">{score} / 100</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {listed ? 'At or above the listing threshold' : 'Below the listing threshold'}
        </p>
      </div>
    </div>
  );
}

function Identity({
  provider,
  onAction,
}: {
  provider: ProviderDetail;
  onAction: (action: Action) => void;
}) {
  const suspended = provider.suspendedUntil !== null;
  const blocked = provider.user.status !== 'active';
  const needsApproval =
    provider.city?.requireEntryApproval === true && provider.entryApprovedAt === null;

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-slate-900">
              {provider.displayName ?? provider.userId}
            </h2>
            <BadgeLevel badge={provider.verification?.badge} />
            {blocked ? <Pill tone="danger">blocked</Pill> : null}
            {suspended ? <Pill tone="danger">suspended</Pill> : null}
            {needsApproval ? <Pill tone="warning">awaiting entry approval</Pill> : null}
          </div>
          <p className="mt-0.5 text-xs tabular-nums text-slate-500">
            {provider.user.phone} · {provider.city?.name ?? `city ${provider.cityId}`} · joined{' '}
            <Timestamp value={provider.createdAt} />
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {needsApproval ? (
            <AdminButton variant="primary" onClick={() => onAction('approve')}>
              <Check className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
              Approve entry
            </AdminButton>
          ) : null}
          {suspended ? (
            <AdminButton variant="secondary" onClick={() => onAction('reinstate')}>
              <Undo2 className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              Reinstate
            </AdminButton>
          ) : (
            <AdminButton variant="danger" onClick={() => onAction('suspend')}>
              <Ban className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              Suspend
            </AdminButton>
          )}
          {blocked ? (
            <AdminButton variant="secondary" onClick={() => onAction('unblock')}>
              <Undo2 className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              Unblock account
            </AdminButton>
          ) : (
            <AdminButton variant="danger" onClick={() => onAction('block')}>
              <X className="h-4 w-4" aria-hidden="true" strokeWidth={2.25} />
              Block account
            </AdminButton>
          )}
        </div>
      </div>

      <div className="grid gap-4 px-4 py-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <dl>
            <DetailRow label="Phone">
              <span className="tabular-nums">{provider.user.phone}</span>
            </DetailRow>
            <DetailRow label="Account status">
              <StatusBadge status={provider.user.status} />
            </DetailRow>
            <DetailRow label="Badge">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <BadgeLevel badge={provider.verification?.badge} />
                <span className="text-slate-500">
                  since <Timestamp value={provider.verification?.badgeSince} />
                </span>
              </span>
            </DetailRow>
            <DetailRow label="Levels passed">
              {provider.verification?.levelsPassed?.join(', ') || 'none yet'}
            </DetailRow>
            <DetailRow label="City">
              {provider.city?.name ?? provider.cityId}
              {provider.city?.requireEntryApproval ? ' — entry approval required' : ''}
            </DetailRow>
            <DetailRow label="Suspension">
              {suspended ? (
                <span className="text-slate-900">
                  until <Timestamp value={provider.suspendedUntil} /> —{' '}
                  {provider.suspensionReason ?? 'no reason recorded'}
                </span>
              ) : (
                <span className="text-slate-500">not suspended</span>
              )}
            </DetailRow>
            <DetailRow label="Joined">
              <Timestamp value={provider.createdAt} />
            </DetailRow>
            <DetailRow label="Skills">
              {(provider.skills ?? []).length === 0 ? (
                <span className="text-slate-500">none</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {(provider.skills ?? []).map((skill) => (
                    <Pill key={skill.categoryId} tone="neutral">
                      {skill.category?.nameKey ?? skill.categoryId}
                    </Pill>
                  ))}
                </span>
              )}
            </DetailRow>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <CompletenessRing score={provider.completenessScore} listed={provider.isListed} />
        </div>
      </div>
    </Card>
  );
}

/**
 * The five gates, answered one by one.
 *
 * "Not in search" is the question; which gate is failing is the answer. The
 * API returns them separately for exactly this reason, and collapsing them
 * back into one green tick here would throw that away.
 */
function Visibility({ provider }: { provider: ProviderDetail }) {
  const gates: [string, boolean, string][] = [
    [
      'Listed',
      provider.visibility.listed,
      'Profile completeness is at or above the listing threshold.',
    ],
    ['Account active', provider.visibility.accountActive, 'The account is not blocked.'],
    ['Verified', provider.visibility.verified, 'Holds VERIFIED, SILVER or GOLD.'],
    ['Not suspended', provider.visibility.notSuspended, 'No live suspension.'],
    [
      'Entry approved',
      provider.visibility.entryApproved,
      'Approved by ops, or this city does not require it.',
    ],
  ];

  const visible = gates.every(([, pass]) => pass);
  const failing = gates.filter(([, pass]) => !pass).length;

  return (
    <Card
      title="Search visibility"
      description={
        visible
          ? 'Every gate passes — this technician appears in customer search.'
          : `${failing} gate${failing === 1 ? '' : 's'} failing. Each one hides them on its own.`
      }
      action={
        visible ? (
          <Pill tone="success">
            <Eye className="mr-1 h-3 w-3" aria-hidden="true" strokeWidth={2.25} />
            in search
          </Pill>
        ) : (
          <Pill tone="danger">
            <EyeOff className="mr-1 h-3 w-3" aria-hidden="true" strokeWidth={2.25} />
            hidden
          </Pill>
        )
      }
      padded={false}
    >
      <ul className="divide-y divide-slate-100">
        {gates.map(([label, pass, why]) => (
          <li key={label} className="flex items-start gap-2.5 px-4 py-2.5">
            {pass ? (
              <CircleCheck
                className="mt-px h-4 w-4 shrink-0 text-success"
                aria-hidden="true"
                strokeWidth={2}
              />
            ) : (
              <CircleX
                className="mt-px h-4 w-4 shrink-0 text-danger"
                aria-hidden="true"
                strokeWidth={2}
              />
            )}
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-slate-900">
                {label}
                <span className="sr-only">{pass ? ' — passing' : ' — failing'}</span>
              </span>
              <span className="block text-xs leading-relaxed text-slate-500">{why}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TrustInputs({ provider }: { provider: ProviderDetail }) {
  const stats = provider.stats;

  const score = stats?.trustScore ?? null;
  // 0–100 in the API. Colour by band, so a reviewer reads the number and the
  // judgement about it in one glance.
  const scoreTone: Tone =
    score === null ? 'neutral' : score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger';

  return (
    <Card
      title="Trust score and what feeds it"
      action={
        <Pill tone={scoreTone}>
          <Gauge className="mr-1 h-3 w-3" aria-hidden="true" strokeWidth={2.25} />
          {score === null ? 'not scored' : score}
        </Pill>
      }
    >
      {!stats ? (
        <EmptyState
          icon={Star}
          title="No stats row yet."
          description="This technician has not been scored, which is different from scoring zero."
        />
      ) : (
        <dl>
          <DetailRow label="Trust score">
            <span className="inline-flex flex-wrap items-baseline gap-2">
              <span className="text-[15px] font-semibold tabular-nums text-slate-900">
                {stats.trustScore ?? 'not scored yet'}
              </span>
              {stats.trustScoreUpdated ? (
                <span className="text-xs text-slate-500">
                  updated <Timestamp value={stats.trustScoreUpdated} />
                </span>
              ) : null}
            </span>
          </DetailRow>
          <DetailRow label="Ratings">
            {stats.avgStars === null || stats.avgStars === undefined ? (
              <span className="text-slate-500">never rated</span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Star
                  className="h-3.5 w-3.5 shrink-0 text-warning"
                  aria-hidden="true"
                  strokeWidth={2}
                />
                <span className="tabular-nums">
                  {stats.avgStars} stars over {stats.reviewCount ?? 0} reviews
                </span>
              </span>
            )}
          </DetailRow>
          <DetailRow label="Acceptance">
            <span className="tabular-nums">
              {stats.acceptanceRate === null || stats.acceptanceRate === undefined
                ? 'not enough decided requests to mean anything'
                : `${Math.round(stats.acceptanceRate * 100)}% over ${stats.windowDays ?? 30} days`}
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-slate-500">
              {stats.acceptedCount ?? 0} accepted · {stats.rejectedCount ?? 0} rejected ·{' '}
              {stats.expiredCount ?? 0} expired
            </span>
          </DetailRow>
          <DetailRow label="Reliability">
            <span className="tabular-nums">
              {stats.cancelledByProviderCount ?? 0} cancellations by this technician
            </span>
          </DetailRow>
          <DetailRow label="Complaints upheld">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Pill tone={(stats.complaintsMinorCount ?? 0) > 0 ? 'warning' : 'neutral'}>
                {stats.complaintsMinorCount ?? 0} minor
              </Pill>
              <Pill tone={(stats.complaintsMajorCount ?? 0) > 0 ? 'danger' : 'neutral'}>
                {stats.complaintsMajorCount ?? 0} major
              </Pill>
              <Pill tone={(stats.complaintsSevereCount ?? 0) > 0 ? 'danger' : 'neutral'}>
                {stats.complaintsSevereCount ?? 0} severe
              </Pill>
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Dismissed complaints count for nothing.
            </span>
          </DetailRow>
          <DetailRow label="Settled jobs">
            <span className="tabular-nums">{stats.settledJobsCount}</span>
            {stats.lastSettledAt ? (
              <span className="ml-2 text-xs text-slate-500">
                last <Timestamp value={stats.lastSettledAt} />
              </span>
            ) : null}
          </DetailRow>
        </dl>
      )}
    </Card>
  );
}

function Wallet({ provider }: { provider: ProviderDetail }) {
  const { payablePaise, duesPaise, netPaise } = provider.balance;

  return (
    <Card title="Wallet and dues">
      <Grid cols={3}>
        <StatTile
          label="We owe them"
          value={formatPaise(payablePaise)}
          hint="Payable, before the next batch"
          icon={WalletIcon}
          tone={payablePaise > 0 ? 'admin' : 'neutral'}
        />
        <StatTile
          label="They owe us"
          value={formatPaise(duesPaise)}
          hint="Commission on cash jobs"
          icon={ShieldCheck}
          tone={duesPaise > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Net"
          value={formatPaise(netPaise)}
          hint="Payable less dues"
          icon={Gauge}
          tone={netPaise < 0 ? 'danger' : 'neutral'}
        />
      </Grid>

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Payable and dues are shown separately rather than netted — that is what a technician can
        check against their own week. Both are sums of ledger entries; no balance is stored.{' '}
        <Link to="/admin/money" className="font-semibold text-admin hover:underline">
          Open the money screen
        </Link>
        .
      </p>
    </Card>
  );
}

function RecentBookings({ provider }: { provider: ProviderDetail }) {
  const rows: RecentBooking[] = provider.recentBookings;

  return (
    <Card
      title="Recent bookings"
      action={<Pill tone="neutral">{rows.length}</Pill>}
      padded={rows.length === 0}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Never had a booking."
          description="This technician has not been booked once — worth knowing before reading anything into their trust score."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  {['Booking', 'Status', 'Category', 'Starts', 'Payable', 'Created'].map(
                    (header) => (
                      <th
                        key={header}
                        scope="col"
                        className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
                          header === 'Payable' ? 'text-right' : ''
                        }`}
                      >
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <Link
                        to={`/admin/bookings/${row.id}`}
                        className="font-semibold tabular-nums text-admin hover:underline"
                      >
                        {row.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{row.category?.nameKey ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      <Timestamp value={row.startsAt} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                      {row.payablePaise === null ? '—' : formatPaise(row.payablePaise)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      <Timestamp value={row.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-slate-100 sm:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Link to={`/admin/bookings/${row.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold tabular-nums text-slate-900">
                      {row.id.slice(0, 8)}…
                    </span>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    <span>{row.category?.nameKey ?? '—'}</span>
                    <span className="tabular-nums">
                      {row.payablePaise === null ? '—' : formatPaise(row.payablePaise)}
                    </span>
                    <Timestamp value={row.startsAt} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
