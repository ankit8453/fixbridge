import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref, DEFAULT_LOCALE, type Locale } from '@/i18n/config';

/**
 * Runtime SEO for a client-rendered marketing surface — the honest
 * replacement for `legacy-next-src/components/marketing/seo.ts`'s
 * `generateMetadata`/`<Metadata>` export.
 *
 * The Next version ran this at build/request time and shipped fully-formed
 * `<head>` markup in the first byte a crawler saw. This SPA has no server:
 * every function here runs in the browser, after `main.tsx` has already
 * mounted, so a crawler that does not execute JavaScript sees none of it —
 * see this surface's own report for the explicit "what SEO capability is
 * lost" statement. `useMarketingSeo` (this file's sibling) is what actually
 * wires these builders into `<head>` at runtime for the crawlers that do.
 */

/**
 * `window.location.origin` rather than a build-time env var — there is no
 * `NEXT_PUBLIC_SITE_URL` equivalent needed once this only ever runs in a
 * browser that already knows its own origin, and a client-rendered page has
 * no "wrong" origin to guard against the way a server render building an
 * absolute URL from an unset env var would.
 */
export function siteOrigin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

export function absoluteUrl(locale: Locale, pathname: string): string {
  return `${siteOrigin()}${buildLocalizedHref(locale, pathname)}`;
}

export interface MarketingMeta {
  pathname: string;
  title: string;
  description: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * `LocalBusiness` JSON-LD, rendered once on the homepage (PHASE12_PROMPT.md's
 * required schema, alongside `Service`).
 *
 * `aggregateRating` is only included when `getCityTrustStats` actually found
 * rated technicians — an `AggregateRating` with a fabricated count is exactly
 * the kind of structured-data spam Google's own guidelines call out, and this
 * app has a real number to use when there is one.
 */
export function localBusinessJsonLd(options: {
  locale: Locale;
  ratingValue?: number;
  ratingCount?: number;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: APP_NAME,
    url: absoluteUrl(options.locale, '/'),
    image: absoluteUrl(options.locale, '/icons/icon-512.png'),
    areaServed: { '@type': 'City', name: 'Jabalpur' },
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Jabalpur',
      addressRegion: 'Madhya Pradesh',
      addressCountry: 'IN',
    },
  };

  if (options.ratingValue !== undefined && options.ratingCount) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: options.ratingValue.toFixed(1),
      reviewCount: options.ratingCount,
    };
  }

  return data;
}

/** `Service` JSON-LD for a `/services/:slug` page — the other required schema. */
export function serviceJsonLd(options: {
  locale: Locale;
  categoryName: string;
  pathname: string;
  startingPricePaise: number | null;
}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: options.categoryName,
    name: options.categoryName,
    url: absoluteUrl(options.locale, options.pathname),
    areaServed: { '@type': 'City', name: 'Jabalpur' },
    provider: { '@type': 'LocalBusiness', name: APP_NAME, url: absoluteUrl(options.locale, '/') },
  };

  if (options.startingPricePaise !== null) {
    data.offers = {
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: (options.startingPricePaise / 100).toFixed(2),
    };
  }

  return data;
}

/** `FAQPage` JSON-LD — not one of the two required schemas, but a direct match for the phase spec's "FAQ block" and cheap to add correctly once the copy exists anyway. */
export function faqJsonLd(items: FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export { DEFAULT_LOCALE };
