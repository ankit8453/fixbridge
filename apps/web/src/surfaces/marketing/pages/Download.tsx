import { Badge, Card } from '@/components/ui';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import { useMarketingSeo } from '../useMarketingSeo';
import { CtaLink } from '../components/Cta';

/**
 * `/download` — placeholder cards, structure and copy final now
 * (PHASE12_PROMPT.md §A). Ported from
 * `legacy-next-src/app/[locale]/(marketing)/download/page.tsx`. The APKs
 * themselves are Phase 13 (customer, Flutter) and Phase 14 (partner). Each
 * card's CTA already routes to the real web surface it will eventually stand
 * next to.
 *
 * Badge tone: legacy used `warn` for "coming soon" — this design system's
 * vocabulary calls that tone `warning` (see `components/ui/Badge.tsx`).
 */
export default function Download() {
  const t = useT();
  const locale = useLocale();

  useMarketingSeo({
    locale,
    pathname: '/download',
    title: t('marketing.download.metaTitle'),
    description: t('marketing.download.metaDescription', { app: APP_NAME }),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{t('marketing.download.heroTitle')}</h1>
      <p className="mt-3 text-lg text-slate-600">{t('marketing.download.heroSubtitle')}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card
          title={t('marketing.download.customerCardTitle')}
          actions={<Badge tone="warning">{t('marketing.download.statusComingSoon')}</Badge>}
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
          actions={<Badge tone="warning">{t('marketing.download.statusComingSoon')}</Badge>}
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
