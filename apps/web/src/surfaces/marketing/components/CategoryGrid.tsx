import { Link } from 'react-router-dom';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import { useT } from '@/i18n/useT';
import { CategoryIcon, themeFor } from '@/surfaces/customer/components/find/CategoryIcon';
import type { CategoryNode } from '../data';

/**
 * The homepage's category row — clusters only (leaves live one level down,
 * on `/services` and their own `/services/:slug`). `providerCount` on a
 * cluster is already the sum of its children's counts (see apps/api's
 * `categories/service.ts`), so this needs no extra request beyond the one
 * `getCategoryTree` call the homepage already makes.
 *
 * Restyled away from bordered tiles: each category is an open block — its
 * own coloured gradient disc (reusing the customer app's per-category icon
 * + theme, so the marketing site and the storefront agree on what
 * "electrical" looks like), name, live count. Colour is the differentiator,
 * not borders.
 */
export function CategoryGrid({ locale, tree }: { locale: Locale; tree: CategoryNode[] | null }) {
  const t = useT();

  return (
    <section className="bg-gradient-to-b from-white via-brand-soft/40 to-white">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl [text-wrap:balance]">
          {t('marketing.home.categoriesTitle')}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-slate-600">
          {t('marketing.home.categoriesSubtitle')}
        </p>

        {tree && tree.length > 0 ? (
          <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
            {tree.map((cluster) => {
              const theme = themeFor(cluster.slug);
              return (
                <Link
                  key={cluster.id}
                  to={buildLocalizedHref(locale, `/services/${cluster.slug}`)}
                  className="group flex min-h-touch flex-col items-center text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <span className="relative">
                    <span
                      aria-hidden="true"
                      className={`absolute -inset-3 rounded-full ${theme.glow} opacity-0 blur-xl transition-opacity group-hover:opacity-100`}
                    />
                    <span
                      className={`relative flex h-20 w-20 items-center justify-center rounded-[2rem] text-white shadow-lg transition-transform group-hover:-translate-y-1 group-hover:rotate-3 ${theme.icon}`}
                    >
                      <CategoryIcon slug={cluster.slug} className="h-9 w-9" />
                    </span>
                  </span>
                  <span className="mt-4 block text-base font-bold tracking-tight text-slate-900 group-hover:text-brand">
                    {cluster.name}
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-500">
                    {t('marketing.services.providerCountLabel', { count: cluster.providerCount })}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="mt-10 text-center text-slate-500">{t('marketing.home.categoriesEmpty')}</p>
        )}

        <div className="mt-12 text-center">
          <Link
            to={buildLocalizedHref(locale, '/services')}
            className="inline-flex min-h-touch items-center gap-2 text-[15px] font-bold text-brand hover:underline"
          >
            {t('marketing.home.categoriesCta')}
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
              <path
                d="M4 12h15m0 0-6-6m6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
