import { Link } from 'react-router-dom';
import { buildLocalizedHref } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/useT';
import { legalVars } from '../operator';
import { useMarketingSeo } from '../useMarketingSeo';

/** Every legal page, so each one can link to the others. */
export const LEGAL_PAGES = [
  { path: '/terms', labelKey: 'marketing.footer.terms' },
  { path: '/partner-terms', labelKey: 'marketing.footer.partnerTerms' },
  { path: '/privacy', labelKey: 'marketing.footer.privacy' },
  { path: '/refund-policy', labelKey: 'marketing.footer.refund' },
  { path: '/delete-account', labelKey: 'marketing.footer.deleteAccount' },
] as const;

/**
 * Shared layout for the legal pages.
 *
 * Each page's text lives in `marketing.{hi,en}.json` under its own key
 * (`marketing.<ns>.*`): `title`, `updated`, `pilotNotice`, `intro`, and a
 * `<section>Heading` / `<section>Body` pair per section. The operator's
 * details are interpolated from `operator.ts`, so they are never typed into
 * the copy itself.
 */
export function LegalPage({
  ns,
  pathname,
  sections,
}: {
  ns: string;
  pathname: string;
  sections: readonly string[];
}) {
  const t = useT();
  const locale = useLocale();
  const vars = legalVars(t);

  useMarketingSeo({
    locale,
    pathname,
    title: t(`marketing.${ns}.metaTitle`),
    description: t(`marketing.${ns}.metaDescription`, vars),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-slate-900">{t(`marketing.${ns}.title`)}</h1>
      <p className="mt-1 text-sm text-slate-500">{t(`marketing.${ns}.updated`)}</p>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t(`marketing.${ns}.pilotNotice`, vars)}
      </p>
      <p className="mt-4 whitespace-pre-line text-slate-700">{t(`marketing.${ns}.intro`, vars)}</p>

      <div className="mt-8 space-y-8">
        {sections.map((section, index) => (
          <section key={section}>
            <h2 className="text-xl font-semibold text-slate-900">
              {index + 1}. {t(`marketing.${ns}.${section}Heading`, vars)}
            </h2>
            <p className="mt-2 whitespace-pre-line text-slate-700">
              {t(`marketing.${ns}.${section}Body`, vars)}
            </p>
          </section>
        ))}
      </div>

      <nav
        aria-label={t('marketing.footer.legalHeading')}
        className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-sm"
      >
        {LEGAL_PAGES.filter((page) => page.path !== pathname).map((page) => (
          <Link
            key={page.path}
            to={buildLocalizedHref(locale, page.path)}
            className="flex min-h-touch items-center text-slate-600 hover:text-brand"
          >
            {t(page.labelKey)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
