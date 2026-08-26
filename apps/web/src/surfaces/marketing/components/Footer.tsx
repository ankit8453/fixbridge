import { Link } from 'react-router-dom';
import { APP_NAME } from '@/brand/tokens';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import { useT } from '@/i18n/useT';

/** Ported from `legacy-next-src/components/marketing/Footer.tsx`. */
export function MarketingFooter({ locale }: { locale: Locale }) {
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-slate-600">
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <div>
            <p className="font-semibold text-slate-900">{APP_NAME}</p>
            <p className="mt-1 max-w-md">{t('marketing.footer.tagline')}</p>
          </div>

          {/* The physical address. A real place a customer can point to is a
              trust signal in itself in this market — national platforms have
              call centres; a local one has a door. */}
          <address className="not-italic">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              {t('marketing.contactInfo.addressHeading')}
            </p>
            <p className="mt-1.5 max-w-xs leading-relaxed">{t('marketing.contactInfo.address')}</p>
            <p className="mt-2 text-xs text-slate-500">
              {t('marketing.contactInfo.hoursHeading')}: {t('marketing.contactInfo.hours')}
            </p>
          </address>
        </div>

        <nav
          aria-label={t('marketing.footer.legalHeading')}
          className="mt-6 flex flex-wrap gap-x-6 gap-y-2"
        >
          <Link
            to={buildLocalizedHref(locale, '/privacy')}
            className="flex min-h-touch items-center hover:text-brand"
          >
            {t('marketing.footer.privacy')}
          </Link>
          <Link
            to={buildLocalizedHref(locale, '/terms')}
            className="flex min-h-touch items-center hover:text-brand"
          >
            {t('marketing.footer.terms')}
          </Link>
          <Link
            to={buildLocalizedHref(locale, '/contact')}
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
