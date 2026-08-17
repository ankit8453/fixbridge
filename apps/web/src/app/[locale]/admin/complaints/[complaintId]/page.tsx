'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  dismissComplaint,
  fetchBookingTimeline,
  fetchComplaint,
  resolveComplaint,
  takeUpComplaint,
} from '@/components/admin/lib/api';
import { useAdminMutation } from '@/components/admin/lib/mutations';
import { AdminLink } from '@/components/admin/AdminLink';
import { BookingTimeline } from '@/components/admin/BookingTimeline';
import { ConfirmDialog, noteField } from '@/components/admin/ConfirmDialog';
import { PageHeader } from '@/components/admin/Shell';
import { Timestamp } from '@/components/admin/Timestamp';
import { StatusBadge } from '@/components/admin/ui/Badge';
import { Button, Card, DetailRow, QueryState } from '@/components/ui';

/**
 * A complaint, with the booking it is about underneath it. Ported from
 * apps/admin/src/pages/ComplaintDetailPage.tsx.
 *
 * Embedded rather than linked: a complaint on its own is one person's
 * account of an evening, and deciding it from that alone is how ops end up
 * believing whoever wrote more words. The timeline is the other half of the
 * story and it should not be a click away.
 */
export default function ComplaintDetailPage() {
  const params = useParams<{ complaintId: string }>();
  const complaintId = params.complaintId ?? '';
  const [action, setAction] = useState<'resolve' | 'dismiss' | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'complaints', 'detail', complaintId],
    queryFn: () => fetchComplaint(complaintId),
  });

  const bookingId = query.data?.complaint.bookingId;

  const timeline = useQuery({
    queryKey: ['admin', 'bookings', 'timeline', bookingId],
    queryFn: () => fetchBookingTimeline(bookingId ?? ''),
    enabled: Boolean(bookingId),
  });

  const invalidate = [
    ['admin', 'complaints'],
    ['admin', 'summary'],
    ['admin', 'providers'],
  ];
  const close = () => setAction(null);

  const takeUp = useAdminMutation(() => takeUpComplaint(complaintId), { invalidate });

  const resolve = useAdminMutation(
    (values: { note: string; severity: 'minor' | 'major' | 'severe' }) =>
      resolveComplaint(complaintId, values),
    { invalidate, onDone: close },
  );

  const dismiss = useAdminMutation(
    (values: { note: string }) => dismissComplaint(complaintId, values.note),
    { invalidate, onDone: close },
  );

  return (
    <>
      <PageHeader
        title="Complaint"
        actions={
          <AdminLink className="text-sm text-blue-700 hover:underline" href="/complaints">
            ← Back to the queue
          </AdminLink>
        }
      />

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel="Loading the complaint…"
        onRetry={() => void query.refetch()}
      >
        {({ complaint }) => {
          const decided = complaint.status === 'resolved' || complaint.status === 'dismissed';

          return (
            <div className="space-y-4">
              <Card
                title={`${complaint.category} — ${complaint.status}`}
                actions={
                  decided ? (
                    <span className="text-xs text-slate-500">Already decided.</span>
                  ) : (
                    <>
                      {complaint.status === 'open' ? (
                        <Button
                          variant="secondary"
                          disabled={takeUp.isPending}
                          onClick={() => takeUp.mutate(undefined)}
                        >
                          {takeUp.isPending ? 'Taking up…' : 'Take it up'}
                        </Button>
                      ) : null}
                      <Button variant="danger" onClick={() => setAction('resolve')}>
                        Uphold
                      </Button>
                      <Button variant="secondary" onClick={() => setAction('dismiss')}>
                        Dismiss
                      </Button>
                    </>
                  )
                }
              >
                <dl>
                  <DetailRow label="Status">
                    <StatusBadge status={complaint.status} />
                  </DetailRow>
                  <DetailRow label="Raised">
                    <Timestamp value={complaint.createdAt} />
                  </DetailRow>
                  <DetailRow label="Description">{complaint.description}</DetailRow>
                  <DetailRow label="Severity">{complaint.severity ?? 'not decided'}</DetailRow>
                  <DetailRow label="Resolution note">{complaint.resolutionNote ?? '—'}</DetailRow>
                  <DetailRow label="Booking">
                    <AdminLink
                      className="text-blue-700 hover:underline"
                      href={`/bookings/${complaint.bookingId}`}
                    >
                      {complaint.bookingId}
                    </AdminLink>
                  </DetailRow>
                </dl>
              </Card>

              <Card title="The booking this is about">
                <QueryState
                  status={timeline.status}
                  error={timeline.error}
                  data={timeline.data}
                  loadingLabel="Loading the booking's history…"
                  onRetry={() => void timeline.refetch()}
                >
                  {(data) => <BookingTimeline data={data} />}
                </QueryState>
              </Card>

              {action === 'resolve' ? (
                <ConfirmDialog
                  title="Uphold this complaint"
                  description="Severity is what the trust engine acts on, and severe suspends this technician. Both fields are mandatory."
                  confirmLabel="Uphold complaint"
                  tone="danger"
                  pending={resolve.isPending}
                  error={resolve.error}
                  fields={[
                    {
                      name: 'severity',
                      label: 'Severity',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'minor', label: 'Minor' },
                        { value: 'major', label: 'Major' },
                        { value: 'severe', label: 'Severe — suspends the technician' },
                      ],
                    },
                    noteField('Note', 'What you concluded, and from what.'),
                  ]}
                  onClose={close}
                  onConfirm={(values) =>
                    resolve.mutate({
                      note: values.note ?? '',
                      severity: (values.severity ?? 'minor') as 'minor' | 'major' | 'severe',
                    })
                  }
                />
              ) : null}

              {action === 'dismiss' ? (
                <ConfirmDialog
                  title="Dismiss this complaint"
                  description="Counts against nobody — deliberately no severity. Being accused is not a record."
                  confirmLabel="Dismiss complaint"
                  pending={dismiss.isPending}
                  error={dismiss.error}
                  fields={[noteField('Note', 'Why it did not stand up.')]}
                  onClose={close}
                  onConfirm={(values) => dismiss.mutate({ note: values.note ?? '' })}
                />
              ) : null}
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
