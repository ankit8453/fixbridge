import { Link } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import { useT } from '@/i18n/useT';
import type { CategoryNode } from '../data';

/**
 * The homepage's category grid — clusters only (leaves live one level down,
 * on `/services` and their own `/services/:slug`). Ported from
 * `legacy-next-src/components/marketing/CategoryGrid.tsx`. `providerCount`
 * on a cluster is already the sum of its children's counts (see
 * apps/api's `categories/service.ts`), so this needs no extra request beyond
 * the one `getCategoryTree` call the homepage already makes.
 *
 * A generic wrench icon per tile, not one keyed off the API's `icon` string
 * — that field names an icon system the old Next app never actually wired
 * up either (see the legacy component: it renders no icon at all), and
 * inventing a slug→lucide-icon mapping here would be a business decision
 * this port isn't positioned to make silently.
 */
export function CategoryGrid({ locale, tree }: { locale: Locale; tree: CategoryNode[] | null }) {
  const t = useT();

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
              to={buildLocalizedHref(locale, `/services/${cluster.slug}`)}
              className="group block min-h-touch rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {/* `bg-slate-100` rather than `bg-brand/10` — `--color-brand-primary`
                  is a raw hex custom property (see tailwind.config.ts), which
                  Tailwind's `/opacity` shorthand cannot tint correctly. */}
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-brand transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
                <Wrench className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
              </span>
              <span className="mt-3 block text-base font-semibold text-slate-900">
                {cluster.name}
              </span>
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
          to={buildLocalizedHref(locale, '/services')}
          className="inline-flex min-h-touch items-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
        >
          {t('marketing.home.categoriesCta')}
        </Link>
      </div>
    </section>
  );
}
