import { useEffect } from 'react';
import { APP_NAME } from '@/brand/tokens';
import type { Locale } from '@/i18n/config';
import { absoluteUrl } from './seo';

/**
 * Applies per-route `<head>` metadata at runtime — `document.title`, the
 * description `<meta>`, canonical + hreflang `<link>` tags, and any JSON-LD
 * blocks — then restores whatever was there before on unmount/route change.
 *
 * This is the honest, client-rendered stand-in for the Next app's
 * `generateMetadata` + `<JsonLd>`, which ran server-side and were present in
 * the very first response byte. Here they land only after React has
 * mounted and this effect has run — a crawler that does not execute
 * JavaScript (still the common case) never sees any of it. Worth doing
 * anyway: several major crawlers (Googlebot chief among them) do render JS
 * before indexing, so this is not purely decorative, just not equivalent to
 * pre-rendering — see this surface's own report for the explicit
 * capability-lost statement the phase brief asked for.
 */
export function useMarketingSeo(options: {
  locale: Locale;
  pathname: string;
  title: string;
  description: string;
  jsonLd?: Record<string, unknown>[];
}) {
  const { locale, pathname, title, description, jsonLd } = options;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} · ${APP_NAME}`;

    const cleanups: (() => void)[] = [() => (document.title = previousTitle)];

    function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const existed = el !== null;
      const previousContent = el?.getAttribute('content') ?? null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
      cleanups.push(() => {
        if (!existed) {
          el?.remove();
        } else if (previousContent !== null) {
          el?.setAttribute('content', previousContent);
        }
      });
    }

    function upsertLink(rel: string, href: string, hreflang?: string) {
      const selector = hreflang
        ? `link[rel="${rel}"][hreflang="${hreflang}"]`
        : `link[rel="${rel}"]`;
      const el = document.createElement('link');
      el.setAttribute('rel', rel);
      if (hreflang) el.setAttribute('hreflang', hreflang);
      el.setAttribute('href', href);
      // Always append fresh and drop any prior tag with the same selector —
      // simpler than reconciling attrs, and there is at most one of these
      // per route anyway.
      document.head.querySelector(selector)?.remove();
      document.head.appendChild(el);
      cleanups.push(() => el.remove());
    }

    upsertMeta('name', 'description', description);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', absoluteUrl(locale, pathname));
    upsertMeta('property', 'og:site_name', APP_NAME);
    upsertMeta('property', 'og:locale', locale === 'hi' ? 'hi_IN' : 'en_IN');
    upsertMeta('name', 'twitter:card', 'summary');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);

    upsertLink('canonical', absoluteUrl(locale, pathname));
    upsertLink('alternate', absoluteUrl('hi', pathname), 'hi');
    upsertLink('alternate', absoluteUrl('en', pathname), 'en');
    upsertLink('alternate', absoluteUrl('hi', pathname), 'x-default');

    for (const [index, data] of (jsonLd ?? []).entries()) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-marketing-jsonld', String(index));
      // Safe: `data` only ever comes from this surface's own seo.ts builders,
      // assembled from category names/prices the API returned — never raw
      // user-typed markup — same reasoning as the legacy JsonLd component.
      script.textContent = JSON.stringify(data);
      document.head.appendChild(script);
      cleanups.push(() => script.remove());
    }

    return () => {
      for (const cleanup of cleanups.reverse()) cleanup();
    };
    // `jsonLd` is deliberately not a dependency: it's a fresh array/object on
    // every render (the JSON-LD builders always return new object literals),
    // and every call site's `jsonLd` content already changes in lockstep
    // with `locale`/`pathname`/`title`/`description` (the same category/
    // stats data feeds both) — keying off it too would only add a deep-
    // equality dependency for no practical benefit.
  }, [locale, pathname, title, description]);
}
