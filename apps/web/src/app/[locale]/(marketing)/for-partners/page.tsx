import type { Metadata } from 'next';
import { Badge } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { DEFAULT_LOCALE, buildLocalizedHref, isSupportedLocale } from '@/i18n/config';
import { getT } from '@/i18n/get-t';
import { buildMarketingMetadata, faqJsonLd } from '@/components/marketing/seo';
import { JsonLd } from '@/components/marketing/JsonLd';
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
    pathname: '/for-partners',
    title: t('marketing.forPartners.metaTitle'),
    description: t('marketing.forPartners.metaDescription', { app: APP_NAME }),
  });
}

/**
 * The supply-side pitch (PHASE12_PROMPT.md §A). The commission figure (12%)
 * and the badge thresholds (SILVER: trust ≥ 70 + 10 jobs; GOLD: trust ≥ 85 +
 * 30 jobs) are real numbers from docs/money.md and docs/trust.md, not
 * marketing rounding — a technician who reads this and later reads their own
 * trust breakdown in the partner app should see the same figures.
 */
export default async function ForPartnersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);
  const partnerHref = buildLocalizedHref(locale, '/partner');

  const pitches = [1, 2, 3, 4].map((n) => ({
    title: t(`marketing.forPartners.pitch${n}Title`),
    desc: t(`marketing.forPartners.pitch${n}Desc`),
  }));

  const joinSteps = [1, 2, 3, 4].map((n) => ({
    title: t(`marketing.forPartners.join${n}Title`),
    desc: t(`marketing.forPartners.join${n}Desc`),
  }));

  const faqItems: FaqItem[] = [1, 2, 3].map((n) => ({
    question: t(`marketing.forPartners.faq.q${n}`),
    answer: t(`marketing.forPartners.faq.a${n}`),
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <JsonLd data={faqJsonLd(faqItems)} />

      <h1 className="text-3xl font-bold text-slate-900">{t('marketing.forPartners.heroTitle')}</h1>
      <p className="mt-3 text-lg text-slate-600">{t('marketing.forPartners.heroSubtitle')}</p>
      <div className="mt-6">
        <CtaLink href={partnerHref}>{t('marketing.forPartners.ctaButton')}</CtaLink>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {pitches.map((pitch) => (
          <div key={pitch.title} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">{pitch.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{pitch.desc}</p>
          </div>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-semibold text-slate-900">
          {t('marketing.forPartners.badgeLadderTitle')}
        </h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          <li className="rounded-xl border border-slate-200 bg-white p-4">
            <Badge tone="info">{t('marketing.forPartners.badgeVerifiedLabel')}</Badge>
            <p className="mt-2 text-sm text-slate-600">
              {t('marketing.forPartners.badgeVerifiedDesc')}
            </p>
          </li>
          <li className="rounded-xl border border-slate-200 bg-white p-4">
            <Badge tone="neutral">{t('marketing.forPartners.badgeSilverLabel')}</Badge>
            <p className="mt-2 text-sm text-slate-600">
              {t('marketing.forPartners.badgeSilverDesc')}
            </p>
          </li>
          <li className="rounded-xl border border-slate-200 bg-white p-4">
            <Badge tone="good">{t('marketing.forPartners.badgeGoldLabel')}</Badge>
            <p className="mt-2 text-sm text-slate-600">
              {t('marketing.forPartners.badgeGoldDesc')}
            </p>
          </li>
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold text-slate-900">
          {t('marketing.forPartners.howToJoinTitle')}
        </h2>
        <ol className="mt-4 space-y-3">
          {joinSteps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                {index + 1}
              </span>
              <div>
                <p className="font-semibold text-slate-900">{step.title}</p>
                <p className="text-sm text-slate-600">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-10">
        <CtaLink href={partnerHref}>{t('marketing.forPartners.ctaButton')}</CtaLink>
      </div>

      <Faq title={t('marketing.forPartners.faqTitle')} items={faqItems} />
    </div>
  );
}
