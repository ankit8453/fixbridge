'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@fixbridge/shared';
import { useAuth } from './useAuth';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';
import { Spinner } from '../../components/ui/States';

/**
 * Client-side auth guards, meant to be used inside a surface's `layout.tsx`
 * (e.g. `src/app/[locale]/partner/layout.tsx`).
 *
 * **These are UX, not the security boundary.** The API enforces every
 * permission on every request regardless of what this app renders — same
 * posture the admin console's `AuthProvider` states for its own role gate.
 * What these guards buy is not letting a signed-out visitor see a flash of
 * protected layout, or a customer see a partner-only screen full of 403s
 * before being told, in words, that they are in the wrong place. Because the
 * check is client-side (roles live only in the in-memory access token — see
 * `session.ts` for why), there is an unavoidable one-frame gap while
 * `status` is `'restoring'`; both guards render a loading state for exactly
 * that gap rather than a flash of the real content.
 */

function useRedirect(shouldRedirect: boolean, redirectTo: string): void {
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    if (shouldRedirect) router.replace(buildLocalizedHref(locale, redirectTo));
  }, [shouldRedirect, redirectTo, locale, router]);
}

export function RequireAuth({
  children,
  redirectTo = '/login',
}: {
  children: ReactNode;
  /** Locale-unprefixed pathname — `buildLocalizedHref` adds the `/en` prefix when needed. */
  redirectTo?: string;
}) {
  const { status } = useAuth();
  const t = useT();

  useRedirect(status === 'signedOut', redirectTo);

  if (status === 'restoring') return <Spinner label={t('auth.restoring')} />;
  if (status !== 'signedIn') return null; // Mid-redirect; nothing to render.

  return <>{children}</>;
}

export function RequireRole({
  role,
  children,
  redirectTo = '/login',
}: {
  role: Role | Role[];
  children: ReactNode;
  redirectTo?: string;
}) {
  const { status, roles } = useAuth();
  const t = useT();
  const allowed = Array.isArray(role) ? role : [role];
  const hasRole = roles.some((held) => allowed.includes(held));

  useRedirect(status === 'signedOut' || (status === 'signedIn' && !hasRole), redirectTo);

  if (status === 'restoring') return <Spinner label={t('auth.restoring')} />;
  if (status !== 'signedIn' || !hasRole) return null;

  return <>{children}</>;
}
