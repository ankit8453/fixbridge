import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from './config';

/**
 * The active locale, for call sites that are not React components.
 *
 * `src/lib/api.ts` needs to know the locale to set `Accept-Language`, but it
 * is called from event handlers and TanStack Query `queryFn`s, neither of
 * which can call the `useT()` hook's `useLocation()`. Rather than thread a
 * `locale` argument through every single API call site, this reads
 * `<html lang>`, which `RootLayout` always sets from the same URL `useT()`
 * reads (see `useT.ts`). One source of truth (the URL, via the router), two
 * ways of reading it depending on whether the caller is a component or not.
 */
export function getClientLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const lang = document.documentElement.lang;
  return isSupportedLocale(lang) ? lang : DEFAULT_LOCALE;
}
