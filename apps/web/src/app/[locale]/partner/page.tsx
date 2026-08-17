'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { QueryState } from '@/components/ui/States';
import { ChecklistCard } from '@/components/partner/ChecklistCard';
import { fetchMyProfile } from '@/components/partner/lib/api';
import { partnerKeys } from '@/components/partner/lib/query-keys';

/**
 * The checklist home (PHASE12_PROMPT.md §C.1) — the first screen a freshly
 * registered technician sees, and the one they return to until every
 * required item is green. Once the profile is complete this is still the
 * dashboard; the checklist card just has nothing left to nag about.
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
              href={buildLocalizedHref(locale, '/partner/onboarding')}
              className="min-h-touch rounded-xl bg-brand px-4 py-3 text-center text-base font-semibold text-brand-foreground"
            >
              {profile.completeness.missingRequired.length > 0
                ? t('partner.home.completeProfile')
                : t('partner.home.editProfile')}
            </Link>
          </>
        )}
      </QueryState>

      <div className="grid grid-cols-2 gap-3">
        {[
          { href: '/partner/jobs', label: t('partner.home.tileJobs') },
          { href: '/partner/earnings', label: t('partner.home.tileEarnings') },
          { href: '/partner/trust', label: t('partner.home.tileTrust') },
          { href: '/partner/slots', label: t('partner.home.tileSlots') },
          { href: '/partner/verification', label: t('partner.home.tileVerification') },
          { href: '/partner/notifications', label: t('partner.home.tileNotifications') },
        ].map((tile) => (
          <Link
            key={tile.href}
            href={buildLocalizedHref(locale, tile.href)}
            className="flex min-h-touch items-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-800 active:bg-slate-50"
          >
            {tile.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
