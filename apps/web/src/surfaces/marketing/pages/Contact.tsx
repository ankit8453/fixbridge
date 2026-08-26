import { DetailRow } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { useLocale, useT } from '@/i18n/useT';
import { useMarketingSeo } from '../useMarketingSeo';

/**
 * `/contact` — ported from
 * `legacy-next-src/app/[locale]/(marketing)/contact/page.tsx`. Every contact
 * detail here is a bracketed placeholder (see marketing.*.json) — WhatsApp
 * number, support email, address — because none of it exists yet outside
 * this codebase; inventing one would be worse than an honest blank.
 * WhatsApp is listed first because it's this product's actual primary
 * channel, not email-first the way a generic template would default to.
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
          {/* One source of truth with the footer — the address lives under
              `contactInfo` so it can never drift between the two. */}
          {t('marketing.contactInfo.address')}
        </DetailRow>
      </dl>

      <p className="mt-6 text-sm text-slate-600">{t('marketing.contact.complaintNote')}</p>
    </div>
  );
}
