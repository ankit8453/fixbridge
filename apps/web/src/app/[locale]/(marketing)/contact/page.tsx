import type { Metadata } from 'next';
import { DetailRow } from '@/components/ui';
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
    pathname: '/contact',
    title: t('marketing.contact.metaTitle'),
    description: t('marketing.contact.metaDescription', { app: APP_NAME }),
  });
}

/**
 * Every contact detail here is a bracketed placeholder (see marketing.*.json)
 * — WhatsApp number, support email, address — because none of it exists yet
 * outside this codebase; inventing one would be worse than an honest blank.
 * WhatsApp is listed first because it's this product's actual primary
 * channel (see the WhatsApp-first decision this app's notifications already
 * follow), not email-first the way a generic template would default to.
 */
export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{t('marketing.contact.heroTitle')}</h1>
      <p className="mt-3 text-lg text-slate-600">{t('marketing.contact.heroSubtitle')}</p>

      <dl className="mt-8">
        <DetailRow label={t('marketing.contact.whatsappTitle')}>
          {t('marketing.contact.whatsappPlaceholder')}
        </DetailRow>
        <DetailRow label={t('marketing.contact.emailTitle')}>
          {t('marketing.contact.emailPlaceholder')}
        </DetailRow>
        <DetailRow label={t('marketing.contact.hoursTitle')}>
          {t('marketing.contact.hoursValue')}
        </DetailRow>
        <DetailRow label={t('marketing.contact.addressTitle')}>
          {t('marketing.contact.addressPlaceholder')}
        </DetailRow>
      </dl>

      <p className="mt-6 text-sm text-slate-600">{t('marketing.contact.complaintNote')}</p>
    </div>
  );
}
