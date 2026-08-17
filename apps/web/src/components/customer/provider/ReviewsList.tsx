'use client';

import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { useProviderReviews } from '@/components/customer/data/providers';
import { QueryState, Pagination } from '@/components/ui';

export function ReviewsList({ providerId }: { providerId: string }) {
  const t = useT();
  const [page, setPage] = useState(1);
  const query = useProviderReviews(providerId, page);

  return (
    <QueryState
      status={query.status}
      error={query.error}
      data={query.data}
      loadingLabel={t('app.provider.loadingReviews')}
      empty={{ title: t('app.provider.noReviews') }}
      isEmpty={(data) => data.reviews.length === 0}
      onRetry={() => void query.refetch()}
    >
      {(data) => (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">
            {data.averageStars
              ? t('app.provider.ratingSummary', {
                  average: data.averageStars.toFixed(1),
                  count: data.reviewCount,
                })
              : t('app.find.noRatingYet')}
          </p>
          {data.reviews.map((review) => (
            <div key={review.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900">{review.authorName}</span>
                <span aria-label={t('app.provider.starsLabel', { stars: review.stars })}>
                  {'⭐'.repeat(review.stars)}
                </span>
              </div>
              {review.text ? <p className="mt-1 text-sm text-slate-700">{review.text}</p> : null}
              {review.tags.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {review.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                    >
                      {t(`app.reviewTag.${tag}`)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onChange={setPage}
          />
        </div>
      )}
    </QueryState>
  );
}
