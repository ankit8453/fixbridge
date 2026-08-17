import { APP_NAME } from '@/brand/tokens';
import { useLocale, useT } from '@/i18n/useT';
import { useMarketingSeo } from '../useMarketingSeo';

/**
 * `/privacy` — DPDP-compliant v1 draft (PHASE12_PROMPT.md §A). Ported
 * verbatim from `legacy-next-src/app/[locale]/(marketing)/privacy/page.tsx`
 * — substance, not a boilerplate placeholder: what is collected, why, how
 * long it is kept, who it is shared with, and the DPDP Act's own rights
 * (access, correction, erasure, grievance, nomination).
 *
 * This file does NOT invent an entity: no fabricated company address,
 * officer name or registration number — every one of those is a bracketed
 * `[...]` placeholder in marketing.{hi,en}.json's `privacy.grievanceBody`,
 * filled in from real data once legal has it. **Flagged in this port's
 * report for legal review before launch, same as the original.**
 */
const SECTIONS = [
  'dataCollected',
  'purpose',
  'sharing',
  'retention',
  'security',
  'rights',
  'grievance',
  'children',
  'changes',
] as const;

export default function Privacy() {
  const t = useT();
  const locale = useLocale();

  useMarketingSeo({
    locale,
    pathname: '/privacy',
    title: t('marketing.privacy.metaTitle'),
    description: t('marketing.privacy.metaDescription', { app: APP_NAME }),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{t('marketing.privacy.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('marketing.privacy.updated')}</p>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t('marketing.privacy.draftNotice')}
      </p>
      <p className="mt-4 text-slate-700">{t('marketing.privacy.intro')}</p>

      <div className="mt-8 space-y-8">
        {SECTIONS.map((section) => (
          <section key={section}>
            <h2 className="text-xl font-semibold text-slate-900">
              {t(`marketing.privacy.${section}Heading`)}
            </h2>
            <p className="mt-2 whitespace-pre-line text-slate-700">
              {t(`marketing.privacy.${section}Body`)}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
