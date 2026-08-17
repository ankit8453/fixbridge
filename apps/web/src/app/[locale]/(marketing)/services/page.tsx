import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_NAME } from '@/brand/tokens';
import { DEFAULT_LOCALE, buildLocalizedHref, isSupportedLocale } from '@/i18n/config';
import { getT } from '@/i18n/get-t';
import { getCategoryTree } from '@/components/marketing/data';
import { buildMarketingMetadata } from '@/components/marketing/seo';

export const revalidate = 600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);

  return buildMarketingMetadata({
    locale,
    pathname: '/services',
    title: t('marketing.services.indexMetaTitle'),
    description: t('marketing.services.indexMetaDescription', { app: APP_NAME }),
  });
}

/**
 * The full taxonomy, one page — clusters as section headings, their leaf
 * services as pill links. Each of those links is its own indexed landing
 * page (`/services/[slug]`); this page's job is to be the hub a crawler (and
 * a human comparing options) can reach every one of them from within one hop
 * of the homepage.
 */
export default async function ServicesIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);
  const tree = await getCategoryTree(locale);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">
        {t('marketing.services.indexHeroTitle')}
      </h1>
      <p className="mt-3 text-lg text-slate-600">{t('marketing.services.indexHeroSubtitle')}</p>

      {tree && tree.length > 0 ? (
        <div className="mt-8 space-y-8">
          {tree.map((cluster) => (
            <section key={cluster.id}>
              <h2 className="text-xl font-semibold text-slate-900">
                <Link
                  href={buildLocalizedHref(locale, `/services/${cluster.slug}`)}
                  className="hover:text-brand"
                >
                  {cluster.name}
                </Link>
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {t('marketing.services.providerCountLabel', { count: cluster.providerCount })}
                </span>
              </h2>
              {cluster.children.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {cluster.children.map((leaf) => (
                    <li key={leaf.id}>
                      <Link
                        href={buildLocalizedHref(locale, `/services/${leaf.slug}`)}
                        className="flex min-h-touch items-center rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:border-brand hover:text-brand"
                      >
                        {leaf.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <p className="mt-8 text-slate-500">{t('marketing.services.indexEmpty')}</p>
      )}
    </div>
  );
}
