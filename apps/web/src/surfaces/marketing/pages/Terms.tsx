import { APP_NAME } from '@/brand/tokens';
import { useLocale, useT } from '@/i18n/useT';
import { useMarketingSeo } from '../useMarketingSeo';

/**
 * `/terms` — same "honest v1, pending legal review" approach as `/privacy`,
 * ported verbatim from
 * `legacy-next-src/app/[locale]/(marketing)/terms/page.tsx`. The jurisdiction
 * clause (`disputes.disputesBody`) carries a bracketed `[city — to be
 * finalised]` placeholder — kept as-is, **flagged for legal review** same as
 * `/privacy`.
 */
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

export default function Terms() {
  const t = useT();
  const locale = useLocale();

  useMarketingSeo({
    locale,
    pathname: '/terms',
    title: t('marketing.terms.metaTitle'),
    description: t('marketing.terms.metaDescription', { app: APP_NAME }),
  });

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
