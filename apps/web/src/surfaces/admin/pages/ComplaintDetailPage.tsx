import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, ShieldAlert, UserRound, Wrench } from 'lucide-react';
import {
  dismissComplaint,
  fetchBookingTimeline,
  fetchComplaint,
  resolveComplaint,
  takeUpComplaint,
} from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import { BookingTimeline } from '../components/BookingTimeline';
import { ConfirmDialog, noteField } from '../components/ConfirmDialog';
import { Timestamp } from '../components/Timestamp';
import { StatusBadge } from '../components/StatusBadge';
import { AdminButton, Card, DetailRow, Pill, SectionHeader, SkeletonRows } from '../components/ui';
import { ErrorState, Spinner } from '@/components/ui';

/**
 * A complaint, with the booking it is about underneath it. Ported from
 * `legacy-next-src/app/[locale]/admin/complaints/[complaintId]/page.tsx`.
 *
 * Embedded rather than linked: a complaint on its own is one person's
 * account of an evening, and deciding it from that alone is how ops end up
 * believing whoever wrote more words. The timeline is the other half of the
 * story and it should not be a click away.
 *
 * The two parties are given identical cards, side by side, for the same
 * reason. A layout that makes the accusation the headline and the accused a
 * footnote has decided the case before the reader has read it.
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

  if (query.status === 'pending') {
    return (
      <div className="space-y-4">
        <Card>
          <Spinner label="Loading the complaint…" />
        </Card>
        <Card padded={false}>
          <SkeletonRows rows={5} />
        </Card>
      </div>
    );
  }

  if (query.status === 'error' || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { complaint } = query.data;
  const decided = complaint.status === 'resolved' || complaint.status === 'dismissed';

  return (
    <div className="space-y-5">
      <SectionHeader
        title={`${complaint.category} — ${complaint.status}`}
        description="One side's account of an evening, and the booking record that either supports it or does not."
        action={
          <Link
            className="inline-flex min-h-touch items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            to="/admin/complaints"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
            Back to the queue
          </Link>
        }
      />

      {/* The decision bar, at the top rather than buried under the evidence.
          A reviewer scrolls the timeline and then needs the controls; making
          them scroll back up to a card header was the old shape of this. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              complaint.category === 'safety'
                ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger'
                : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-admin-soft text-admin'
            }
          >
            <ShieldAlert className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Decision
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={complaint.status} />
              {complaint.severity ? (
                <Pill tone={complaint.severity === 'severe' ? 'danger' : 'warning'}>
                  {complaint.severity}
                </Pill>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {decided ? (
            <span className="text-xs font-medium text-slate-500">Already decided.</span>
          ) : (
            <>
              {complaint.status === 'open' ? (
                <AdminButton
                  variant="secondary"
                  disabled={takeUp.isPending}
                  onClick={() => takeUp.mutate(undefined)}
                >
                  {takeUp.isPending ? 'Taking up…' : 'Take it up'}
                </AdminButton>
              ) : null}
              <AdminButton variant="secondary" onClick={() => setAction('dismiss')}>
                Dismiss
              </AdminButton>
              <AdminButton variant="danger" onClick={() => setAction('resolve')}>
                Uphold
              </AdminButton>
            </>
          )}
        </div>
      </div>

      {takeUp.error ? <ErrorState error={takeUp.error} /> : null}

      {/* Both parties, in identical cards. Neither gets the wider column. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <UserRound className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Raised by
              </p>
              <p className="mt-0.5 break-all font-mono text-xs text-slate-700">
                {complaint.raisedByUserId}
              </p>
              <p className="mt-2.5 text-[13px] leading-relaxed text-slate-800">
                {complaint.description}
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Wrench className="h-[17px] w-[17px]" aria-hidden="true" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Complained about
              </p>
              <Link
                className="mt-0.5 block break-all font-mono text-xs text-admin hover:underline"
                to={`/admin/providers/${complaint.againstUserId}`}
              >
                {complaint.againstUserId}
              </Link>
              <p className="mt-2.5 text-[13px] leading-relaxed text-slate-500">
                {/* There is no written defence to show: the API stores no
                    response from the accused. The timeline below is the only
                    account of their side, which is exactly why it is
                    embedded rather than linked. */}
                No written response is on file. Their side of the evening is the booking record
                below.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Complaint">
        <dl>
          <DetailRow label="Complaint id">
            <span className="font-mono text-xs">{complaint.id}</span>
          </DetailRow>
          <DetailRow label="Status">
            <StatusBadge status={complaint.status} />
          </DetailRow>
          <DetailRow label="Category">{complaint.category}</DetailRow>
          <DetailRow label="Raised">
            <Timestamp value={complaint.createdAt} />
          </DetailRow>
          <DetailRow label="Description">{complaint.description}</DetailRow>
          <DetailRow label="Severity">{complaint.severity ?? 'not decided'}</DetailRow>
          <DetailRow label="Resolution note">{complaint.resolutionNote ?? '—'}</DetailRow>
          <DetailRow label="Booking">
            <Link
              className="font-mono text-xs text-admin hover:underline"
              to={`/admin/bookings/${complaint.bookingId}`}
            >
              {complaint.bookingId}
            </Link>
          </DetailRow>
        </dl>
      </Card>

      <Card
        title="The booking this is about"
        description="The record neither party wrote — what the system saw happen, and when."
      >
        {timeline.status === 'pending' ? (
          <Spinner label="Loading the booking's history…" />
        ) : timeline.status === 'error' || timeline.data === undefined ? (
          <ErrorState error={timeline.error} onRetry={() => void timeline.refetch()} />
        ) : (
          <BookingTimeline data={timeline.data} />
        )}
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
}
