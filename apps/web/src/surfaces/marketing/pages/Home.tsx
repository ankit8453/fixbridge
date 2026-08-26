import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import { getCategoryTree, getCityTrustStats, countLeafCategories } from '../data';
import { localBusinessJsonLd, faqJsonLd } from '../seo';
import { useMarketingSeo } from '../useMarketingSeo';
import { CategoryGrid } from '../components/CategoryGrid';
import { CtaLink } from '../components/Cta';
import {
  TrustBand,
  StepsRail,
  FeatureStories,
  FeatureStrip,
  AmcBand,
  PartnerBand,
  DownloadBand,
  HomeFaq,
} from '../components/HomeSections';

/**
 * `/` — the front page, and the one page that has to carry the whole pitch.
 *
 * A long scroll with a deliberate order: the promise (hero, with a real
 * photograph), the proof (live numbers), the mechanics (steps), the catalogue
 * (services), the two arguments that close a booking (locked price, verified
 * start — told as editorial rows), the second product (AMC, in its own
 * amber-on-slate identity), the supply side (partner band), the app story,
 * and the objections (FAQ, three audiences). Nothing here is filler — every
 * trust claim on this page is a description of a real product mechanism.
 *
 * Live data still comes from the API on mount; the page renders complete
 * without it and the numbers slot in when they arrive.
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
      // The customer FAQ doubles as FAQPage rich-result data — the copy
      // exists anyway, so Google may as well render it under the listing.
      faqJsonLd(
        ['c1', 'c2', 'c3', 'c4', 'c5'].map((k) => ({
          question: t(`marketing.faq2.${k}q`),
          answer: t(`marketing.faq2.${k}a`),
        })),
      ),
    ],
  });

  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-soft blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-40 h-72 w-72 rounded-full bg-amber-100/70 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-14 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:pb-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-soft px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-brand">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                <path
                  d="M12 3c-3.9 0-7 3.1-7 6.9C5 15.1 12 21 12 21s7-5.9 7-11.1C19 6.1 15.9 3 12 3z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="12" cy="9.8" r="2.3" fill="currentColor" />
              </svg>
              {t('marketing.hero2.eyebrow')}
            </p>

            <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.6rem] [text-wrap:balance]">
              {t('marketing.hero2.line1')}
              <br />
              <span className="bg-gradient-to-r from-brand via-brand-accent-alt to-brand bg-clip-text text-transparent">
                {t('marketing.hero2.line2')}
              </span>
            </h1>

            <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-600">
              {t('marketing.hero2.sub')}
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <CtaLink href={buildLocalizedHref(locale, '/app')}>
                {t('marketing.hero2.ctaBook')}
              </CtaLink>
              <CtaLink href={buildLocalizedHref(locale, '/for-partners')} variant="secondary">
                {t('marketing.hero2.ctaPartner')}
              </CtaLink>
            </div>

            {/* The three promises, stated as fact because each is a product
                mechanism, not a slogan. */}
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
              {(['chipVerified', 'chipPrice', 'chipPay'] as const).map((key) => (
                <li
                  key={key}
                  className="flex items-center gap-2 text-sm font-medium text-slate-700"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-[18px] w-[18px] shrink-0 text-brand"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                    />
                    <path
                      d="m8.5 12.2 2.4 2.4 4.6-4.8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {t(`marketing.hero2.${key}`)}
                </li>
              ))}
            </ul>
          </div>

          {/* Photo collage — a real technician at real work, with the second
              trade overlapping. Organic radii and floating badges, no frames. */}
          <div className="relative mx-auto hidden w-full max-w-[520px] lg:block">
            <span
              aria-hidden="true"
              className="absolute -inset-8 rounded-[4rem] bg-gradient-to-br from-brand-soft via-white to-amber-100 opacity-80 blur-2xl"
            />
            <img
              src="/img/marketing/hero-electrician.jpg"
              alt=""
              className="relative aspect-[4/3] w-full rounded-[2.5rem] rounded-tr-[6rem] object-cover shadow-2xl"
            />
            <img
              src="/img/marketing/plumber-sink.jpg"
              alt=""
              loading="lazy"
              className="absolute -bottom-12 -left-10 w-40 rotate-[-5deg] rounded-3xl object-cover shadow-xl ring-4 ring-white"
            />
            {/* Verified badge */}
            <span className="absolute -right-4 top-8 flex items-center gap-2.5 rounded-2xl bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path
                    d="M12 3 5 6v5c0 4.6 3 8.4 7 9.9 4-1.5 7-5.3 7-9.9V6l-7-3z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinejoin="round"
                  />
                  <path
                    d="m9 11.6 2.2 2.2L15.4 9.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="text-sm font-bold leading-tight text-slate-900">
                {t('marketing.hero2.chipVerified')}
              </span>
            </span>
            {/* Price-lock badge */}
            <span className="absolute -bottom-5 right-10 flex items-center gap-2.5 rounded-2xl bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <rect
                    x="4.5"
                    y="10"
                    width="15"
                    height="10"
                    rx="2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                  />
                  <path
                    d="M8 10V7.5a4 4 0 0 1 8 0V10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="15" r="1.6" fill="currentColor" />
                </svg>
              </span>
              <span className="text-sm font-bold leading-tight text-slate-900">
                {t('marketing.hero2.chipPrice')}
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* ---------------- Live numbers ---------------- */}
      <TrustBand stats={stats} serviceCount={tree ? countLeafCategories(tree) : null} />

      {/* ---------------- How it works ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-center text-xs font-bold uppercase tracking-[0.14em] text-brand">
          {t('marketing.steps2.eyebrow')}
        </p>
        <h2 className="mt-3 text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl [text-wrap:balance]">
          {t('marketing.steps2.title')}
        </h2>
        <div className="mt-12">
          <StepsRail />
        </div>
      </section>

      {/* ---------------- Services (live category tree) ---------------- */}
      <CategoryGrid locale={locale} tree={tree} />

      {/* ---------------- The two arguments + supporting strip ------------- */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <FeatureStories />
        <div className="mt-16 sm:mt-24">
          <FeatureStrip />
        </div>
      </section>

      {/* ---------------- AMC ---------------- */}
      <AmcBand />

      {/* ---------------- App / browser story ---------------- */}
      <DownloadBand />

      {/* ---------------- Partner recruitment ---------------- */}
      <PartnerBand />

      {/* ---------------- FAQ ---------------- */}
      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-center text-xs font-bold uppercase tracking-[0.14em] text-brand">
          {t('marketing.faq2.eyebrow')}
        </p>
        <h2 className="mt-3 text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {t('marketing.faq2.title')}
        </h2>
        <div className="mt-9">
          <HomeFaq />
        </div>
      </section>

      {/* ---------------- Final CTA ---------------- */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand via-brand-deep to-brand-accent-alt">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
            {t('marketing.finalCta2.title')}
          </h2>
          <p className="mt-4 text-white/85">{t('marketing.finalCta2.sub')}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to={buildLocalizedHref(locale, '/app')}
              className="inline-flex min-h-touch items-center rounded-full bg-white px-7 text-[15px] font-bold text-brand shadow-sm transition-transform hover:-translate-y-0.5"
            >
              {t('marketing.hero2.ctaBook')}
            </Link>
            <Link
              to={buildLocalizedHref(locale, '/for-partners')}
              className="inline-flex min-h-touch items-center rounded-full border border-white/40 px-7 text-[15px] font-bold text-white transition-colors hover:bg-white/10"
            >
              {t('marketing.hero2.ctaPartner')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
