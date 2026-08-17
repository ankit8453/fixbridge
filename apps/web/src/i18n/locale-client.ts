import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from './config';

/**
 * The active locale, for call sites that are not React components.
 *
 * `src/lib/api.ts` needs to know the locale to set `Accept-Language`, but it
 * is called from event handlers, TanStack Query `queryFn`s and route-handler
 * proxies — none of which can call the `useT()` hook's `useParams()`. Rather
 * than thread a `locale` argument through every single API call site, this
 * reads `<html lang>`, which the root layout (`src/app/[locale]/layout.tsx`)
 * always sets from the same `params.locale` `useT()` uses. One source of
 * truth (the URL, via the router), two ways of reading it depending on
 * whether the caller is a component or not.
 *
 * Server-side (`typeof document === 'undefined'`) falls back to the default
 * locale — server-issued requests from this module do not currently exist,
 * but a safe default beats a crash if one is added later.
 */
export function getClientLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const lang = document.documentElement.lang;
  return isSupportedLocale(lang) ? lang : DEFAULT_LOCALE;
}
