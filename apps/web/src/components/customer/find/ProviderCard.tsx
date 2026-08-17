'use client';

import Link from 'next/link';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { Badge } from '@/components/ui';
import { cacheProviderCard } from '@/components/customer/data/providers';
import type { SearchResultCard } from '@/components/customer/data/types';

const BADGE_TONE = { NONE: 'neutral', VERIFIED: 'info', SILVER: 'warn', GOLD: 'good' } as const;

/**
 * The full result card the phase spec calls for: badge, rating, jobs,
 * distance, starting price, next slot. Every field is optional in the API
 * response (rating null until rated, price null for inspection-only
 * providers, etc.) and rendered as an honest "—", never a fabricated value.
 */
export function ProviderCard({ result }: { result: SearchResultCard }) {
  const t = useT();
  const locale = useLocale();

  return (
    <Link
      href={buildLocalizedHref(locale, `/app/providers/${result.providerId}`)}
      onClick={() => cacheProviderCard(result)}
      className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 transition-colors active:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-900">
            {result.displayName ?? t('app.find.unnamedProvider')}
          </p>
          <p className="text-xs text-slate-500">
            {result.skills.map((s) => s.name).join(' · ') || '—'}
          </p>
        </div>
        <Badge tone={BADGE_TONE[result.badge]}>{t(`app.badge.${result.badge}`)}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
        <span>
          {result.rating
            ? `⭐ ${result.rating.average.toFixed(1)} (${result.rating.count})`
            : t('app.find.noRatingYet')}
        </span>
        <span>{t('app.find.jobsCompleted', { count: result.jobsCompleted })}</span>
        <span>{t('app.find.distanceKm', { distance: result.distanceKm.toFixed(1) })}</span>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
        <span className="font-medium text-slate-900">
          {result.startingPrice
            ? t('app.find.startingFrom', { price: result.startingPrice.display })
            : t('app.find.priceOnInspection')}
        </span>
        <span className="text-slate-500">
          {result.nextAvailability
            ? t('app.find.nextSlot', {
                day: t(`app.dayOfWeek.${result.nextAvailability.dayOfWeek}`),
                time: result.nextAvailability.startTime,
              })
            : t('app.find.noUpcomingSlot')}
        </span>
      </div>
    </Link>
  );
}
