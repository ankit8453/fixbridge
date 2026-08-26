import { useState } from 'react';
import { useT } from '@/i18n/useT';
import { useBookingReviews, useCreateReview } from '@/surfaces/customer/data/reviews';
import { StarIcon } from '@/surfaces/customer/components/find/TrustIcons';
import {
  CUSTOMER_TO_PROVIDER_TAGS,
  type CustomerToProviderTag,
} from '@/surfaces/customer/data/types';
import { Button, ErrorState, QueryState, TextArea } from '@/components/ui';

/**
 * A row of stars, drawn rather than typed.
 *
 * These were `'⭐'.repeat(n)` and `'☆'`, which is the same mistake
 * `CategoryIcon.tsx` was written to fix: emoji render differently on every
 * Android skin, cannot take the surface's colour, and sit on the text baseline
 * so a row of five never lines up with the label beside it. `StarIcon` is the
 * same glyph the search card already uses for a rating, so a rating means the
 * same shape everywhere in the product.
 */
function StarRow({ stars, className = 'h-4 w-4' }: { stars: number; className?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((value) => (
        <StarIcon
          key={value}
          className={value <= stars ? className : `${className} text-shop-line`}
          filled={value <= stars}
        />
      ))}
    </span>
  );
}

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
 * booking status alone.
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
            <section className="rounded-xl border border-shop-line bg-white px-4 py-3">
              <h3 className="text-[13px] font-semibold text-shop-ink">
                {t('app.review.yourReview')}
              </h3>
              <p
                className="mt-1.5"
                aria-label={t('app.provider.starsLabel', { stars: mine.stars })}
              >
                <StarRow stars={mine.stars} className="h-[18px] w-[18px]" />
              </p>
              {mine.text ? (
                <p className="mt-1.5 text-sm leading-relaxed text-shop-ink-soft">{mine.text}</p>
              ) : null}
            </section>
          );
        }

        return (
          <section className="rounded-xl border border-shop-line bg-white px-4 py-3">
            <h3 className="text-[13px] font-semibold text-shop-ink">{t('app.review.rateTitle')}</h3>

            <div className="mt-2 flex flex-col gap-3">
              <div className="flex gap-1" role="radiogroup" aria-label={t('app.review.starsLabel')}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={stars === value}
                    aria-label={t('app.provider.starsLabel', { stars: value })}
                    onClick={() => setStars(value)}
                    className={`min-h-touch min-w-touch flex items-center justify-center rounded-lg transition-colors ${
                      value <= stars ? 'text-amber-500' : 'text-shop-line hover:text-amber-300'
                    }`}
                  >
                    <StarIcon className="h-8 w-8" filled={value <= stars} />
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {CUSTOMER_TO_PROVIDER_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={tags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                    className={`min-h-touch rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
                      tags.includes(tag)
                        ? 'border-shop bg-shop text-shop-foreground'
                        : 'border-shop-line bg-white text-shop-ink-soft hover:border-shop/40'
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
                variant="shop"
                fullWidth
                disabled={createReview.isPending}
                onClick={() => createReview.mutate({ stars, tags, text: text.trim() || undefined })}
                className="border-transparent bg-shop text-shop-foreground hover:opacity-90"
              >
                {createReview.isPending ? t('common.loading') : t('app.review.submit')}
              </Button>
            </div>
          </section>
        );
      }}
    </QueryState>
  );
}
