import Link from 'next/link';
import { getT } from '@/i18n/get-t';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import type { CategoryNode } from './data';

/**
 * The homepage's category grid — clusters only (leaves live one level down,
 * on `/services` and their own `/services/[slug]`). `providerCount` on a
 * cluster is already the sum of its children's counts (see
 * apps/api's `categories/service.ts` `buildCategoryTree`), so this needs no
 * extra request beyond the one `getCategoryTree` call the homepage already
 * makes.
 */
export function CategoryGrid({ locale, tree }: { locale: Locale; tree: CategoryNode[] | null }) {
  const t = getT(locale);

  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      <h2 className="text-center text-2xl font-semibold text-slate-900">
        {t('marketing.home.categoriesTitle')}
      </h2>
      <p className="mt-2 text-center text-slate-600">{t('marketing.home.categoriesSubtitle')}</p>

      {tree && tree.length > 0 ? (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tree.map((cluster) => (
            <Link
              key={cluster.id}
              href={buildLocalizedHref(locale, `/services/${cluster.slug}`)}
              className="block min-h-touch rounded-xl border border-slate-200 bg-white p-4 text-center transition-colors hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="block text-base font-semibold text-slate-900">{cluster.name}</span>
              <span className="mt-1 block text-sm text-slate-500">
                {t('marketing.services.providerCountLabel', { count: cluster.providerCount })}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-8 text-center text-slate-500">{t('marketing.home.categoriesEmpty')}</p>
      )}

      <div className="mt-8 text-center">
        <Link
          href={buildLocalizedHref(locale, '/services')}
          className="inline-flex min-h-touch items-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
        >
          {t('marketing.home.categoriesCta')}
        </Link>
      </div>
    </section>
  );
}
