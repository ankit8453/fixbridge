import type { Metadata } from 'next';
import { APP_NAME } from '@/brand/tokens';
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/config';
import { getT } from '@/i18n/get-t';
import { buildMarketingMetadata } from '@/components/marketing/seo';

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
    pathname: '/terms',
    title: t('marketing.terms.metaTitle'),
    description: t('marketing.terms.metaDescription', { app: APP_NAME }),
  });
}

/** Same "honest v1, pending legal review" approach as /privacy — see that page's comment. */
const SECTIONS = [
  'eligibility',
  'account',
  'booking',
  'payments',
  'cancellation',
  'conduct',
  'liability',
  'disputes',
  'termination',
  'changes',
  'contact',
] as const;

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{t('marketing.terms.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('marketing.terms.updated')}</p>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t('marketing.terms.draftNotice')}
      </p>
      <p className="mt-4 text-slate-700">{t('marketing.terms.intro', { app: APP_NAME })}</p>

      <div className="mt-8 space-y-8">
        {SECTIONS.map((section) => (
          <section key={section}>
            <h2 className="text-xl font-semibold text-slate-900">
              {t(`marketing.terms.${section}Heading`)}
            </h2>
            <p className="mt-2 whitespace-pre-line text-slate-700">
              {t(`marketing.terms.${section}Body`, { app: APP_NAME })}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
