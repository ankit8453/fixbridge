import type { Metadata } from 'next';
import { APP_NAME } from '@/brand/tokens';
import { DEFAULT_LOCALE, buildLocalizedHref, isSupportedLocale } from '@/i18n/config';
import { getT } from '@/i18n/get-t';
import { buildMarketingMetadata, faqJsonLd } from '@/components/marketing/seo';
import { JsonLd } from '@/components/marketing/JsonLd';
import { HowItWorksSteps } from '@/components/marketing/HowItWorks';
import { Faq, type FaqItem } from '@/components/marketing/Faq';
import { CtaLink } from '@/components/marketing/Cta';

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
    pathname: '/how-it-works',
    title: t('marketing.howItWorksPage.metaTitle', { app: APP_NAME }),
    description: t('marketing.howItWorksPage.metaDescription', { app: APP_NAME }),
  });
}

export default async function HowItWorksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);

  const faqItems: FaqItem[] = [1, 2, 3].map((n) => ({
    question: t(`marketing.howItWorksPage.faq.q${n}`),
    answer: t(`marketing.howItWorksPage.faq.a${n}`),
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <JsonLd data={faqJsonLd(faqItems)} />

      <h1 className="text-3xl font-bold text-slate-900">
        {t('marketing.howItWorksPage.heroTitle')}
      </h1>
      <p className="mt-3 text-lg text-slate-600">{t('marketing.howItWorksPage.heroSubtitle')}</p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold text-slate-900">
          {t('marketing.howItWorksPage.stepsTitle')}
        </h2>
        <div className="mt-6">
          <HowItWorksSteps locale={locale} />
        </div>
      </section>

      <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">
          {t('marketing.howItWorksPage.trustHeading')}
        </h2>
        <p className="mt-2 text-slate-600">{t('marketing.howItWorksPage.trustBody')}</p>
      </section>

      <div className="mt-8">
        <CtaLink href={buildLocalizedHref(locale, '/app')}>
          {t('marketing.howItWorksPage.ctaButton')}
        </CtaLink>
      </div>

      <Faq title={t('marketing.howItWorksPage.faqTitle')} items={faqItems} />
    </div>
  );
}
