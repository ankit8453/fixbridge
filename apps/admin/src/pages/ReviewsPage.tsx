import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchReviewReports, hideReview } from '../api/endpoints';
import type { ReviewReport } from '../api/types';
import { ConfirmDialog, reasonField } from '../components/ConfirmDialog';
import { PageHeader } from '../components/Layout';
import { Timestamp } from '../components/Timestamp';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Pagination } from '../components/ui/Pagination';
import { QueryState } from '../components/ui/States';
import { useFilters } from '../lib/filters';
import { useAdminMutation } from '../lib/mutations';

/**
 * Reported reviews, with enough context to judge one.
 *
 * Hiding a review is not deletion — the row survives and is excluded from the
 * aggregates on the next recompute. That is why the confirmation still asks for
 * a reason even though the API's hide route does not require one: a rating is
 * part of somebody's livelihood, and "ops hid it" with no note is the version of
 * this decision nobody can defend later.
 */
export function ReviewsPage() {
  const filters = useFilters();
  const [target, setTarget] = useState<{ reviewId: string; hide: boolean } | null>(null);

  const query = useQuery({
    queryKey: ['reviews', 'reports', filters.page],
    queryFn: () => fetchReviewReports({ page: filters.page }),
  });

  const moderate = useAdminMutation(
    (input: { reviewId: string; hide: boolean }) => hideReview(input.reviewId, input.hide),
    { invalidate: [['reviews'], ['summary']], onDone: () => setTarget(null) },
  );

  return (
    <>
      <PageHeader
        title="Reported reviews"
        subtitle="Only public customer→technician reviews can be reported. Provider→customer reviews are internal and appear nowhere."
      />

      <Card title="Reports">
        <QueryState
          status={query.status}
          error={query.error}
          data={query.data}
          loadingLabel="Loading reported reviews…"
          isEmpty={(page) => page.items.length === 0}
          empty={{
            title: 'Nothing reported.',
            hint: 'Reports arrive from the customer app when somebody flags a review.',
          }}
          onRetry={() => void query.refetch()}
        >
          {(page) => (
            <>
              <ul className="space-y-3">
                {page.items.map((report) => (
                  <ReportCard
                    key={report.id}
                    report={report}
                    onModerate={(hide) => setTarget({ reviewId: report.reviewId, hide })}
                  />
                ))}
              </ul>
              <Pagination
                page={page.page}
                pageSize={page.pageSize}
                total={page.total}
                onChange={filters.setPage}
              />
            </>
          )}
        </QueryState>
      </Card>

      {target ? (
        <ConfirmDialog
          title={target.hide ? 'Hide this review' : 'Restore this review'}
          description={
            target.hide
              ? 'It stops counting towards the technician’s rating on the next recompute. The row is not deleted.'
              : 'It becomes public again and counts towards the rating on the next recompute.'
          }
          confirmLabel={target.hide ? 'Hide review' : 'Restore review'}
          tone={target.hide ? 'danger' : 'primary'}
          pending={moderate.isPending}
          error={moderate.error}
          fields={[reasonField('Reason', 'For your own record — the API does not store this one.')]}
          onClose={() => setTarget(null)}
          onConfirm={() => moderate.mutate(target)}
        />
      ) : null}
    </>
  );
}

function ReportCard({
  report,
  onModerate,
}: {
  report: ReviewReport;
  onModerate: (hide: boolean) => void;
}) {
  const review = report.review;
  const hidden = review?.status === 'hidden';

  return (
    <li className="rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="warn">reported</Badge>
          {review ? <span className="text-sm font-medium">{review.stars} stars</span> : null}
          {hidden ? <Badge tone="bad">hidden</Badge> : null}
          <span className="text-xs text-slate-500">
            <Timestamp value={report.createdAt} />
          </span>
        </div>
        <div className="flex gap-2">
          {hidden ? (
            <Button variant="secondary" onClick={() => onModerate(false)}>
              Restore
            </Button>
          ) : (
            <Button variant="danger" onClick={() => onModerate(true)}>
              Hide
            </Button>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm text-slate-800">{review?.text ?? '(no review text)'}</p>

      <dl className="mt-2 space-y-0.5 text-xs text-slate-600">
        <div>
          <span className="font-medium">Reported because:</span> {report.reason}
          {report.reporter ? <span> — by {report.reporter.name ?? report.reporter.id}</span> : null}
        </div>
        {review?.author ? (
          <div>
            <span className="font-medium">Written by:</span>{' '}
            {review.author.name ?? review.author.id}
          </div>
        ) : null}
        {review?.bookingId ? (
          <div>
            <span className="font-medium">Booking:</span>{' '}
            <Link className="text-blue-700 hover:underline" to={`/bookings/${review.bookingId}`}>
              {review.bookingId}
            </Link>
          </div>
        ) : null}
        {review?.subjectUserId ? (
          <div>
            <span className="font-medium">About:</span>{' '}
            <Link
              className="text-blue-700 hover:underline"
              to={`/providers/${review.subjectUserId}`}
            >
              {review.subjectUserId}
            </Link>
          </div>
        ) : null}
      </dl>
    </li>
  );
}
