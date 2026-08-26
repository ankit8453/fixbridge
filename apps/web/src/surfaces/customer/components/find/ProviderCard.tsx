import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { Avatar } from '@/components/ui';
import { BADGE_TIER } from './badge-tier';
import { ClockIcon, JobsDoneIcon, PinIcon, ShieldTickIcon, StarIcon } from './TrustIcons';
import type { SearchResultCard } from '@/surfaces/customer/data/types';

/** At most this many trade chips before the rest collapse into "+N more". */
const MAX_VISIBLE_SKILLS = 2;

/**
 * The card a booking decision is actually made on.
 *
 * It answers three questions, in the order a customer asks them: *can I trust
 * this person* (the tier chip and the rating, at the top), *are they near me*
 * (the distance, in the stat row), *what will it cost* (the price, given its
 * own emphasised footer rather than being one more item in a run-on line).
 *
 * The previous version put all six facts in two undifferentiated rows of
 * `text-sm text-slate-700` separated by middots, which gave the rating exactly
 * as much visual weight as the skill list — so a customer scanning ten results
 * had to read every card in full instead of triaging them at a glance. That
 * hierarchy is the whole point of the redesign.
 *
 * Every field is optional in the API response (rating null until rated, price
 * null for inspection-only providers, no upcoming slot) and each renders an
 * honest, translated absence — never a fabricated value, and never a bare "—"
 * where a sentence would tell the customer what the absence actually means.
 *
 * Behaviour is unchanged: still one `<Link>` to the provider page, and still no
 * `sessionStorage` stash on click, because the provider page fetches its own
 * profile from the public `GET /providers/:id` endpoint (see `data/providers.ts`).
 */
export function ProviderCard({ result }: { result: SearchResultCard }) {
  const t = useT();
  const locale = useLocale();

  const tier = BADGE_TIER[result.badge];
  const name = result.displayName ?? t('app.find.unnamedProvider');
  const visibleSkills = result.skills.slice(0, MAX_VISIBLE_SKILLS);
  const hiddenSkillCount = result.skills.length - visibleSkills.length;

  return (
    <Link
      to={buildLocalizedHref(locale, `/app/providers/${result.providerId}`)}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-shop-line bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-shop/30 hover:shadow-lg active:translate-y-0"
    >
      {/* A faint brand wash behind the header, so the card has a top edge that
          reads as a header band without a hard divider rule. Decorative only. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-shop-soft opacity-70 blur-2xl transition-opacity duration-200 group-hover:opacity-100"
      />

      <div className="relative flex flex-col gap-3.5 p-4">
        {/* ---------------- Identity ---------------- */}
        <div className="flex items-start gap-3">
          {/* No `src` on purpose. Search results carry no photo URL — the
              technician's approved photo is released per booking, not to the
              open result list (see `BookingCounterpart.photoUrl`), so this is
              always the initials fallback and is meant to be. */}
          <Avatar name={name} size={52} />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-[16px] font-bold leading-tight tracking-tight text-shop-ink">
                {name}
              </p>
              <ChevronRight
                className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-shop"
                aria-hidden="true"
              />
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {/* The tier chip sits directly under the name rather than
                  floating at the card's opposite corner: verification is a
                  property of this person, and reading it should not require
                  the eye to travel to the other side of the card and back. */}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tier.chip}`}
              >
                {tier.verified ? <ShieldTickIcon className="h-3 w-3" /> : null}
                {t(`app.badge.${result.badge}`)}
              </span>

              {/* An unrated technician gets a plain, non-alarming phrase. A
                  greyed-out zero-star row would read as a bad rating rather
                  than as an absent one. */}
              {result.rating ? (
                <span
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-shop-ink"
                  aria-label={t('app.find.ratingAria', {
                    average: result.rating.average.toFixed(1),
                    count: result.rating.count,
                  })}
                >
                  <StarIcon className="h-3.5 w-3.5 text-amber-500" />
                  {result.rating.average.toFixed(1)}
                  <span className="font-normal text-shop-ink-soft">({result.rating.count})</span>
                </span>
              ) : (
                <span className="text-[13px] font-medium text-shop-ink-soft">
                  {t('app.find.newTechnician')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ---------------- Trades ---------------- */}
        {visibleSkills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {visibleSkills.map((skill) => (
              <span
                key={skill.categoryId}
                className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700"
              >
                {skill.name}
              </span>
            ))}
            {hiddenSkillCount > 0 ? (
              <span className="text-[11px] font-medium text-shop-ink-soft">
                {t('app.find.skillsMore', { count: hiddenSkillCount })}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* ---------------- Proximity + track record ---------------- */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] font-medium text-shop-ink-soft">
          <span className="inline-flex items-center gap-1.5">
            <PinIcon className="h-4 w-4 shrink-0 text-shop" />
            {t('app.find.distanceKm', { distance: result.distanceKm.toFixed(1) })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <JobsDoneIcon className="h-4 w-4 shrink-0 text-slate-400" />
            {t('app.find.jobsCompleted', { count: result.jobsCompleted })}
          </span>
        </div>
      </div>

      {/* ---------------- Price + availability ----------------
          Its own tinted band at the foot of the card. Price is the last thing
          a customer checks and the one thing they compare across results, so
          it gets a fixed position they can scan straight down a column. */}
      <div className="relative flex items-end justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <span className="min-w-0">
          <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-shop-ink-soft">
            {t('app.find.priceLabel')}
          </span>
          {/* `startingPrice.display` is the API's own rendering of the integer
              paise amount (see `SearchResultCard` in `data/types.ts`), used
              verbatim so this surface never does money arithmetic of its own. */}
          <span className="mt-0.5 flex items-center gap-1 text-[14px] font-bold text-shop-ink">
            <span className="truncate">
              {result.startingPrice
                ? t('app.find.startingFrom', { price: result.startingPrice.display })
                : t('app.find.priceOnInspection')}
            </span>
          </span>
        </span>

        <span className="min-w-0 text-right">
          <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-shop-ink-soft">
            {t('app.find.availabilityLabel')}
          </span>
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[13px] font-semibold text-slate-700">
            <ClockIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="truncate">
              {result.nextAvailability
                ? `${t(`app.dayOfWeek.${result.nextAvailability.dayOfWeek}`)} ${result.nextAvailability.startTime}`
                : t('app.find.noUpcomingSlot')}
            </span>
          </span>
        </span>
      </div>
    </Link>
  );
}
