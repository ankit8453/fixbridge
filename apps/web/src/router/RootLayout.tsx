import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { APP_NAME, BrandStyleVars } from '../brand/tokens';
import { useLocale } from '../i18n/useT';
import { Spinner } from '../components/ui/States';

/**
 * The one wrapper every route renders inside — mounted for both the `hi`
 * (unprefixed) and `en`-prefixed route trees (see `router.tsx`'s
 * `withLocalePrefix`). Two jobs:
 *
 *  1. Keep `<html lang>` synced to the URL. Everything that needs the active
 *     locale outside a component (`i18n/locale-client.ts`'s
 *     `getClientLocale`, `index.css`'s font selection) reads this attribute
 *     rather than threading a `locale` prop everywhere — see those files.
 *  2. One `<Suspense>` boundary around `<Outlet>` for every lazily-loaded
 *     surface (`React.lazy` in `router.tsx`) — a single loading state for
 *     "the next route's code is still downloading" rather than one per
 *     route.
 */
export function RootLayout() {
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  return (
    <>
      <BrandStyleVars />
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </>
  );
}
