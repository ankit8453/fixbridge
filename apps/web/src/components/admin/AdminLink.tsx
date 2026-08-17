'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale } from '@/i18n/useT';

/**
 * Every internal link inside `/admin`, replacing React Router's `<Link
 * to="/providers/…">` from apps/admin.
 *
 * The Phase 11 console owned the whole origin, so `to="/providers/x"` was
 * simply the URL. Ported into this app, the same route lives under a
 * `[locale]` segment (`/admin/…` when the URL has no prefix — the default,
 * rewritten `hi` locale — or `/en/admin/…`), so a bare `href="/admin/…"`
 * would silently drop whichever segment the visitor is actually on. `href`
 * here is written exactly as the Phase 11 pages wrote `to` (relative to the
 * admin root, e.g. `"/providers/x"`, or `"/"` for the root); this resolves
 * it through the same `buildLocalizedHref` every other surface's nav uses.
 */
export function AdminLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const locale = useLocale();
  const suffix = href === '/' ? '' : href;

  return (
    <Link href={buildLocalizedHref(locale, `/admin${suffix}`)} className={className}>
      {children}
    </Link>
  );
}
