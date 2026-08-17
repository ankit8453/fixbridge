'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';

const TABS = [
  { path: '/partner', labelKey: 'partner.nav.home' },
  { path: '/partner/jobs', labelKey: 'partner.nav.jobs' },
  { path: '/partner/earnings', labelKey: 'partner.nav.earnings' },
  { path: '/partner/trust', labelKey: 'partner.nav.trust' },
  { path: '/partner/slots', labelKey: 'partner.nav.slots' },
] as const;

/**
 * A bottom tab bar, not a header menu.
 *
 * The whole brief for this surface is one-handed use on a cheap phone — a
 * thumb rests naturally near the bottom of the screen, not the top, so the
 * five places a technician needs most (home, jobs, money, trust, hours) live
 * there instead of behind `RoleNav`'s top-bar links, which stay for the
 * surface switcher and logout only.
 */
export function PartnerTabBar() {
  const locale = useLocale();
  const t = useT();
  const pathname = usePathname() || '/';

  return (
    <nav
      aria-label={t('partner.nav.label')}
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white"
    >
      {TABS.map((tab) => {
        const href = buildLocalizedHref(locale, tab.path);
        const active =
          tab.path === '/partner'
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={tab.path}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium ${
              active ? 'text-brand' : 'text-slate-500'
            }`}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
