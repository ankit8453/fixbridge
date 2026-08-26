import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { decidePhotoReport, fetchReportedPhotos } from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import type { ReportedPhoto } from '../lib/types';
import { ConfirmDialog, reasonField } from '../components/ConfirmDialog';
import { Timestamp } from '../components/Timestamp';
import { AdminButton, Card, EmptyState, Pill, SectionHeader, SkeletonRows } from '../components/ui';
import { ErrorState } from '@/components/ui';

/**
 * Reported profile photos.
 *
 * There is no approval queue: a technician's photo publishes the moment they
 * confirm the upload, because their own face is their property and holding it
 * for review taxes the honest majority to catch a rare abuser. Moderation runs
 * the other way round — customers report, and this screen is where a human
 * decides.
 *
 * A report never takes a photo down by itself, at any count. An automatic
 * threshold would be a griefing tool: a competitor with three phone numbers
 * could blank any technician's profile. So every photo here is still live, and
 * stays live until somebody on this screen says otherwise.
 */
export default function PhotoReportsPage() {
  const [target, setTarget] = useState<{
    photo: ReportedPhoto;
    decision: 'remove' | 'keep';
  } | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'provider-photos', 'reported'],
    queryFn: fetchReportedPhotos,
  });

  const decide = useAdminMutation(
    (input: { photoId: string; decision: 'remove' | 'keep'; note?: string }) =>
      decidePhotoReport(input.photoId, { decision: input.decision, note: input.note }),
    {
      invalidate: [['admin', 'provider-photos']],
      onDone: () => setTarget(null),
    },
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Reported photos"
        description="Profile photos go live as soon as a technician uploads one. These are the ones customers have reported — each is still visible until you decide."
      />

      <Card padded={false}>
        {query.status === 'pending' ? (
          <SkeletonRows rows={3} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.photos.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing reported"
            description="No customer has reported a profile photo. Photos publish on upload, so an empty list is the normal state."
          />
        ) : (
          <ul className="divide-y divide-slate-200">
            {query.data.photos.map((photo) => (
              <li key={photo.photoId} className="flex flex-col gap-4 p-4 sm:flex-row">
                {/*
                  The photo itself, at a size somebody can actually judge. This
                  decision cannot be made from a filename — the whole question
                  is what the picture shows.
                */}
                <img
                  src={photo.url}
                  alt={`Profile photo reported for ${photo.providerName ?? 'this technician'}`}
                  className="h-32 w-32 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/admin/providers/${photo.providerId}`}
                      className="font-semibold text-slate-900 hover:text-admin hover:underline"
                    >
                      {photo.providerName ?? 'Unnamed technician'}
                    </Link>
                    <Pill tone={photo.reportCount > 2 ? 'danger' : 'warning'}>
                      {photo.reportCount} {photo.reportCount === 1 ? 'report' : 'reports'}
                    </Pill>
                    {photo.uploadedAt ? (
                      <span className="text-xs text-slate-500">
                        Uploaded <Timestamp value={photo.uploadedAt} />
                      </span>
                    ) : null}
                  </div>

                  {/* Every reason, verbatim. One person calling a photo "bad"
                      and four describing the same specific problem are very
                      different situations, and only the text shows which. */}
                  <ul className="mt-3 space-y-1.5">
                    {photo.reports.map((report, index) => (
                      <li
                        key={`${photo.photoId}-${index}`}
                        className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"
                      >
                        {report.reason}
                        <span className="ml-2 text-xs text-slate-400">
                          <Timestamp value={report.createdAt} />
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <AdminButton
                      variant="danger"
                      onClick={() => setTarget({ photo, decision: 'remove' })}
                    >
                      Take it down
                    </AdminButton>
                    <AdminButton
                      variant="secondary"
                      onClick={() => setTarget({ photo, decision: 'keep' })}
                    >
                      Keep it
                    </AdminButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {target ? (
        <ConfirmDialog
          title={target.decision === 'remove' ? 'Take this photo down' : 'Dismiss these reports'}
          description={
            target.decision === 'remove'
              ? 'The technician loses their photo and is shown your reason so they can replace it. Customers fall back to their initials.'
              : 'The photo stays live and the reports are cleared. It returns here only if somebody reports it again.'
          }
          confirmLabel={target.decision === 'remove' ? 'Take it down' : 'Keep it'}
          tone={target.decision === 'remove' ? 'danger' : 'primary'}
          /**
           * A takedown needs a reason and the server enforces it too. This is
           * somebody's face on their own livelihood — "removed" with no reason
           * is not an answer you can give the technician who asks why.
           */
          fields={
            target.decision === 'remove'
              ? [reasonField('Reason', 'Shown to the technician so they know what to replace.')]
              : []
          }
          pending={decide.isPending}
          error={decide.error}
          onClose={() => setTarget(null)}
          onConfirm={(values) =>
            decide.mutate({
              photoId: target.photo.photoId,
              decision: target.decision,
              note: values.reason,
            })
          }
        />
      ) : null}
    </div>
  );
}
