'use client';

import { useT } from '@/i18n/useT';
import { Badge } from '@/components/ui';
import type { SearchResultCard } from '@/components/customer/data/types';

const BADGE_TONE = { NONE: 'neutral', VERIFIED: 'info', SILVER: 'warn', GOLD: 'good' } as const;

/**
 * Renders from the cached search-result card, or an honest degraded state
 * when there is none (a cold visit with no prior search this session — see
 * `data/providers.ts`'s comment on why there is no public provider-detail
 * endpoint to fall back to).
 */
export function ProviderHeader({ card }: { card: SearchResultCard | null }) {
  const t = useT();

  if (!card) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
        {t('app.provider.noCachedProfile')}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {card.displayName ?? t('app.find.unnamedProvider')}
          </h1>
          <p className="text-sm text-slate-500">
            {card.skills.map((s) => s.name).join(' · ') || '—'}
          </p>
        </div>
        <Badge tone={BADGE_TONE[card.badge]}>{t(`app.badge.${card.badge}`)}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
        <span>
          {card.rating
            ? `⭐ ${card.rating.average.toFixed(1)} (${card.rating.count})`
            : t('app.find.noRatingYet')}
        </span>
        <span>{t('app.find.jobsCompleted', { count: card.jobsCompleted })}</span>
        {card.yearsExperience !== null ? (
          <span>{t('app.provider.yearsExperience', { years: card.yearsExperience })}</span>
        ) : null}
        <span>{t('app.find.distanceKm', { distance: card.distanceKm.toFixed(1) })}</span>
      </div>

      {card.startingPrice ? (
        <p className="mt-2 text-sm font-medium text-slate-900">
          {t('app.find.startingFrom', { price: card.startingPrice.display })}
        </p>
      ) : null}
    </div>
  );
}
