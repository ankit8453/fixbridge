import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  dismissComplaint,
  fetchBookingTimeline,
  fetchComplaint,
  resolveComplaint,
  takeUpComplaint,
} from '../api/endpoints';
import { BookingTimeline } from '../components/BookingTimeline';
import { ConfirmDialog, noteField } from '../components/ConfirmDialog';
import { PageHeader } from '../components/Layout';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, DetailRow } from '../components/ui/Card';
import { QueryState } from '../components/ui/States';
import { useAdminMutation } from '../lib/mutations';

/**
 * A complaint, with the booking it is about underneath it.
 *
 * Embedded rather than linked: a complaint on its own is one person's account of
 * an evening, and deciding it from that alone is how ops end up believing
 * whoever wrote more words. The timeline is the other half of the story and it
 * should not be a click away.
 */
export function ComplaintDetailPage() {
  const { complaintId = '' } = useParams();
  const [action, setAction] = useState<'resolve' | 'dismiss' | null>(null);

  const query = useQuery({
    queryKey: ['complaints', 'detail', complaintId],
    queryFn: () => fetchComplaint(complaintId),
  });

  const bookingId = query.data?.complaint.bookingId;

  const timeline = useQuery({
    queryKey: ['bookings', 'timeline', bookingId],
    queryFn: () => fetchBookingTimeline(bookingId ?? ''),
    enabled: Boolean(bookingId),
  });

  const invalidate = [['complaints'], ['summary'], ['providers']];
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
          <Link className="text-sm text-blue-700 hover:underline" to="/complaints">
            ← Back to the queue
          </Link>
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
                    <Link
                      className="text-blue-700 hover:underline"
                      to={`/bookings/${complaint.bookingId}`}
                    >
                      {complaint.bookingId}
                    </Link>
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
