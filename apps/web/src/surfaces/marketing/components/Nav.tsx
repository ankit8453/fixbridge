import { Link } from 'react-router-dom';
import { APP_NAME, BrandLogo } from '@/brand/tokens';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import { useT } from '@/i18n/useT';
import { LocaleToggle } from '@/components/shell/LocaleToggle';

/**
 * The marketing surface's own nav — not `components/shell/RoleNav`, which is
 * surface B/C/D's post-login shell (role switcher, logout) and would be
 * meaningless to a signed-out visitor landing here from a WhatsApp link.
 * Ported from `legacy-next-src/components/marketing/Nav.tsx`; the secondary
 * link row scrolls horizontally instead of collapsing into a hamburger —
 * zero extra JS for the disclosure behaviour a client-side surface can't get
 * for free the way a server component once did.
 */
export function MarketingNav({ locale }: { locale: Locale }) {
  const t = useT();

  const links = [
    { href: '/services', label: t('marketing.nav.services') },
    { href: '/how-it-works', label: t('marketing.nav.howItWorks') },
    { href: '/for-partners', label: t('marketing.nav.forPartners') },
    { href: '/download', label: t('marketing.nav.download') },
    { href: '/contact', label: t('marketing.nav.contact') },
  ];

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link to={buildLocalizedHref(locale, '/')} className="flex shrink-0 items-center gap-2">
          <BrandLogo size={32} />
          <span className="text-base font-semibold text-slate-900">{APP_NAME}</span>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          <LocaleToggle />
          <Link
            to={buildLocalizedHref(locale, '/app')}
            className="inline-flex min-h-touch items-center justify-center rounded-lg border border-transparent bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:opacity-90"
          >
            {t('marketing.nav.bookNow')}
          </Link>
        </div>
      </div>

      <nav
        aria-label={t('marketing.nav.menu')}
        className="flex gap-5 overflow-x-auto px-4 pb-3 text-sm font-medium text-slate-600"
      >
        {links.map((link) => (
          <Link
            key={link.href}
            to={buildLocalizedHref(locale, link.href)}
            className="flex min-h-touch shrink-0 items-center py-1 hover:text-brand"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
