import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './i18n/config';

/**
 * Locale routing, hand-rolled instead of an i18n library.
 *
 * **The decision:** every page lives under `src/app/[locale]/...`, and this
 * middleware maps the public URL onto that segment.
 *   - `/en/...`            → passes through untouched; `[locale]` is `en`.
 *   - `/...` (no prefix)   → REWRITTEN (not redirected) to `/hi/...`
 *                            internally; the address bar keeps showing the
 *                            unprefixed URL. `[locale]` is `hi`.
 *   - `/hi/...` (explicit) → REDIRECTED to the unprefixed URL, so `hi` never
 *                            has two canonical addresses for the same page
 *                            (one URL per page matters for the SEO surface —
 *                            a duplicate would split its ranking signal).
 *
 * **Why a rewrite and not a redirect for the default locale:** a redirect is
 * a round trip the browser has to complete before it can even start loading
 * the real page — on 4G from a cheap phone that is real, felt latency for
 * every single first-time visitor, who by definition is hitting the
 * unprefixed URL. A rewrite costs nothing extra: Next resolves it on the
 * server before responding, so the client never sees it.
 *
 * **Why a `[locale]` segment and not next-intl or the old Pages-Router `i18n`
 * config:** the App Router removed built-in i18n routing entirely, and a
 * dedicated library is a dependency + its own middleware + its own opinions
 * on file layout for a need this app already has the primitive for (dynamic
 * segments). The alternative considered was a cookie-only locale with no URL
 * distinction at all — rejected because surface A is SEO-first and needs
 * `hreflang`-distinct URLs per locale; a cookie is invisible to a crawler.
 *
 * There is deliberately no `Accept-Language` sniffing here: the default is
 * always `hi` regardless of the visitor's browser language. Two reasons: (1)
 * it keeps every URL's content deterministic, which matters for SEO — a
 * crawler and a Hindi-reading visitor must see the same thing at `/`, or
 * indexing gets it wrong; (2) it matches the product decision (README:
 * "Hindi is the default locale") rather than guessing.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];

  if (first && (SUPPORTED_LOCALES as readonly string[]).includes(first)) {
    if (first === DEFAULT_LOCALE) {
      const rest = segments.slice(1).join('/');
      const url = request.nextUrl.clone();
      url.pathname = rest ? `/${rest}` : '/';
      return NextResponse.redirect(url);
    }
    // An explicit, non-default locale prefix (currently only /en) — already
    // matches the [locale] segment, nothing to do.
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    /*
     * Everything except: Next internals, the manifest/icons special files,
     * and anything that looks like a static asset (has a file extension).
     * Route handlers under /api are also excluded — they are not localised
     * pages, and rewriting /api/session/login to /hi/api/session/login would
     * simply 404 it.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|manifest|icons|.*\\..*).*)',
  ],
};
