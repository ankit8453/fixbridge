import { useT } from '@/i18n/useT';
import { APP_NAME } from '@/brand/tokens';
import { Avatar } from '@/components/ui';
import { BADGE_TIER } from '@/surfaces/customer/components/find/badge-tier';
import {
  JobsDoneIcon,
  RupeeIcon,
  ShieldTickIcon,
  StarIcon,
} from '@/surfaces/customer/components/find/TrustIcons';
import type { PublicProviderProfile } from '@/surfaces/customer/data/types';

/**
 * One number and what it means. Three of these sit in a row under the name.
 *
 * A run-on line of `rating · jobs · years · city` separated by middots gave the
 * rating exactly as much weight as the city, so the two facts a customer
 * actually weighs before letting somebody into their house were as scannable as
 * the least important one. Numbers big, labels small.
 */
function Stat({
  icon,
  value,
  label,
}: {
  icon?: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="min-w-0 flex-1 px-1 text-center">
      <p className="flex items-center justify-center gap-1 text-[17px] font-bold leading-none tabular-nums text-shop-ink">
        {icon}
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] font-medium text-shop-ink-soft">{label}</p>
    </div>
  );
}

/**
 * The profile hero.
 *
 * Renders from the public provider profile (`GET /providers/:id` — see
 * `data/providers.ts`). The legacy Next app rendered this from a
 * `sessionStorage`-cached search result card because no profile-by-id endpoint
 * existed; that workaround degraded to a "please go back and search again"
 * message on a cold visit, which broke the moment there was a URL to forward.
 * This version has nothing to degrade to — a shared WhatsApp link renders a
 * full header on first load.
 *
 * The badge tier is the loudest thing after the name, using the shared
 * `BADGE_TIER` vocabulary so a technician who showed as GOLD in the results
 * list cannot show as something else here. Note that no coordinates and no
 * phone number appear anywhere on this component: the search and profile
 * endpoints deliberately withhold both until a booking is accepted, and there
 * is nothing here that could leak them even if they were sent.
 */
export function ProviderHeader({ profile }: { profile: PublicProviderProfile }) {
  const t = useT();
  const tier = BADGE_TIER[profile.badge];
  const name = profile.displayName ?? t('app.find.unnamedProvider');
  const firstPrice = profile.priceCards.find((c) => c.display)?.display ?? null;

  return (
    <section className="overflow-hidden rounded-2xl border border-shop-line bg-white">
      <div className="flex items-start gap-3.5 p-4">
        {/* No `src`. The public profile carries no photo URL — the approved
            photo is released per booking, not to an open profile page (see
            `BookingCounterpart.photoUrl`) — so this is always initials. */}
        <Avatar name={name} size={60} />

        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-bold leading-tight tracking-tight text-shop-ink">
            {name}
          </h1>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tier.chip}`}
            >
              {tier.verified ? <ShieldTickIcon className="h-3 w-3" /> : null}
              {t(`app.badge.${profile.badge}`)}
            </span>
            {profile.city ? (
              <span className="text-[13px] font-medium text-shop-ink-soft">
                {profile.city.name}
              </span>
            ) : null}
          </div>

          {profile.skills.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.skills.map((skill) => (
                <span
                  key={skill.categoryId}
                  className="rounded-lg bg-shop-soft px-2 py-0.5 text-[11px] font-medium text-shop-deep"
                >
                  {skill.slug}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {profile.bio ? (
        <p className="px-4 pb-3 text-[13px] leading-relaxed text-shop-ink-soft">{profile.bio}</p>
      ) : null}

      {/* ---------------- The three numbers ---------------- */}
      <div className="flex items-stretch divide-x divide-shop-line border-y border-shop-line bg-shop-soft/40 py-2.5">
        <Stat
          icon={profile.rating ? <StarIcon className="h-4 w-4 text-amber-500" /> : undefined}
          /* An unrated technician gets a dash and an honest label, never a
             fabricated 0.0 — which reads as a bad rating, not an absent one. */
          value={profile.rating ? profile.rating.average.toFixed(1) : '—'}
          label={
            profile.rating
              ? t('app.provider.reviewCount', { count: profile.rating.count })
              : t('app.find.noRatingYet')
          }
        />
        <Stat
          icon={<JobsDoneIcon className="h-4 w-4 text-shop-ink-soft" />}
          value={profile.jobsCompleted}
          label={t('app.provider.jobsLabel')}
        />
        <Stat
          value={
            profile.yearsExperience !== null
              ? t('app.provider.yearsShort', { years: profile.yearsExperience })
              : '—'
          }
          label={t('app.provider.experienceLabel')}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-shop-ink">
          <RupeeIcon className="h-4 w-4 shrink-0 text-shop-ink-soft" aria-hidden="true" />
          {firstPrice
            ? t('app.find.startingFrom', { price: firstPrice })
            : t('app.provider.noPriceCards')}
        </p>
        <p className="text-[11px] text-shop-ink-soft">
          {t('app.provider.memberSince', {
            app: APP_NAME,
            date: new Date(profile.memberSince).toLocaleDateString(undefined, {
              month: 'short',
              year: 'numeric',
            }),
          })}
        </p>
      </div>
    </section>
  );
}
