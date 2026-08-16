import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  approveProviderEntry,
  blockUser,
  fetchProvider,
  reinstateProvider,
  suspendProvider,
  unblockUser,
} from '../api/endpoints';
import type { ProviderDetail } from '../api/types';
import { ConfirmDialog, reasonField } from '../components/ConfirmDialog';
import { PageHeader } from '../components/Layout';
import { Timestamp } from '../components/Timestamp';
import { Badge, BadgeLevel, StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, DetailRow, StatTile } from '../components/ui/Card';
import { QueryState } from '../components/ui/States';
import { Table, Td, Th, Tr } from '../components/ui/Table';
import { formatPaise } from '../lib/money';
import { useAdminMutation } from '../lib/mutations';

type Action = 'suspend' | 'reinstate' | 'block' | 'unblock' | 'approve';

/**
 * The page most ops phone calls get answered on.
 *
 * A technician rings up asking why they are not getting work. There are five
 * independent reasons that could be true at once, so this page answers all five
 * separately and never makes ops deduce which gate is failing.
 */
export function ProviderDetailPage() {
  const { providerId = '' } = useParams();
  const [action, setAction] = useState<Action | null>(null);

  const query = useQuery({
    queryKey: ['providers', 'detail', providerId],
    queryFn: () => fetchProvider(providerId),
  });

  const invalidate = [['providers'], ['summary']];
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
    <>
      <PageHeader
        title="Technician"
        actions={
          <Link className="text-sm text-blue-700 hover:underline" to="/providers">
            ← Back to the list
          </Link>
        }
      />

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
    </>
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
    <Card
      title={provider.displayName ?? provider.userId}
      actions={
        <>
          {needsApproval ? (
            <Button variant="primary" onClick={() => onAction('approve')}>
              Approve entry
            </Button>
          ) : null}
          {suspended ? (
            <Button variant="secondary" onClick={() => onAction('reinstate')}>
              Reinstate
            </Button>
          ) : (
            <Button variant="danger" onClick={() => onAction('suspend')}>
              Suspend
            </Button>
          )}
          {blocked ? (
            <Button variant="secondary" onClick={() => onAction('unblock')}>
              Unblock account
            </Button>
          ) : (
            <Button variant="danger" onClick={() => onAction('block')}>
              Block account
            </Button>
          )}
        </>
      }
    >
      <dl>
        <DetailRow label="Phone">{provider.user.phone}</DetailRow>
        <DetailRow label="Account status">
          <StatusBadge status={provider.user.status} />
        </DetailRow>
        <DetailRow label="Badge">
          <BadgeLevel badge={provider.verification?.badge} /> since{' '}
          <Timestamp value={provider.verification?.badgeSince} />
        </DetailRow>
        <DetailRow label="Levels passed">
          {provider.verification?.levelsPassed?.join(', ') || 'none yet'}
        </DetailRow>
        <DetailRow label="City">
          {provider.city?.name ?? provider.cityId}
          {provider.city?.requireEntryApproval ? ' — entry approval required' : ''}
        </DetailRow>
        <DetailRow label="Profile completeness">
          {provider.completenessScore} / 100
          {provider.isListed ? null : ' — below the listing threshold'}
        </DetailRow>
        <DetailRow label="Suspension">
          {suspended ? (
            <>
              until <Timestamp value={provider.suspendedUntil} /> —{' '}
              {provider.suspensionReason ?? 'no reason recorded'}
            </>
          ) : (
            'not suspended'
          )}
        </DetailRow>
        <DetailRow label="Joined">
          <Timestamp value={provider.createdAt} />
        </DetailRow>
        <DetailRow label="Skills">
          {(provider.skills ?? []).length === 0
            ? 'none'
            : (provider.skills ?? [])
                .map((skill) => skill.category?.nameKey ?? skill.categoryId)
                .join(', ')}
        </DetailRow>
      </dl>
    </Card>
  );
}

