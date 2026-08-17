'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from '@/i18n/useT';

/**
 * Keeps `/admin` on the `en` locale segment, always.
 *
 * apps/admin/README.md's "English only" decision has to survive the move
 * into a Hindi-first, `[locale]`-routed app: the shared UI primitives this
 * surface reuses (`Pagination`, `Spinner`, `EmptyState`, `ErrorState` in
 * `@/components/ui`) call `useT()`, which reads its strings from whatever
 * `[locale]` segment the URL is on — and the *default* way to reach any
 * route in this app is the unprefixed URL, which resolves to `hi`
 * (`src/middleware.ts`). Left alone, an ops user who followed a bare
 * `/admin` link (the overwhelming majority of internal links, bookmarks and
 * chat-pasted URLs — see AdminLink) would see a queue screen rendered half
 * in Hindi.
 *
 * Rather than duplicate every shared primitive with hardcoded English
 * strings — the alternative the phase spec's "prefer the web app's
 * primitives" guidance argues against — this leans on the locale mechanism
 * the foundation already ships: `/en/…` is a fully supported, real route.
 * A signed-in ops/admin user on any other segment is bounced there once,
 * client-side (a layout has no reliable way to read the full pathname
 * server-side without touching `middleware.ts`, which is out of this
 * surface's lane). The bounce is invisible in practice — it lands inside
 * the same `RequireRole` loading gap `AdminLayout` already renders a
 * spinner for, so there is no extra flash of un-Englished content.
 */
export function ForceEnglish() {
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (locale === 'en') return;

    const qs = searchParams.toString();
    router.replace(`/en${pathname}${qs ? `?${qs}` : ''}`);
  }, [locale, pathname, searchParams, router]);

  return null;
}
