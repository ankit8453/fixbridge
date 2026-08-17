import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/components/marketing/seo';

/**
 * Belt-and-braces alongside the `noindex,nofollow` metadata each of
 * surfaces B/C/D's own layouts already set (PHASE12_PROMPT.md: "SEO applies
 * ONLY to surface A"). A meta tag only stops indexing once a crawler has
 * already fetched the page; disallowing the path here stops the fetch in the
 * first place, which matters more for `/app` and `/partner` — both hold
 * account data behind a client-side auth redirect, not content a crawler
 * should spend budget on regardless of indexing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/app/',
          '/en/app/',
          '/partner/',
          '/en/partner/',
          '/admin/',
          '/en/admin/',
          '/api/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
