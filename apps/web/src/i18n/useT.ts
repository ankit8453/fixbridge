'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createTranslator, type Translator } from './dictionaries';
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from './config';

/**
 * The active locale, for client components.
 *
 * Reads it from the route's `[locale]` segment via `useParams()` rather than
 * a React context provider — every page already lives under
 * `src/app/[locale]/...`, so the value is already there for free, and it
 * updates automatically on navigation between `/` and `/en/...` with no
 * `<LocaleProvider>` needed for a value the router already knows. Falls back
 * to `hi` if the segment is ever missing or malformed (should not happen —
 * `src/middleware.ts` only ever produces `hi`/`en` — but a hook that throws
 * on a bad param is a worse failure mode than one that assumes the default).
 */
export function useLocale(): Locale {
  const params = useParams<{ locale?: string }>();
  return isSupportedLocale(params?.locale) ? params.locale : DEFAULT_LOCALE;
}

/** `t()` for client components — see `../i18n/get-t.ts` for the server equivalent. */
export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}
