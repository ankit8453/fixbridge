import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, Ban, History, KeyRound, Receipt } from 'lucide-react';
import { fetchBookingTimeline, opsCancelBooking, unlockBookingOtp } from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import { BookingTimeline } from '../components/BookingTimeline';
import { ConfirmDialog, noteField, reasonField } from '../components/ConfirmDialog';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import {
  AdminButton,
  Card,
  DetailRow,
  Pill,
  SectionHeader,
  SkeletonRows,
  StatTile,
} from '../components/ui';
import { ErrorState, Spinner } from '@/components/ui';
import { formatPaise } from '@/lib/money';

/** Ported from `legacy-next-src/app/[locale]/admin/bookings/[bookingId]/page.tsx`. */
export default function BookingDetailPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = params.bookingId ?? '';
  const [action, setAction] = useState<'unlock' | 'cancel' | null>(null);
  const [codes, setCodes] = useState<{ start: string | null; end: string | null } | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'bookings', 'timeline', bookingId],
    queryFn: () => fetchBookingTimeline(bookingId),
  });

  const invalidate = [
    ['admin', 'bookings'],
    ['admin', 'summary'],
  ];

  const unlock = useAdminMutation(
    (values: { note: string; kind: 'start' | 'end' | 'both' }) =>
      unlockBookingOtp(bookingId, values),
    {
      invalidate,
      onDone: (result) => {
        setAction(null);
        setCodes(result.codes ?? null);
      },
    },
  );

  const cancel = useAdminMutation(
    (values: { reason: string }) => opsCancelBooking(bookingId, values.reason),
    { invalidate, onDone: () => setAction(null) },
  );

  if (query.status === 'pending') {
    return (
      <div className="space-y-4">
        <Card>
          <Spinner label="Loading the booking's full history…" />
        </Card>
        <Card padded={false}>
          <SkeletonRows rows={6} />
        </Card>
      </div>
    );
  }

  if (query.status === 'error' || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const data = query.data;
  const { booking } = data;

  return (
    <div className="space-y-5">
      <SectionHeader
        title={`Booking ${booking.id.slice(0, 8)}…`}
        description="Events, quotations, money and what each side was told — in one order."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              to="/admin/bookings"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              Back to search
            </Link>
            {/* Shown only when it is true. An unlock button on a booking that is
                not locked is an invitation to file an audit row for nothing. */}
            {data.otpLocked ? (
              <AdminButton variant="danger" onClick={() => setAction('unlock')}>
                <KeyRound className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
                Unlock handshake
              </AdminButton>
            ) : null}
            <AdminButton variant="danger" onClick={() => setAction('cancel')}>
              <Ban className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              Cancel booking
            </AdminButton>
          </div>
        }
      />

      {/* The money on this job, above the fold. The timeline explains how it
          got there; these two figures are what a caller is usually ringing
          about. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          label="Visit fee"
          value={booking.visitFeePaise === null ? '—' : formatPaise(booking.visitFeePaise)}
          hint="Charged for the callout, whatever the job turns out to be."
          icon={Receipt}
          tone="info"
        />
        <StatTile
          label="Payable"
          value={
            booking.payablePaise === null ? 'not frozen yet' : formatPaise(booking.payablePaise)
          }
          hint="The snapshot the customer is charged against."
          icon={Receipt}
          tone="admin"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Facts">
            <dl>
              <DetailRow label="Booking id">
                <span className="font-mono text-xs">{booking.id}</span>
              </DetailRow>
              <DetailRow label="Status">
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={booking.status} />
                  {data.otpLocked ? <Pill tone="danger">handshake locked</Pill> : null}
                </span>
              </DetailRow>
              <DetailRow label="Customer">
                {booking.customer?.name ?? '—'} ·{' '}
                <span className="tabular-nums">{booking.customer?.phone ?? '—'}</span>
              </DetailRow>
              <DetailRow label="Technician">
                {booking.provider ? (
                  <Link
                    className="font-medium text-admin hover:underline"
                    to={`/admin/providers/${booking.provider.userId}`}
                  >
                    {booking.provider.displayName ?? booking.provider.userId}
                  </Link>
                ) : (
                  '—'
                )}
                {booking.provider?.user?.phone ? (
                  <span className="tabular-nums"> · {booking.provider.user.phone}</span>
                ) : null}
              </DetailRow>
              <DetailRow label="Category">{booking.category?.nameKey ?? '—'}</DetailRow>
              <DetailRow label="Window">
                <Timestamp value={booking.startsAt} />
                <span className="mx-1 text-slate-400">→</span>
                <Timestamp value={booking.endsAt} />
              </DetailRow>
              <DetailRow label="Problem">{booking.problemNote ?? '—'}</DetailRow>
              <DetailRow label="Visit fee">
                <span className="tabular-nums">
                  {booking.visitFeePaise === null ? '—' : formatPaise(booking.visitFeePaise)}
                </span>
              </DetailRow>
              <DetailRow label="Payable">
                <span className="font-semibold tabular-nums">
                  {booking.payablePaise === null
                    ? 'not frozen yet'
                    : formatPaise(booking.payablePaise)}
                </span>
              </DetailRow>
              <DetailRow label="Created">
                <Timestamp value={booking.createdAt} />
              </DetailRow>
            </dl>
          </Card>

          {codes ? (
            <Card title="Handshake codes">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-700">
                <span className="text-slate-500">Start</span>
                <code className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {codes.start ?? 'none issued'}
                </code>
                <span className="text-slate-500">End</span>
                <code className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {codes.end ?? 'none issued'}
                </code>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                These are the existing codes, read back — not new ones. The customer&apos;s slip is
                still valid; it was the attempt counter that locked, not the code.
              </p>
            </Card>
          ) : null}
        </div>

        <Card
          title="Timeline"
          description="Every record type this booking touched, in one order."
          action={
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <History className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.75} />
              oldest first
            </span>
          }
        >
          <BookingTimeline data={data} />
        </Card>
      </div>

      {action === 'unlock' ? (
        <ConfirmDialog
          title="Unlock the handshake"
          description="This booking locked after five wrong codes at somebody's door. Unlocking it is you asserting that you have checked who you are talking to — the note is the only evidence of that."
          confirmLabel="Unlock"
          tone="danger"
          pending={unlock.isPending}
          error={unlock.error}
          fields={[
            noteField('Note', 'How you confirmed the identity of the person on the phone.'),
            {
              name: 'kind',
              label: 'Which code',
              type: 'select',
              defaultValue: 'both',
              options: [
                { value: 'both', label: 'Both start and end' },
                { value: 'start', label: 'Start only' },
                { value: 'end', label: 'End only' },
              ],
            },
          ]}
          onClose={() => setAction(null)}
          onConfirm={(values) =>
            unlock.mutate({
              note: values.note ?? '',
              kind: (values.kind ?? 'both') as 'start' | 'end' | 'both',
            })
          }
        />
      ) : null}

      {action === 'cancel' ? (
        <ConfirmDialog
          title="Cancel this booking"
          description="An ops cancellation. It is attributed to ops, not to either party, so it does not count against the technician's reliability."
          confirmLabel="Cancel booking"
          tone="danger"
          pending={cancel.isPending}
          error={cancel.error}
          fields={[reasonField('Reason')]}
          onClose={() => setAction(null)}
          onConfirm={(values) => cancel.mutate({ reason: values.reason ?? '' })}
        />
      ) : null}
    </div>
  );
}
