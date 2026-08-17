import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { buildLocalizedHref, DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/config';
import { RequireRole } from '@/lib/auth/guards';
import { hasSessionCookie } from '@/lib/auth/server-guard';
import { AdminShell } from '@/components/admin/Shell';
import { ForceEnglish } from '@/components/admin/ForceEnglish';

/**
 * Surface D — the ported admin console (PHASE12_PROMPT.md §D), English-only,
 * `ops`/`admin` roles only. This does NOT render the generic `RoleNav` the
 * customer/partner surfaces use — `AdminShell` (`@/components/admin/Shell`,
 * ported from apps/admin/src/components/Layout.tsx) is this surface's own
 * purpose-built nav with ten pages of navigation, and it renders only
 * *inside* `RequireRole` below, so a non-ops/admin visitor never has it in
 * the DOM at all (not disabled, absent — the Phase 12 correction this phase
 * carries through). `noindex,nofollow` per the phase spec — an internal ops
 * tool has no business in a search index.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  if (!(await hasSessionCookie())) {
    redirect(buildLocalizedHref(locale, '/login'));
  }

  return (
    <RequireRole role={['ops', 'admin']} redirectTo="/login">
      <ForceEnglish />
      <AdminShell>{children}</AdminShell>
    </RequireRole>
  );
}
