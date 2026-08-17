import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { useBookingReviews, useCreateReview } from '@/surfaces/customer/data/reviews';
import {
  CUSTOMER_TO_PROVIDER_TAGS,
  type CustomerToProviderTag,
} from '@/surfaces/customer/data/types';
import { Button, Card, ErrorState, QueryState, TextArea } from '@/components/ui';

/**
 * Gated exactly as the API gates it: `POST /bookings/:id/reviews` only
 * succeeds for a booking that is done **and paid for**
 * (`REVIEW_NOT_ALLOWED` otherwise) and only once per caller
 * (`REVIEW_ALREADY_EXISTS`). Rather than re-derive those rules client-side —
 * which would drift the moment the API's own window/eligibility logic
 * changes — this fetches the booking's existing reviews first: a
 * `customer_to_provider` review already present means "already reviewed,
 * show it read-only"; its absence means "try the form, let the API's error
 * (if any) explain why not" rather than guessing eligibility from the
 * booking status alone. Ported from
 * `legacy-next-src/components/customer/bookings/ReviewForm.tsx`.
 */
export function ReviewForm({ bookingId }: { bookingId: string }) {
  const t = useT();
  const existing = useBookingReviews(bookingId);
  const createReview = useCreateReview(bookingId);

  const [stars, setStars] = useState(5);
  const [tags, setTags] = useState<CustomerToProviderTag[]>([]);
  const [text, setText] = useState('');

  function toggleTag(tag: CustomerToProviderTag) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t2) => t2 !== tag) : [...prev, tag]));
  }

  return (
    <QueryState
      status={existing.status}
      error={existing.error}
      data={existing.data}
      loadingLabel={t('common.loading')}
      onRetry={() => void existing.refetch()}
    >
      {(data) => {
        const mine = data.reviews.find((r) => r.direction === 'customer_to_provider');

        if (mine) {
          return (
            <Card title={t('app.review.yourReview')}>
              <p aria-label={t('app.provider.starsLabel', { stars: mine.stars })}>
                {'⭐'.repeat(mine.stars)}
              </p>
              {mine.text ? <p className="mt-1 text-sm text-slate-700">{mine.text}</p> : null}
            </Card>
          );
        }

        return (
          <Card title={t('app.review.rateTitle')}>
            <div className="flex flex-col gap-3">
              <div className="flex gap-1" role="radiogroup" aria-label={t('app.review.starsLabel')}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={stars === value}
                    onClick={() => setStars(value)}
                    className="min-h-touch min-w-touch text-2xl"
                  >
                    {value <= stars ? '⭐' : '☆'}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {CUSTOMER_TO_PROVIDER_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={tags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                    className={`min-h-touch rounded-full border px-3 text-sm ${
                      tags.includes(tag)
                        ? 'border-brand bg-brand text-brand-foreground'
                        : 'border-slate-300 text-slate-700'
                    }`}
                  >
                    {t(`app.reviewTag.${tag}`)}
                  </button>
                ))}
              </div>

              <TextArea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('app.review.textPlaceholder')}
                maxLength={500}
              />

              {createReview.isError ? <ErrorState error={createReview.error} /> : null}

              <Button
                variant="primary"
                fullWidth
                disabled={createReview.isPending}
                onClick={() => createReview.mutate({ stars, tags, text: text.trim() || undefined })}
              >
                {createReview.isPending ? t('common.loading') : t('app.review.submit')}
              </Button>
            </div>
          </Card>
        );
      }}
    </QueryState>
  );
}
