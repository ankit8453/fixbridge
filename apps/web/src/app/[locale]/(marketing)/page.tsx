import type { Metadata } from 'next';
import { StatTile } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { DEFAULT_LOCALE, buildLocalizedHref, isSupportedLocale } from '@/i18n/config';
import { getT } from '@/i18n/get-t';
import {
  getCategoryTree,
  getCityTrustStats,
  countLeafCategories,
} from '@/components/marketing/data';
import { buildMarketingMetadata, localBusinessJsonLd } from '@/components/marketing/seo';
import { JsonLd } from '@/components/marketing/JsonLd';
import { HowItWorksSteps } from '@/components/marketing/HowItWorks';
import { CategoryGrid } from '@/components/marketing/CategoryGrid';
import { CtaLink } from '@/components/marketing/Cta';

// ISR: the trust numbers below are live, but a customer looking for an
// electrician does not need them to be live-to-the-second — 10 minutes
// (PHASE12_PROMPT.md's own suggestion) keeps this page on the static/CDN
// path instead of hitting the API on every request.
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
    pathname: '/',
    title: t('marketing.home.metaTitle'),
    description: t('marketing.home.metaDescription', { app: APP_NAME }),
  });
}

export default async function MarketingHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);

  const [tree, stats] = await Promise.all([getCategoryTree(locale), getCityTrustStats(locale)]);

  return (
    <>
      <JsonLd
        data={localBusinessJsonLd({
          locale,
          ratingValue: stats?.averageRating?.value,
          ratingCount: stats?.averageRating?.count,
        })}
      />

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
          <HowItWorksSteps locale={locale} />
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
