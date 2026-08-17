import type { Metadata } from 'next';
import { Badge, Card } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { DEFAULT_LOCALE, buildLocalizedHref, isSupportedLocale } from '@/i18n/config';
import { getT } from '@/i18n/get-t';
import { buildMarketingMetadata } from '@/components/marketing/seo';
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
    pathname: '/download',
    title: t('marketing.download.metaTitle'),
    description: t('marketing.download.metaDescription', { app: APP_NAME }),
  });
}

/**
 * Placeholder cards, structure and copy final now (PHASE12_PROMPT.md §A) —
 * the APKs themselves are Phase 13 (customer, Flutter) and Phase 14
 * (partner). Each card's CTA already routes to the real web surface it will
 * eventually stand next to, so this page is genuinely useful today rather
 * than a dead end while the native apps don't exist yet.
 */
export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{t('marketing.download.heroTitle')}</h1>
      <p className="mt-3 text-lg text-slate-600">{t('marketing.download.heroSubtitle')}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card
          title={t('marketing.download.customerCardTitle')}
          actions={<Badge tone="warn">{t('marketing.download.statusComingSoon')}</Badge>}
        >
          <p className="text-sm text-slate-600">{t('marketing.download.customerCardDesc')}</p>
          <div className="mt-4">
            <CtaLink href={buildLocalizedHref(locale, '/app')} variant="secondary">
              {t('marketing.download.useWebInstead')}
            </CtaLink>
          </div>
        </Card>

        <Card
          title={t('marketing.download.partnerCardTitle')}
          actions={<Badge tone="warn">{t('marketing.download.statusComingSoon')}</Badge>}
        >
          <p className="text-sm text-slate-600">{t('marketing.download.partnerCardDesc')}</p>
          <div className="mt-4">
            <CtaLink href={buildLocalizedHref(locale, '/partner')} variant="secondary">
              {t('marketing.download.useWebInstead')}
            </CtaLink>
          </div>
        </Card>
      </div>

      <p className="mt-8 text-sm text-slate-500">{t('marketing.download.webFallbackNote')}</p>
    </div>
  );
}
