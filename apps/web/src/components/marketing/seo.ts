import type { Metadata } from 'next';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref, DEFAULT_LOCALE, type Locale } from '@/i18n/config';

/**
 * Base URL for absolute links this app has to hand a crawler or a social
 * scraper (canonical/hreflang, OpenGraph, sitemap.xml, robots.txt). Falls
 * back to the local dev origin rather than throwing, because a marketing
 * page rendering with a `localhost` canonical in dev is a lesser problem than
 * every one of these pages crashing without `NEXT_PUBLIC_SITE_URL` set — set
 * it in the Vercel project once the domain is known (see docs/web.md).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);

export function absoluteUrl(locale: Locale, pathname: string): string {
  return `${SITE_URL}${buildLocalizedHref(locale, pathname)}`;
}

/**
 * One metadata builder for every marketing route.
 *
 * `alternates.languages` always lists both locales plus `x-default` pointing
 * at `hi` — the middleware's own default (src/middleware.ts) — so a crawler
 * never has to guess which URL is canonical for an unprefixed visit. `title`
 * is deliberately just the page-specific fragment: the root layout
 * (`src/app/[locale]/layout.tsx`) already sets `title.template` to append
 * " · {{APP_NAME}}", and repeating it here would double it up.
 */
export function buildMarketingMetadata({
  locale,
  pathname,
  title,
  description,
}: {
  locale: Locale;
  pathname: string;
  title: string;
  description: string;
}): Metadata {
  const url = absoluteUrl(locale, pathname);

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        hi: absoluteUrl('hi', pathname),
        en: absoluteUrl('en', pathname),
        'x-default': absoluteUrl(DEFAULT_LOCALE, pathname),
      },
    },
    openGraph: {
      title,
      description,
      url,
      siteName: APP_NAME,
      locale: locale === 'hi' ? 'hi_IN' : 'en_IN',
      type: 'website',
      // The PWA icon (public/icons/), not a dedicated OG asset — the brand is
      // genuinely undecided (see src/brand/tokens.ts), and generating a
      // bespoke share image for an unset brand would need redoing the moment
      // one is picked. Good enough for a social preview until then.
      images: [{ url: absoluteUrl(locale, '/icons/icon-512.png') }],
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
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

/** `Service` JSON-LD for a `/services/[slug]` page — the other required schema. */
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
