import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { fetchBookingTimeline, opsCancelBooking, unlockBookingOtp } from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import type { BookingTimelineResponse } from '../lib/types';
import { BookingTimeline } from '../components/BookingTimeline';
import { ConfirmDialog, noteField, reasonField } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import { Badge, Button, Card, DetailRow, QueryState } from '@/components/ui';
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

  return (
    <>
      <PageHeader
        title="Booking"
        subtitle="Events, quotations, money and what each side was told — in one order."
        actions={
          <Link className="text-sm text-brand hover:underline" to="/admin/bookings">
            ← Back to search
          </Link>
        }
      />

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading the booking's full history…"
        onRetry={() => void query.refetch()}
      >
        {(data) => (
          <div className="space-y-4">
            <Facts data={data} onAction={setAction} />

            {codes ? (
              <Card title="Handshake codes">
                <p className="text-sm text-slate-700">
                  Start <code className="font-semibold">{codes.start ?? 'none issued'}</code> · End{' '}
                  <code className="font-semibold">{codes.end ?? 'none issued'}</code>
                </p>
                <p className="mt-1 text-xs text-muted">
                  These are the existing codes, read back — not new ones. The customer's slip is
                  still valid; it was the attempt counter that locked, not the code.
                </p>
              </Card>
            ) : null}

            <Card title="Timeline">
              <BookingTimeline data={data} />
            </Card>

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
        )}
      </QueryState>
    </>
  );
}

function Facts({
  data,
  onAction,
}: {
  data: BookingTimelineResponse;
  onAction: (action: 'unlock' | 'cancel') => void;
}) {
  const { booking } = data;

  return (
    <Card
      title={`Booking ${booking.id}`}
      actions={
        <>
          {/* Shown only when it is true. An unlock button on a booking that is
              not locked is an invitation to file an audit row for nothing. */}
          {data.otpLocked ? (
            <Button variant="danger" onClick={() => onAction('unlock')}>
              Unlock handshake
            </Button>
          ) : null}
          <Button variant="danger" onClick={() => onAction('cancel')}>
            Cancel booking
          </Button>
        </>
      }
    >
      <dl>
        <DetailRow label="Status">
          <StatusBadge status={booking.status} />
          {data.otpLocked ? (
            <span className="ml-2">
              <Badge tone="danger">handshake locked</Badge>
            </span>
          ) : null}
        </DetailRow>
        <DetailRow label="Customer">
          {booking.customer?.name ?? '—'} · {booking.customer?.phone ?? '—'}
        </DetailRow>
        <DetailRow label="Technician">
          {booking.provider ? (
            <Link
              className="text-brand hover:underline"
              to={`/admin/providers/${booking.provider.userId}`}
            >
              {booking.provider.displayName ?? booking.provider.userId}
            </Link>
          ) : (
            '—'
          )}
          {booking.provider?.user?.phone ? ` · ${booking.provider.user.phone}` : ''}
        </DetailRow>
        <DetailRow label="Category">{booking.category?.nameKey ?? '—'}</DetailRow>
        <DetailRow label="Window">
          <Timestamp value={booking.startsAt} /> → <Timestamp value={booking.endsAt} />
        </DetailRow>
        <DetailRow label="Problem">{booking.problemNote ?? '—'}</DetailRow>
        <DetailRow label="Visit fee">
          {booking.visitFeePaise === null ? '—' : formatPaise(booking.visitFeePaise)}
        </DetailRow>
        <DetailRow label="Payable">
          {booking.payablePaise === null ? 'not frozen yet' : formatPaise(booking.payablePaise)}
        </DetailRow>
        <DetailRow label="Created">
          <Timestamp value={booking.createdAt} />
        </DetailRow>
      </dl>
    </Card>
  );
}
