import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PartnerShell } from '@/components/partner/PartnerShell';
import { buildLocalizedHref, DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/config';
import { RequireAuth } from '@/lib/auth/guards';
import { hasSessionCookie } from '@/lib/auth/server-guard';

/**
 * Surface C — the partner (technician) app (PHASE12_PROMPT.md §C),
 * mobile-browser-first.
 *
 * Gated on **any signed-in user**, not `RequireRole('technician')`: a
 * customer with no provider registration must still be able to reach
 * `/partner` and see the "become a partner" pitch (`POST
 * /providers/me/register` — docs/API.md, "any authenticated user, not just
 * technicians"). `PartnerShell` does the role branching client-side, because
 * roles live only in the in-memory access token this server layout never
 * sees (`lib/auth/server-guard.ts`).
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PartnerLayout({
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
    <RequireAuth redirectTo="/login">
      <PartnerShell>{children}</PartnerShell>
    </RequireAuth>
  );
}
