import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { createTranslator, type Translator } from './dictionaries';
import { DEFAULT_LOCALE, type Locale } from './config';

/**
 * The active locale, derived from the URL — not a `[locale]` route param
 * (there is no server-rendered router segment here) and not a
 * `<LocaleProvider>` context (the URL already is the one source of truth,
 * see `router/locale.tsx`), just the pathname itself: `/en` or `/en/...` is
 * English, everything else is Hindi. Recomputes automatically on navigation
 * because `useLocation()` does, with no provider needed for a value the
 * router already knows.
 */
export function useLocale(): Locale {
  const { pathname } = useLocation();
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : DEFAULT_LOCALE;
}

/** `t()` for components. */
export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
