'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@fixbridge/shared';
import { useAuth } from '../../lib/auth/useAuth';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';

interface SurfaceDef {
  key: string;
  path: string;
  labelKey: string;
  /** Omitted = every signed-in user (the customer surface needs no particular role). */
  roles?: readonly Role[];
}

const SURFACES: readonly SurfaceDef[] = [
  { key: 'app', path: '/app', labelKey: 'nav.app' },
  { key: 'partner', path: '/partner', labelKey: 'nav.partner', roles: ['technician'] },
  { key: 'admin', path: '/admin', labelKey: 'nav.admin', roles: ['ops', 'admin'] },
];

/**
 * For a user holding more than one role — the very common "technician who is
 * also a customer" case the phase spec calls out — a way to jump between
 * `/app` and `/partner` (and `/admin` for ops/admin) without hunting for a
 * URL bar. Renders nothing when there is nothing to switch between: signed
 * out, or signed in with access to exactly one surface.
 */
export function SurfaceSwitcher() {
  const { status, roles } = useAuth();
  const locale = useLocale();
  const t = useT();
  const pathname = usePathname() || '/';

  if (status !== 'signedIn') return null;

  const available = SURFACES.filter(
    (surface) => !surface.roles || surface.roles.some((r) => roles.includes(r)),
  );
  if (available.length <= 1) return null;

  return (
    <nav aria-label={t('nav.switchSurface')} className="flex items-center gap-1">
      {available.map((surface) => {
        const href = buildLocalizedHref(locale, surface.path);
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={surface.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-touch items-center rounded-lg px-3 text-sm font-medium transition-colors ${
              active ? 'bg-brand text-brand-foreground' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {t(surface.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
