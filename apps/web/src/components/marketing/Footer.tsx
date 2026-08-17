import Link from 'next/link';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import { getT } from '@/i18n/get-t';

export function MarketingFooter({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-slate-600">
        <p className="font-semibold text-slate-900">{APP_NAME}</p>
        <p className="mt-1 max-w-md">{t('marketing.footer.tagline')}</p>

        <nav
          aria-label={t('marketing.footer.legalHeading')}
          className="mt-6 flex flex-wrap gap-x-6 gap-y-2"
        >
          <Link
            href={buildLocalizedHref(locale, '/privacy')}
            className="flex min-h-touch items-center hover:text-brand"
          >
            {t('marketing.footer.privacy')}
          </Link>
          <Link
            href={buildLocalizedHref(locale, '/terms')}
            className="flex min-h-touch items-center hover:text-brand"
          >
            {t('marketing.footer.terms')}
          </Link>
          <Link
            href={buildLocalizedHref(locale, '/contact')}
            className="flex min-h-touch items-center hover:text-brand"
          >
            {t('marketing.footer.contactHeading')}
          </Link>
        </nav>

        <p className="mt-6 text-xs text-slate-400">
          {t('marketing.footer.rightsReserved', { year, app: APP_NAME })}
        </p>
      </div>
    </footer>
  );
}
