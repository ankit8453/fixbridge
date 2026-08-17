import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StatTile } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  buildLocalizedHref,
  isSupportedLocale,
  type Locale,
} from '@/i18n/config';
import { getT } from '@/i18n/get-t';
import {
  findCategoryBySlug,
  flattenCategories,
  getCategoryStartingPrice,
  getCategoryTree,
  type CategoryNode,
} from '@/components/marketing/data';
import { buildMarketingMetadata, faqJsonLd, serviceJsonLd } from '@/components/marketing/seo';
import { JsonLd } from '@/components/marketing/JsonLd';
import { Faq, type FaqItem } from '@/components/marketing/Faq';
import { CtaLink } from '@/components/marketing/Cta';

export const revalidate = 600;

// A category minted after the last build (or a slug requested before the API
// was reachable at build time — see generateStaticParams below) still
// renders correctly on its first request and is cached from then on, instead
// of 404ing until the next full build.
export const dynamicParams = true;

export async function generateStaticParams(): Promise<{ locale: string; slug: string }[]> {
  const params: { locale: string; slug: string }[] = [];

  for (const locale of SUPPORTED_LOCALES) {
    const tree = await getCategoryTree(locale);
    // API unreachable at build time: skip pre-generation for this locale
    // rather than failing the whole build — `dynamicParams` above means every
    // slug still renders on first request once the API is up.
    if (!tree) continue;

    for (const category of flattenCategories(tree)) {
      params.push({ locale, slug: category.slug });
    }
  }

  return params;
}

async function loadCategory(locale: Locale, slug: string): Promise<CategoryNode | null> {
  const tree = await getCategoryTree(locale);
  if (!tree) return null;
  return findCategoryBySlug(tree, slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);
  const category = await loadCategory(locale, slug);

  if (!category) {
    return buildMarketingMetadata({
      locale,
      pathname: `/services/${slug}`,
      title: t('marketing.services.indexHeroTitle'),
      description: t('marketing.services.indexMetaDescription', { app: APP_NAME }),
    });
  }

  return buildMarketingMetadata({
    locale,
    pathname: `/services/${slug}`,
    title: t('marketing.services.detailMetaTitle', { category: category.name }),
    description: t('marketing.services.detailMetaDescription', {
      category: category.name,
      app: APP_NAME,
    }),
  });
}

/**
 * The "electrician in Jabalpur" SEO target (PHASE12_PROMPT.md §A).
 *
 * Works for a cluster slug ("electrical") or a leaf slug ("house-wiring")
 * identically: `/search/providers?category_id=` already treats a cluster id
 * as "every service beneath it" (docs/API.md), so one query serves both the
 * broad, high-volume search term and the specific long-tail one.
 */
export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);

  const category = await loadCategory(locale, slug);
  if (!category) notFound();

  const startingPrice = await getCategoryStartingPrice(locale, category.id);

  const faqItems: FaqItem[] = [1, 2, 3, 4].map((n) => ({
    question: t(`marketing.services.faq.q${n}`, { category: category.name }),
    answer: t(`marketing.services.faq.a${n}`, { category: category.name }),
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={serviceJsonLd({
          locale,
          categoryName: category.name,
          pathname: `/services/${slug}`,
          startingPricePaise: startingPrice?.amountPaise ?? null,
        })}
      />
      <JsonLd data={faqJsonLd(faqItems)} />

      <a
        href={buildLocalizedHref(locale, '/services')}
        className="text-sm font-medium text-slate-500 hover:text-brand"
      >
        {t('marketing.services.detailBreadcrumbServices')}
      </a>
      <h1 className="mt-1 text-3xl font-bold text-slate-900">{category.name}</h1>
      <p className="mt-4 text-lg text-slate-600">
        {t('marketing.services.detailIntro', { category: category.name })}
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <StatTile
          label={t('marketing.services.detailStartingPriceLabel')}
          value={
            startingPrice
              ? startingPrice.display
              : t('marketing.services.detailStartingPriceUnknown')
          }
        />
        <StatTile
          label={t('marketing.services.detailProviderCountLabel')}
          value={category.providerCount}
          hint={
            category.providerCount === 0 ? t('marketing.services.detailNoProviders') : undefined
          }
        />
      </div>

      <div className="mt-8">
        <CtaLink href={buildLocalizedHref(locale, '/app')}>
          {t('marketing.services.detailBookCta')}
        </CtaLink>
      </div>

      <Faq title={t('marketing.services.detailFaqTitle')} items={faqItems} />
    </div>
  );
}
