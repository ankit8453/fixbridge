import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from './config';

/**
 * Remembering which language somebody actually reads.
 *
 * Hindi is the default because Jabalpur is, and that is the right default. But
 * a default is not a decision: India is not monolingual, and a technician who
 * reads English was landing on Hindi every single visit and re-toggling every
 * time — the toggle was also missing entirely from the partner surface, so on
 * that surface there was no way to switch at all.
 *
 * Three sources, in order of authority:
 *
 *   1. **The URL.** `/en/...` means English, full stop. A shared or bookmarked
 *      link must render what it says regardless of anyone's stored preference,
 *      or the link is lying about its own content.
 *   2. **The signed-in user's `preferredLanguage`.** Set server-side when they
 *      toggle (`LocaleToggle` PATCHes `/auth/me`), so it follows them to a new
 *      device.
 *   3. **This local record.** Covers the signed-out visit and the moment
 *      before the session is restored, when the server value is not known yet.
 *
 * Deliberately NOT here: `navigator.language`. A phone sold in India commonly
 * reports `en-IN` regardless of what its owner reads, so honouring it would
 * hand English to exactly the Hindi-first audience this product is built for.
 */

const STORAGE_KEY = 'fixbridge.locale';

/**
 * The remembered choice, or null.
 *
 * Wrapped because `localStorage` throws outright in a few real contexts —
 * Safari private mode historically, and any browser set to block site data.
 * A language preference is never worth breaking a page load over.
 */
export function readStoredLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isSupportedLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignored on purpose — see readStoredLocale.
  }
}

/**
 * Where a visitor should land when they have not asked for a locale by URL.
 *
 * `serverPreference` wins over the local record because it is the one that
 * followed them from another device; the local record is the fallback for
 * before the session resolves, or when nobody is signed in.
 */
export function preferredLocale(serverPreference?: Locale | null): Locale {
  if (isSupportedLocale(serverPreference)) return serverPreference;
  return readStoredLocale() ?? DEFAULT_LOCALE;
}

/**
 * True when the URL names a locale explicitly.
 *
 * The unprefixed tree is Hindi, but it is also what somebody typing
 * `example.com/partner` gets — so "no prefix" cannot be read as "chose Hindi",
 * and a stored English preference should still be honoured there.
 */
export function urlStatesLocale(pathname: string): boolean {
  return pathname === '/en' || pathname.startsWith('/en/');
}
