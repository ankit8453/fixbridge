import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { useProviderReviews } from '@/surfaces/customer/data/providers';
import { StarIcon } from '@/surfaces/customer/components/find/TrustIcons';
import { Avatar, ErrorState, Pagination, Skeleton } from '@/components/ui';

/**
 * Five stars, drawn.
 *
 * Was `'⭐'.repeat(review.stars)` — a variable-width run of emoji, so a
 * three-star review and a five-star one were different widths and the eye
 * could not compare two reviews down a column without counting. A fixed row of
 * five, with the unearned ones left as hairline outlines, makes the rating
 * readable as a proportion at a glance.
 */
function Stars({ stars }: { stars: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-amber-500" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((value) => (
        <StarIcon
          key={value}
          className={value <= stars ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5 text-shop-line'}
          filled={value <= stars}
        />
      ))}
    </span>
  );
}

function ReviewSkeleton() {
  return (
    <div className="rounded-xl border border-shop-line bg-white p-3">
      <Skeleton className="h-3.5 w-1/3" />
      <Skeleton className="mt-2 h-3 w-full" />
      <Skeleton className="mt-1.5 h-3 w-2/3" />
    </div>
  );
}

export function ReviewsList({ providerId }: { providerId: string }) {
  const t = useT();
  const [page, setPage] = useState(1);
  const query = useProviderReviews(providerId, page);

  if (query.status === 'pending') {
    return (
      <div
        className="flex flex-col gap-2.5"
        role="status"
        aria-label={t('app.provider.loadingReviews')}
      >
        <ReviewSkeleton />
        <ReviewSkeleton />
      </div>
    );
  }

  if (query.status === 'error' || query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const data = query.data;

  if (data.reviews.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-shop-line px-4 py-6 text-center">
        <p className="text-sm font-medium text-shop-ink">{t('app.provider.noReviews')}</p>
        {/* Says why there is nothing rather than only that there is nothing —
            "no reviews" on a new technician otherwise reads as a warning. */}
        <p className="mt-1 text-[13px] leading-relaxed text-shop-ink-soft">
          {t('app.provider.noRatingBreakdown')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {data.averageStars ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-shop-soft/60 px-3.5 py-2.5">
          <span className="text-[22px] font-bold leading-none tabular-nums text-shop-ink">
            {data.averageStars.toFixed(1)}
          </span>
          <span className="min-w-0">
            <Stars stars={Math.round(data.averageStars)} />
            <span className="mt-0.5 block text-[11.5px] text-shop-ink-soft">
              {t('app.provider.reviewCount', { count: data.reviewCount })}
            </span>
          </span>
        </div>
      ) : null}

      {data.reviews.map((review) => (
        <article key={review.id} className="rounded-xl border border-shop-line bg-white p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={review.authorName} size={30} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-shop-ink">
              {review.authorName}
            </span>
            <span aria-label={t('app.provider.starsLabel', { stars: review.stars })}>
              <Stars stars={review.stars} />
            </span>
          </div>

          {review.text ? (
            <p className="mt-2 text-[13px] leading-relaxed text-shop-ink-soft">{review.text}</p>
          ) : null}

          {review.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {review.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-shop-soft px-1.5 py-0.5 text-[11px] font-medium text-shop-deep"
                >
                  {t(`app.reviewTag.${tag}`)}
                </span>
              ))}
            </div>
          ) : null}
        </article>
      ))}

      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
    </div>
  );
}
