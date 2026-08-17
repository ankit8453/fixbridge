import type { MetadataRoute } from 'next';
import { SUPPORTED_LOCALES } from '@/i18n/config';
import { absoluteUrl } from '@/components/marketing/seo';
import { flattenCategories, getCategoryTree } from '@/components/marketing/data';

// Same cadence as the pages themselves (see (marketing)/page.tsx) — a
// sitemap that only updates once a build is a stale hint to crawlers about
// content (category listings) that changes without a redeploy.
export const revalidate = 600;

const STATIC_ROUTES = [
  { path: '/', changeFrequency: 'daily' as const, priority: 1 },
  { path: '/services', changeFrequency: 'weekly' as const, priority: 0.9 },
  { path: '/how-it-works', changeFrequency: 'monthly' as const, priority: 0.6 },
  { path: '/for-partners', changeFrequency: 'monthly' as const, priority: 0.6 },
  { path: '/download', changeFrequency: 'monthly' as const, priority: 0.4 },
  { path: '/contact', changeFrequency: 'monthly' as const, priority: 0.4 },
  { path: '/privacy', changeFrequency: 'yearly' as const, priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly' as const, priority: 0.2 },
];

/**
 * Every indexed URL, in both locales (PHASE12_PROMPT.md: "sitemap.xml,
 * hreflang hi/en"). Surface B/C/D routes are deliberately absent — they are
 * `noindex` (see their own layouts' `metadata.robots`), and listing a
 * noindexed URL in a sitemap is a contradictory signal search engines
 * explicitly warn against.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  const now = new Date();

  for (const route of STATIC_ROUTES) {
    for (const locale of SUPPORTED_LOCALES) {
      entries.push({
        url: absoluteUrl(locale, route.path),
        lastModified: now,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
      });
    }
  }

  // Category landing pages — the actual "electrician in Jabalpur" SEO
  // surface. Sourced from the same live category tree the pages themselves
  // render from (components/marketing/data.ts); if the API is unreachable
  // this just omits them rather than failing the whole sitemap.
  const tree = await getCategoryTree('hi');
  if (tree) {
    for (const category of flattenCategories(tree)) {
      for (const locale of SUPPORTED_LOCALES) {
        entries.push({
          url: absoluteUrl(locale, `/services/${category.slug}`),
          lastModified: now,
          changeFrequency: 'weekly',
          priority: 0.8,
        });
      }
    }
  }

  return entries;
}