/**
 * The five gates, answered one by one.
 *
 * "Not in search" is the question; which gate is failing is the answer. The API
 * returns them separately for exactly this reason, and collapsing them back into
 * one green tick here would throw that away.
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

  return (
    <Card
      title="Search visibility"
      actions={
        visible ? <Badge tone="good">appears in search</Badge> : <Badge tone="bad">hidden</Badge>
      }
    >
      <ul className="space-y-1.5">
        {gates.map(([label, pass, why]) => (
          <li key={label} className="flex items-start gap-2 text-sm">
            <span className={pass ? 'text-green-700' : 'text-red-700'}>{pass ? '✓' : '✕'}</span>
            <span className="min-w-0">
              <span className="font-medium text-slate-800">{label}</span>
              <span className="ml-2 text-xs text-slate-500">{why}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TrustInputs({ provider }: { provider: ProviderDetail }) {
  const stats = provider.stats;

  return (
    <Card title="Trust score and what feeds it">
      {!stats ? (
        <p className="text-sm text-slate-500">
          No stats row yet — this technician has not been scored, which is different from scoring
          zero.
        </p>
      ) : (
        <dl>
          <DetailRow label="Trust score">
            {stats.trustScore ?? 'not scored yet'}
            {stats.trustScoreUpdated ? (
              <span className="ml-2 text-xs text-slate-500">
                updated <Timestamp value={stats.trustScoreUpdated} />
              </span>
            ) : null}
          </DetailRow>
          <DetailRow label="Ratings">
            {stats.avgStars === null || stats.avgStars === undefined
              ? 'never rated'
              : `${stats.avgStars} stars over ${stats.reviewCount ?? 0} reviews`}
          </DetailRow>
          <DetailRow label="Acceptance">
            {stats.acceptanceRate === null || stats.acceptanceRate === undefined
              ? 'not enough decided requests to mean anything'
              : `${Math.round(stats.acceptanceRate * 100)}% over ${stats.windowDays ?? 30} days`}
            <span className="ml-2 text-xs text-slate-500">
              {stats.acceptedCount ?? 0} accepted · {stats.rejectedCount ?? 0} rejected ·{' '}
              {stats.expiredCount ?? 0} expired
            </span>
          </DetailRow>
          <DetailRow label="Reliability">
            {stats.cancelledByProviderCount ?? 0} cancellations by this technician
          </DetailRow>
          <DetailRow label="Complaints upheld">
            {stats.complaintsMinorCount ?? 0} minor · {stats.complaintsMajorCount ?? 0} major ·{' '}
            {stats.complaintsSevereCount ?? 0} severe
            <span className="ml-2 text-xs text-slate-500">
              Dismissed complaints count for nothing.
            </span>
          </DetailRow>
          <DetailRow label="Settled jobs">
            {stats.settledJobsCount}
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
  return (
    <Card title="Wallet">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="We owe them" value={formatPaise(provider.balance.payablePaise)} />
        <StatTile
          label="They owe us"
          value={formatPaise(provider.balance.duesPaise)}
          tone={provider.balance.duesPaise > 0 ? 'warn' : 'neutral'}
          hint="Commission on cash jobs"
        />
        <StatTile label="Net" value={formatPaise(provider.balance.netPaise)} to="/money" />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Payable and dues are shown separately rather than netted — that is what a technician can
        check against their own week. Both are sums of ledger entries; no balance is stored.
      </p>
    </Card>
  );
}

function RecentBookings({ provider }: { provider: ProviderDetail }) {
  return (
    <Card title="Recent bookings">
      {provider.recentBookings.length === 0 ? (
        <p className="text-sm text-slate-500">This technician has never had a booking.</p>
      ) : (
        <Table
          head={
            <tr>
              <Th>Booking</Th>
              <Th>Status</Th>
              <Th>Category</Th>
              <Th>Starts</Th>
              <Th>Payable</Th>
              <Th>Created</Th>
            </tr>
          }
        >
          {provider.recentBookings.map((booking) => (
            <Tr key={booking.id}>
              <Td>
                <Link className="text-blue-700 hover:underline" to={`/bookings/${booking.id}`}>
                  {booking.id.slice(0, 8)}…
                </Link>
              </Td>
              <Td>
                <StatusBadge status={booking.status} />
              </Td>
              <Td>{booking.category?.nameKey ?? '—'}</Td>
              <Td>
                <Timestamp value={booking.startsAt} />
              </Td>
              <Td className="tabular-nums">
                {booking.payablePaise === null ? '—' : formatPaise(booking.payablePaise)}
              </Td>
              <Td>
                <Timestamp value={booking.createdAt} />
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
