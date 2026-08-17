import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import { faqJsonLd, type FaqItem } from '../seo';
import { useMarketingSeo } from '../useMarketingSeo';
import { HowItWorksSteps } from '../components/HowItWorks';
import { Faq } from '../components/Faq';
import { CtaLink } from '../components/Cta';

/**
 * `/how-it-works` — ported from
 * `legacy-next-src/app/[locale]/(marketing)/how-it-works/page.tsx`.
 * Target query: "how does {{app}} work" / "{{app}} कैसे काम करता है".
 */
export default function HowItWorksPage() {
  const t = useT();
  const locale = useLocale();

  const faqItems: FaqItem[] = [1, 2, 3].map((n) => ({
    question: t(`marketing.howItWorksPage.faq.q${n}`),
    answer: t(`marketing.howItWorksPage.faq.a${n}`),
  }));

  useMarketingSeo({
    locale,
    pathname: '/how-it-works',
    title: t('marketing.howItWorksPage.metaTitle', { app: APP_NAME }),
    description: t('marketing.howItWorksPage.metaDescription', { app: APP_NAME }),
    jsonLd: [faqJsonLd(faqItems)],
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">
        {t('marketing.howItWorksPage.heroTitle')}
      </h1>
      <p className="mt-3 text-lg text-slate-600">{t('marketing.howItWorksPage.heroSubtitle')}</p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold text-slate-900">
          {t('marketing.howItWorksPage.stepsTitle')}
        </h2>
        <div className="mt-6">
          <HowItWorksSteps />
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
