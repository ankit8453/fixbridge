import { useQuery } from '@tanstack/react-query';
import { StatTile } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import { getCategoryTree, getCityTrustStats, countLeafCategories } from '../data';
import { localBusinessJsonLd } from '../seo';
import { useMarketingSeo } from '../useMarketingSeo';
import { HowItWorksSteps } from '../components/HowItWorks';
import { CategoryGrid } from '../components/CategoryGrid';
import { CtaLink } from '../components/Cta';

/**
 * `/` — the homepage. Ported from
 * `legacy-next-src/app/[locale]/(marketing)/page.tsx`. The Next version used
 * ISR (`revalidate = 600`) to keep the live trust numbers on a static/CDN
 * path; there is no server here to revalidate, so this simply fetches on
 * mount via TanStack Query, which already caches for 10s (`createQueryClient`)
 * and does not refetch on window focus — close enough to "not live to the
 * second" for a homepage stat without inventing a caching layer.
 */
export default function Home() {
  const t = useT();
  const locale = useLocale();

  const treeQuery = useQuery({
    queryKey: ['marketing', 'categoryTree', locale],
    queryFn: () => getCategoryTree(locale),
  });
  const statsQuery = useQuery({
    queryKey: ['marketing', 'cityTrustStats', locale],
    queryFn: () => getCityTrustStats(locale),
  });

  const tree = treeQuery.data ?? null;
  const stats = statsQuery.data ?? null;

  useMarketingSeo({
    locale,
    pathname: '/',
    title: t('marketing.home.metaTitle'),
    description: t('marketing.home.metaDescription', { app: APP_NAME }),
    jsonLd: [
      localBusinessJsonLd({
        locale,
        ratingValue: stats?.averageRating?.value,
        ratingCount: stats?.averageRating?.count,
      }),
    ],
  });

  return (
    <>
      <section className="mx-auto max-w-5xl px-4 pb-8 pt-10 text-center sm:pt-16">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">
          {t('marketing.home.heroKicker')}
        </p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
          {t('marketing.home.heroTitle', { app: APP_NAME })}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
          {t('marketing.home.heroSubtitle')}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <CtaLink href={buildLocalizedHref(locale, '/app')}>
            {t('marketing.home.heroCtaPrimary')}
          </CtaLink>
          <CtaLink href={buildLocalizedHref(locale, '/for-partners')} variant="secondary">
            {t('marketing.home.heroCtaSecondary')}
          </CtaLink>
        </div>
      </section>

      {stats || tree ? (
        <section className="mx-auto grid max-w-5xl grid-cols-2 gap-3 px-4 pb-10 sm:grid-cols-3">
          {stats ? (
            <StatTile
              label={t('marketing.home.trustVerified')}
              value={stats.verifiedTechnicianCount}
            />
          ) : null}
          {tree ? (
            <StatTile
              label={t('marketing.home.trustCategories')}
              value={countLeafCategories(tree)}
            />
          ) : null}
          {stats?.averageRating ? (
            <StatTile
              label={t('marketing.home.trustRating')}
              value={`${stats.averageRating.value.toFixed(1)} / 5`}
              hint={t('marketing.home.trustRatingHint', { count: stats.averageRating.count })}
            />
          ) : null}
        </section>
      ) : null}

      <section className="mx-auto max-w-5xl px-4 py-10">
        <h2 className="text-center text-2xl font-semibold text-slate-900">
          {t('marketing.home.howTitle')}
        </h2>
        <p className="mt-2 text-center text-slate-600">{t('marketing.home.howSubtitle')}</p>
        <div className="mt-8">
          <HowItWorksSteps />
        </div>
      </section>

      <CategoryGrid locale={locale} tree={tree} />

      <section className="bg-slate-50 px-4 py-12 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">
          {t('marketing.home.finalCtaTitle')}
        </h2>
        <p className="mt-2 text-slate-600">{t('marketing.home.finalCtaSubtitle')}</p>
        <div className="mt-5">
          <CtaLink href={buildLocalizedHref(locale, '/app')}>
            {t('marketing.home.finalCtaButton')}
          </CtaLink>
        </div>
      </section>
    </>
  );
}
