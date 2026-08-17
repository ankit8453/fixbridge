import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@fixbridge/shared';
import { useAuth } from './useAuth';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';
import { Spinner } from '../../components/ui/States';

/**
 * Route guards. Wrap a surface's routes in one of these inside the router
 * config (see `src/router/router.tsx`) — e.g. every element under `/app/*`.
 *
 * **These are UX, not the security boundary.** The API enforces every
 * permission on every request regardless of what this app renders. What
 * these guards buy is not letting a signed-out visitor see a flash of
 * protected layout, or a technician see an ops-only screen full of 403s
 * before being told, in words, that they are in the wrong place. Because the
 * check runs client-side (roles live only in the in-memory access token —
 * see `session.ts` for why), there is an unavoidable one-frame gap while
 * `status` is `'restoring'`; both guards render a loading state for exactly
 * that gap rather than a flash of the real content.
 *
 * `<Navigate replace>` rather than an imperative `router.replace` in an
 * effect: React Router renders the redirect target directly, which avoids
 * the extra "mount this component, then immediately unmount it" tick a
 * `useEffect`-based redirect costs.
 */

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
  const locale = useLocale();

  if (status === 'restoring') return <Spinner label={t('auth.restoring')} />;
  if (status === 'signedOut')
    return <Navigate to={buildLocalizedHref(locale, redirectTo)} replace />;

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
  const locale = useLocale();
  const allowed = Array.isArray(role) ? role : [role];
  const hasRole = roles.some((held) => allowed.includes(held));

  if (status === 'restoring') return <Spinner label={t('auth.restoring')} />;
  if (status === 'signedOut' || !hasRole) {
    return <Navigate to={buildLocalizedHref(locale, redirectTo)} replace />;
  }

  return <>{children}</>;
}
