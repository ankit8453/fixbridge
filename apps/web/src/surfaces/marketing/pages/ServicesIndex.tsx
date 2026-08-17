import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import { getCategoryTree } from '../data';
import { useMarketingSeo } from '../useMarketingSeo';

/**
 * `/services` — the full taxonomy, one page. Ported from
 * `legacy-next-src/app/[locale]/(marketing)/services/page.tsx`. Clusters as
 * section headings, their leaf services as pill links. Each leaf link is its
 * own indexed landing page (`/services/:slug`); this page's job is to be the
 * hub a crawler (and a human comparing options) can reach every one of them
 * from within one hop of the homepage.
 *
 * Target query: "services in Jabalpur" / "जबलपुर में सेवाएं" — the hub page
 * for every category-level long-tail query below it.
 */
export default function ServicesIndex() {
  const t = useT();
  const locale = useLocale();

  const treeQuery = useQuery({
    queryKey: ['marketing', 'categoryTree', locale],
    queryFn: () => getCategoryTree(locale),
  });
  const tree = treeQuery.data ?? null;

  useMarketingSeo({
    locale,
    pathname: '/services',
    title: t('marketing.services.indexMetaTitle'),
    description: t('marketing.services.indexMetaDescription', { app: APP_NAME }),
  });

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
                  to={buildLocalizedHref(locale, `/services/${cluster.slug}`)}
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
                        to={buildLocalizedHref(locale, `/services/${leaf.slug}`)}
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
