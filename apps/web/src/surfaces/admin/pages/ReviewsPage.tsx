import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { EyeOff, Star, Undo2 } from 'lucide-react';
import { fetchReviewReports, hideReview } from '../lib/api';
import { useAdminMutation } from '../lib/mutations';
import { useFilters } from '../lib/filters';
import type { ReviewReport } from '../lib/types';
import { ConfirmDialog, reasonField } from '../components/ConfirmDialog';
import { Timestamp } from '../components/Timestamp';
import { AdminButton, Card, EmptyState, Pill, SectionHeader, SkeletonRows } from '../components/ui';
import { ErrorState, Pagination } from '@/components/ui';

/**
 * Reported reviews, with enough context to judge one. Ported from
 * `legacy-next-src/app/[locale]/admin/reviews/page.tsx`.
 *
 * Hiding a review is not deletion — the row survives and is excluded from
 * the aggregates on the next recompute. That is why the confirmation still
 * asks for a reason even though the API's hide route does not require one:
 * a rating is part of somebody's livelihood, and "ops hid it" with no note
 * is the version of this decision nobody can defend later.
 */
export default function ReviewsPage() {
  const filters = useFilters();
  const [target, setTarget] = useState<{ reviewId: string; hide: boolean } | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'reviews', 'reports', filters.page],
    queryFn: () => fetchReviewReports({ page: filters.page }),
  });

  const moderate = useAdminMutation(
    (input: { reviewId: string; hide: boolean }) => hideReview(input.reviewId, input.hide),
    {
      invalidate: [
        ['admin', 'reviews'],
        ['admin', 'summary'],
      ],
      onDone: () => setTarget(null),
    },
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Reported reviews"
        description="Only public customer→technician reviews can be reported. Provider→customer reviews are internal and appear nowhere."
      />

      <Card padded={false}>
        {query.status === 'pending' ? (
          <SkeletonRows rows={4} />
        ) : query.status === 'error' || query.data === undefined ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={Star}
            title="Nothing reported."
            description="Reports arrive from the customer app when somebody flags a review. An empty queue here is good news."
          />
        ) : (
          <div className="p-3">
            <ul className="space-y-2.5">
              {query.data.items.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  onModerate={(hide) => setTarget({ reviewId: report.reviewId, hide })}
                />
              ))}
            </ul>
            <div className="mt-3">
              <Pagination
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onChange={filters.setPage}
              />
            </div>
          </div>
        )}
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
    </div>
  );
}

/**
 * The star rating, drawn rather than spelled.
 *
 * A moderation queue is scanned for one-star reviews, and "1 star" as text
 * reads at the same weight as "5 stars". Five glyphs do not.
 */
function Stars({ stars }: { stars: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(stars)));

  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            className={
              i < filled ? 'h-3.5 w-3.5 fill-warning text-warning' : 'h-3.5 w-3.5 text-slate-300'
            }
            strokeWidth={1.75}
          />
        ))}
      </span>
      <span className="text-xs font-semibold tabular-nums text-slate-700">
        {stars} {stars === 1 ? 'star' : 'stars'}
      </span>
    </span>
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
    <li
      className={
        hidden
          ? 'rounded-xl border border-slate-200 bg-slate-50 p-3.5'
          : 'rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="warning">reported</Pill>
          {review ? <Stars stars={review.stars} /> : null}
          {hidden ? <Pill tone="danger">hidden</Pill> : null}
          <span className="text-xs">
            <Timestamp value={report.createdAt} />
          </span>
        </div>
        <div className="flex gap-2">
          {hidden ? (
            <AdminButton size="sm" variant="secondary" onClick={() => onModerate(false)}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
              Restore
            </AdminButton>
          ) : (
            <AdminButton size="sm" variant="danger" onClick={() => onModerate(true)}>
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
              Hide
            </AdminButton>
          )}
        </div>
      </div>

      {/* The review itself, quoted — it is the thing being judged, so it
          should not read as one more metadata line among the others. */}
      <blockquote
        className={
          hidden
            ? 'mt-2.5 border-l-2 border-slate-300 pl-3 text-[13px] leading-relaxed text-slate-500 line-through'
            : 'mt-2.5 border-l-2 border-slate-300 pl-3 text-[13px] leading-relaxed text-slate-800'
        }
      >
        {review?.text ?? <span className="italic text-slate-400">(no review text)</span>}
      </blockquote>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="shrink-0 font-semibold text-slate-500">Reported because:</dt>
          <dd className="min-w-0 text-slate-700">
            {report.reason}
            {report.reporter ? (
              <span className="text-slate-500">
                {' '}
                — by {report.reporter.name ?? report.reporter.id}
              </span>
            ) : null}
          </dd>
        </div>
        {review?.author ? (
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-semibold text-slate-500">Written by:</dt>
            <dd className="min-w-0 truncate text-slate-700">
              {review.author.name ?? review.author.id}
            </dd>
          </div>
        ) : null}
        {review?.bookingId ? (
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-semibold text-slate-500">Booking:</dt>
            <dd className="min-w-0 truncate">
              <Link
                className="font-mono text-admin hover:underline"
                to={`/admin/bookings/${review.bookingId}`}
              >
                {review.bookingId}
              </Link>
            </dd>
          </div>
        ) : null}
        {review?.subjectUserId ? (
          <div className="flex gap-1.5">
            <dt className="shrink-0 font-semibold text-slate-500">About:</dt>
            <dd className="min-w-0 truncate">
              <Link
                className="font-mono text-admin hover:underline"
                to={`/admin/providers/${review.subjectUserId}`}
              >
                {review.subjectUserId}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}
