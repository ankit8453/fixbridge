import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Briefcase, Wallet, ShieldCheck, CalendarClock, BadgeCheck, Bell } from 'lucide-react';
import { useLocale, useT } from '../../../i18n/useT';
import { buildLocalizedHref } from '../../../i18n/config';
import { QueryState } from '../../../components/ui';
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

/**
 * The checklist home — the first screen a freshly registered technician
 * sees, and the one they return to until every required item is green. Once
 * the profile is complete this is still the dashboard; the checklist card
 * just has nothing left to nag about.
 */
export default function PartnerHome() {
  const t = useT();
  const locale = useLocale();

  const profileQuery = useQuery({ queryKey: partnerKeys.profile, queryFn: fetchMyProfile });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('partner.home.title')}</h1>

      <QueryState
        status={profileQuery.status}
        error={profileQuery.error}
        data={profileQuery.data}
        onRetry={() => profileQuery.refetch()}
      >
        {({ profile }) => (
          <>
            <ChecklistCard completeness={profile.completeness} />
            <Link
              to={buildLocalizedHref(locale, '/partner/onboarding')}
              className="min-h-touch rounded-xl bg-brand px-4 py-3 text-center text-base font-semibold text-brand-foreground transition-colors duration-150 hover:opacity-90"
            >
              {profile.completeness.missingRequired.length > 0
                ? t('partner.home.completeProfile')
                : t('partner.home.editProfile')}
            </Link>
          </>
        )}
      </QueryState>

      <div className="grid grid-cols-2 gap-3">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.href}
              to={buildLocalizedHref(locale, tile.href)}
              className="flex min-h-touch items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-800 transition-colors duration-150 active:bg-slate-50"
            >
              <Icon className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" strokeWidth={1.75} />
              {t(tile.labelKey)}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
