import { useT } from '@/i18n/useT';
import { Badge, type Tone } from '@/components/ui';
import type { PublicProviderProfile } from '@/surfaces/customer/data/types';

const BADGE_TONE: Record<PublicProviderProfile['badge'], Tone> = {
  NONE: 'neutral',
  VERIFIED: 'info',
  SILVER: 'warning',
  GOLD: 'success',
};

/**
 * Renders from the public provider profile (`GET /providers/:id`, added in
 * Phase 12 — see `data/providers.ts`). The legacy Next app rendered this from
 * a `sessionStorage`-cached search result card because no profile-by-id
 * endpoint existed; that workaround degraded to a "please go back and search
 * again" message on a cold visit, which broke the moment there was a URL to
 * forward. This version has nothing to degrade to — a shared WhatsApp link
 * now renders a full header on first load.
 */
export function ProviderHeader({ profile }: { profile: PublicProviderProfile }) {
  const t = useT();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {profile.displayName ?? t('app.find.unnamedProvider')}
          </h1>
          <p className="text-sm text-slate-500">
            {profile.skills.map((s) => s.slug).join(' · ') || '—'}
          </p>
        </div>
        <Badge tone={BADGE_TONE[profile.badge]}>{t(`app.badge.${profile.badge}`)}</Badge>
      </div>

      {profile.bio ? <p className="mt-2 text-sm text-slate-700">{profile.bio}</p> : null}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
        <span>
          {profile.rating
            ? `⭐ ${profile.rating.average.toFixed(1)} (${profile.rating.count})`
            : t('app.find.noRatingYet')}
        </span>
        <span>{t('app.find.jobsCompleted', { count: profile.jobsCompleted })}</span>
        {profile.yearsExperience !== null ? (
          <span>{t('app.provider.yearsExperience', { years: profile.yearsExperience })}</span>
        ) : null}
        {profile.city ? <span>{profile.city.name}</span> : null}
      </div>

      {profile.priceCards.length > 0 ? (
        <p className="mt-2 text-sm font-medium text-slate-900">
          {t('app.find.startingFrom', {
            price: profile.priceCards.find((c) => c.display)?.display ?? '—',
          })}
        </p>
      ) : null}
    </div>
  );
}
