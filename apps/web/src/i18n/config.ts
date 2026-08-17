import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@fixbridge/shared';

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };
export type { Locale };

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The URL for `pathname` in `locale`, matching the scheme `src/router/locale.tsx`
 * enforces: `hi` (default) is never prefixed, every other locale is. Used
 * anywhere a link has to stay in — or deliberately switch — locale: the auth
 * guards' login redirect, `LocaleToggle`, and any surface that builds its own
 * nav.
 */
export function buildLocalizedHref(locale: Locale, pathname: string): string {
  const clean = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return locale === DEFAULT_LOCALE ? clean : `/${locale}${clean}`;
}
