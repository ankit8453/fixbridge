import { DetailRow } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { useLocale, useT } from '@/i18n/useT';
import { OPERATOR } from '../operator';
import { useMarketingSeo } from '../useMarketingSeo';

/**
 * `/contact` — WhatsApp first, because that is this product's actual primary
 * channel. Every detail comes from `operator.ts`, the same source the legal
 * pages use, so the contact page and the terms can never disagree.
 */
export default function Contact() {
  const t = useT();
  const locale = useLocale();

  useMarketingSeo({
    locale,
    pathname: '/contact',
    title: t('marketing.contact.metaTitle'),
    description: t('marketing.contact.metaDescription', { app: APP_NAME }),
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{t('marketing.contact.heroTitle')}</h1>
      <p className="mt-3 text-lg text-slate-600">{t('marketing.contact.heroSubtitle')}</p>

      <dl className="mt-8">
        <DetailRow label={t('marketing.contact.whatsappTitle')}>{OPERATOR.whatsapp}</DetailRow>
        <DetailRow label={t('marketing.contact.emailTitle')}>{OPERATOR.email}</DetailRow>
        <DetailRow label={t('marketing.contact.hoursTitle')}>
          {t('marketing.contactInfo.hours')}
        </DetailRow>
        <DetailRow label={t('marketing.contact.addressTitle')}>
          {t('marketing.contactInfo.address')}
        </DetailRow>
        <DetailRow label={t('marketing.contact.officerTitle')}>{OPERATOR.officer}</DetailRow>
      </dl>

      <p className="mt-6 text-sm text-slate-600">{t('marketing.contact.complaintNote')}</p>
    </div>
  );
}
