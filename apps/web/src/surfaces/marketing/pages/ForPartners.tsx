import { Badge } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import { faqJsonLd, type FaqItem } from '../seo';
import { useMarketingSeo } from '../useMarketingSeo';
import { Faq } from '../components/Faq';
import { CtaLink } from '../components/Cta';

/**
 * `/for-partners` — the supply-side pitch. Ported from
 * `legacy-next-src/app/[locale]/(marketing)/for-partners/page.tsx`. The
 * commission figure (12%) and badge thresholds (SILVER: trust >= 70 + 10
 * jobs; GOLD: trust >= 85 + 30 jobs) are real numbers from docs/money.md and
 * docs/trust.md, not marketing rounding — a technician who reads this and
 * later reads their own trust breakdown in the partner app should see the
 * same figures.
 *
 * Target query: "become a technician {{app}}" / "कारीगर कैसे बनें".
 *
 * Badge tones: legacy used `good` for GOLD, this design system's `Badge`
 * vocabulary calls that tone `success` (see `components/ui/Badge.tsx`) —
 * same visual intent (a positive/achievement tone), renamed key.
 */
export default function ForPartners() {
  const t = useT();
  const locale = useLocale();
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

  useMarketingSeo({
    locale,
    pathname: '/for-partners',
    title: t('marketing.forPartners.metaTitle'),
    description: t('marketing.forPartners.metaDescription', { app: APP_NAME }),
    jsonLd: [faqJsonLd(faqItems)],
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
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
            <Badge tone="success">{t('marketing.forPartners.badgeGoldLabel')}</Badge>
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
