import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { APP_NAME, BrandStyleVars } from '../brand/tokens';
import { useLocale } from '../i18n/useT';
import { buildLocalizedHref, DEFAULT_LOCALE } from '../i18n/config';
import { preferredLocale, storeLocale, urlStatesLocale } from '../i18n/preference';
import { useAuth } from '../lib/auth/useAuth';
import { Spinner } from '../components/ui/States';

/**
 * The one wrapper every route renders inside — mounted for both the `hi`
 * (unprefixed) and `en`-prefixed route trees (see `router.tsx`'s
 * `withLocalePrefix`). Three jobs:
 *
 *  1. Keep `<html lang>` synced to the URL. Everything that needs the active
 *     locale outside a component (`i18n/locale-client.ts`'s `getClientLocale`,
 *     `index.css`'s font selection) reads this attribute rather than threading
 *     a `locale` prop everywhere — see those files.
 *  2. One `<Suspense>` boundary around `<Outlet>` for every lazily-loaded
 *     surface (`React.lazy` in `router.tsx`) — a single loading state for "the
 *     next route's code is still downloading" rather than one per route.
 *  3. Send a visitor to the language they actually read — see below.
 */
export function RootLayout() {
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const { status, user } = useAuth();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  /**
   * Keep the local record in step with a signed-in user's server preference,
   * so a fresh tab on this device starts in the right language before any
   * session has been restored.
   */
  useEffect(() => {
    if (status === 'signedIn' && user?.preferredLanguage) {
      storeLocale(user.preferredLanguage);
    }
  }, [status, user?.preferredLanguage]);

  /**
   * The redirect that stops Hindi being compulsory.
   *
   * Hindi is the right default for Jabalpur, but a default is not a decision —
   * India is not monolingual, and somebody who reads English was being handed
   * Hindi on every visit. If they have expressed a preference (by toggling, or
   * on their profile) and the URL has not explicitly asked for a locale, honour
   * it.
   *
   * Guards, in order:
   *   - `urlStatesLocale` — `/en/...` is explicit and always wins. A shared
   *     link must render what it says.
   *   - `status === 'restoring'` — waiting avoids a redirect on the unresolved
   *     session followed by a second one once it lands.
   *   - `!== DEFAULT_LOCALE` — the unprefixed tree already IS Hindi, so a Hindi
   *     preference needs no navigation. Without this the effect would rewrite
   *     `/` to `/` forever.
   */
  const wanted = preferredLocale(status === 'signedIn' ? user?.preferredLanguage : null);
  const shouldRedirect =
    status !== 'restoring' && !urlStatesLocale(pathname) && wanted !== DEFAULT_LOCALE;

  if (shouldRedirect) {
    return <Navigate to={`${buildLocalizedHref(wanted, pathname)}${search}`} replace />;
  }

  return (
    <>
      <BrandStyleVars />
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </>
  );
}
