import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { StatTile } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import {
  findCategoryBySlug,
  getCategoryStartingPrice,
  getCategoryTree,
  type CategoryNode,
} from '../data';
import { faqJsonLd, serviceJsonLd, type FaqItem } from '../seo';
import { useMarketingSeo } from '../useMarketingSeo';
import { Faq } from '../components/Faq';
import { CtaLink } from '../components/Cta';

/**
 * `/services/:slug` — the "electrician in Jabalpur" SEO target
 * (PHASE12_PROMPT.md §A). Ported from
 * `legacy-next-src/app/[locale]/(marketing)/services/[slug]/page.tsx`.
 * Works for a cluster slug ("electrical") or a leaf slug ("house-wiring")
 * identically: `/search/providers?category_id=` already treats a cluster id
 * as "every service beneath it" (docs/API.md), so one query serves both the
 * broad, high-volume search term and the specific long-tail one.
 *
 * Target query per category, e.g. "electrician in Jabalpur" / "प्लंबर जबलपुर".
 *
 * The Next version called `notFound()` for an unknown slug, which rendered a
 * true 404 response. There is no server here to send a status code — an
 * unknown slug renders an in-page "not found" message instead (still
 * distinct from the loading state, still honest about what happened).
 */
export default function ServiceDetail() {
  const { slug = '' } = useParams<{ slug: string }>();
  const t = useT();
  const locale = useLocale();

  const treeQuery = useQuery({
    queryKey: ['marketing', 'categoryTree', locale],
    queryFn: () => getCategoryTree(locale),
  });
  const tree = treeQuery.data ?? null;
  const category: CategoryNode | null = tree ? findCategoryBySlug(tree, slug) : null;

  const priceQuery = useQuery({
    queryKey: ['marketing', 'categoryStartingPrice', locale, category?.id],
    queryFn: () => getCategoryStartingPrice(locale, category!.id),
    enabled: category !== null,
  });
  const startingPrice = priceQuery.data ?? null;

  const faqItems: FaqItem[] = category
    ? [1, 2, 3, 4].map((n) => ({
        question: t(`marketing.services.faq.q${n}`, { category: category.name }),
        answer: t(`marketing.services.faq.a${n}`, { category: category.name }),
      }))
    : [];

  useMarketingSeo({
    locale,
    pathname: `/services/${slug}`,
    title: category
      ? t('marketing.services.detailMetaTitle', { category: category.name })
      : t('marketing.services.indexHeroTitle'),
    description: category
      ? t('marketing.services.detailMetaDescription', { category: category.name, app: APP_NAME })
      : t('marketing.services.indexMetaDescription', { app: APP_NAME }),
    jsonLd: category
      ? [
          serviceJsonLd({
            locale,
            categoryName: category.name,
            pathname: `/services/${slug}`,
            startingPricePaise: startingPrice?.amountPaise ?? null,
          }),
          faqJsonLd(faqItems),
        ]
      : undefined,
  });

  // Still resolving the taxonomy — not yet known whether this slug exists.
  if (treeQuery.isLoading) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-slate-500">{t('common.loading')}</div>;
  }

  if (!category) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <a
          href={buildLocalizedHref(locale, '/services')}
          className="text-sm font-medium text-slate-500 hover:text-brand"
        >
          {t('marketing.services.detailBreadcrumbServices')}
        </a>
        <p className="mt-4 text-slate-600">{t('marketing.services.indexEmpty')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
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
