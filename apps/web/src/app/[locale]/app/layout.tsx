import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { RoleNav } from '@/components/shell/RoleNav';
import { CustomerTabBar } from '@/components/customer/shell/CustomerTabBar';
import { buildLocalizedHref, DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/config';
import { RequireAuth } from '@/lib/auth/guards';
import { hasSessionCookie } from '@/lib/auth/server-guard';

/**
 * Surface B — the customer app (PHASE12_PROMPT.md §B). `RoleNav` (top bar:
 * brand, surface switcher, locale toggle, logout) and the auth gate are the
 * foundation's; `CustomerTabBar` (bottom nav: Find/Bookings/Notifications
 * with an unread badge/Account) is this surface's own, added here because
 * every route under `app/**` needs it and a per-page repeat would be the
 * thing that drifts. `pb-16` on `main` reserves the tab bar's height so the
 * last item in a scrollable list (a booking, a notification) is never hidden
 * under it — the bar is `fixed`, so it does not push layout on its own.
 *
 * `noindex` because this whole surface is post-login and client-rendered by
 * design (SEO applies only to surface A — see the phase spec).
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CustomerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  // Fast path: no refresh cookie at all means definitely signed out — redirect
  // server-side before shipping this layout's client JS. See server-guard.ts
  // for why this does not replace the client-side RequireAuth below (it
  // cannot see roles, only "a session cookie exists").
  if (!(await hasSessionCookie())) {
    redirect(buildLocalizedHref(locale, '/login'));
  }

  return (
    <RequireAuth redirectTo="/login">
      <RoleNav />
      <main className="pb-16">{children}</main>
      <CustomerTabBar />
    </RequireAuth>
  );
}
