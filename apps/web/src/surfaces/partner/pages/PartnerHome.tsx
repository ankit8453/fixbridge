import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  Wallet,
  ShieldCheck,
  CalendarClock,
  BadgeCheck,
  Bell,
  ChevronRight,
  Gauge,
  Wrench,
} from 'lucide-react';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { ErrorState } from '../../../components/ui';
import { Grid, SkeletonRows, StatTile, StatusPill, type Tone } from '../components/ui';
import { ChecklistCard } from '../components/ChecklistCard';
import { fetchMyProfile } from '../lib/api';
import { partnerKeys } from '../lib/query-keys';

const TILES = [
  { href: '/partner/jobs', labelKey: 'partner.home.tileJobs', icon: Briefcase },
  { href: '/partner/earnings', labelKey: 'partner.home.tileEarnings', icon: Wallet },
  { href: '/partner/trust', labelKey: 'partner.home.tileTrust', icon: BadgeCheck },
  { href: '/partner/slots', labelKey: 'partner.home.tileSlots', icon: CalendarClock },
  { href: '/partner/verification', labelKey: 'partner.home.tileVerification', icon: ShieldCheck },
  { href: '/partner/notifications', labelKey: 'partner.home.tileNotifications', icon: Bell },
] as const;

const BADGE_TONE: Record<string, Tone> = {
  NONE: 'neutral',
  VERIFIED: 'success',
  SILVER: 'brand',
  GOLD: 'success',
};

/**
 * The technician's dashboard — the first screen after sign-in, and the one
 * they return to until every required checklist item is green.
 *
 * Every number on this page comes off the single `GET /providers/me` profile
 * response that was already being fetched for the checklist: the completeness
 * score, the verification badge, and the counts of skills and prices the
 * technician has configured. Nothing here adds a request, and nothing
 * re-derives the listing decision — that is the API's, see `ChecklistCard`.
 */
export default function PartnerHome() {
  const t = useT();
  const locale = useLocale();

  const profileQuery = useQuery({ queryKey: partnerKeys.profile, queryFn: fetchMyProfile });

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {profileQuery.status === 'error' || (profileQuery.isSuccess && !profileQuery.data) ? (
        <ErrorState error={profileQuery.error} onRetry={() => profileQuery.refetch()} />
      ) : profileQuery.isPending ? (
        <SkeletonRows rows={4} />
      ) : (
        (() => {
          const { profile } = profileQuery.data;
          const { completeness } = profile;
          const incomplete = completeness.missingRequired.length > 0;

          return (
            <>
              {/*
                A gradient band rather than a plain heading.
                
                This is the first thing a technician sees each morning, and a
                black-on-white title made the whole app read as a form to fill
                in rather than a place of work. The gradient is built from brand
                tokens, so a rebrand still only touches src/brand/tokens.ts.
              */}
              <div className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-brand via-brand-deep to-brand-accent-alt p-5 shadow-lg lg:p-7">
                {/* Decorative light bloom; aria-hidden since it carries no meaning. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl"
                />
                <div className="relative flex flex-wrap items-end justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold tracking-tight text-white lg:text-3xl">
                      {profile.displayName
                        ? t('partner.home.greeting', { name: profile.displayName })
                        : t('partner.home.title')}
                    </h2>
                    <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-white/80">
                      {incomplete
                        ? t('partner.home.subtitleIncomplete')
                        : t('partner.home.subtitleLive')}
                    </p>
                  </div>
                  <Link
                    to={buildLocalizedHref(locale, '/partner/onboarding')}
                    className="inline-flex min-h-touch shrink-0 items-center rounded-lg bg-white px-4 text-sm font-semibold text-brand shadow-sm transition-transform hover:-translate-y-0.5"
                  >
                    {incomplete ? t('partner.home.completeProfile') : t('partner.home.editProfile')}
                  </Link>
                </div>
              </div>

              <Grid cols={4}>
                <StatTile
                  label={t('partner.home.statListed')}
                  value={
                    <StatusPill tone={profile.isListed ? 'success' : 'warning'}>
                      {profile.isListed
                        ? t('partner.checklist.live')
                        : t('partner.checklist.notLive')}
                    </StatusPill>
                  }
                  hint={
                    profile.isListed
                      ? t('partner.home.statListedHintLive')
                      : t('partner.home.statListedHintNot')
                  }
                  icon={Briefcase}
                  tone={profile.isListed ? 'success' : 'warning'}
                />
                <StatTile
                  label={t('partner.home.statCompleteness')}
                  value={`${completeness.score}`}
                  hint={t('partner.checklist.score', {
                    score: completeness.score,
                    threshold: completeness.threshold,
                  })}
                  icon={Gauge}
                  tone={completeness.score >= completeness.threshold ? 'success' : 'warning'}
                />
                <StatTile
                  label={t('partner.home.statBadge')}
                  value={
                    <StatusPill tone={BADGE_TONE[profile.verification.badge] ?? 'neutral'}>
                      {t(`partner.verification.badge.${profile.verification.badge}`)}
                    </StatusPill>
                  }
                  hint={t('partner.home.statBadgeHint', {
                    count: profile.verification.levelsPassed.length,
                  })}
                  icon={BadgeCheck}
                  tone={BADGE_TONE[profile.verification.badge] ?? 'neutral'}
                />
                <StatTile
                  label={t('partner.home.statSkills')}
                  value={profile.skills.length}
                  hint={t('partner.home.statSkillsHint', { count: profile.priceCards.length })}
                  icon={Wrench}
                  tone="brand"
                />
              </Grid>

              {/* The checklist is the point of this screen while anything is
                  missing, so it gets the wider column; the quick links keep
                  every page reachable beside it rather than below the fold. */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
                <div className="lg:col-span-2">
                  <ChecklistCard completeness={completeness} />
                </div>

                <nav
                  aria-label={t('partner.home.quickLinks')}
                  className="flex flex-col gap-3 lg:gap-4"
                >
                  <h2 className="text-sm font-semibold tracking-tight text-slate-900">
                    {t('partner.home.quickLinks')}
                  </h2>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {TILES.map((tile) => {
                      const Icon = tile.icon;
                      return (
                        <Link
                          key={tile.href}
                          to={buildLocalizedHref(locale, tile.href)}
                          className="group flex min-h-touch items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all duration-150 hover:border-slate-300 hover:shadow-md active:bg-slate-50"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10">
                            <Icon
                              className="h-[18px] w-[18px] text-brand"
                              aria-hidden="true"
                              strokeWidth={1.75}
                            />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                            {t(tile.labelKey)}
                          </span>
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-400"
                            aria-hidden="true"
                            strokeWidth={2}
                          />
                        </Link>
                      );
                    })}
                  </div>
                </nav>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
