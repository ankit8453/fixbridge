import { Link, useLocation } from 'react-router-dom';
import { APP_NAME, BrandLogo } from '@/brand/tokens';
import { buildLocalizedHref, type Locale } from '@/i18n/config';
import { useT } from '@/i18n/useT';
import { LocaleToggle } from '@/components/shell/LocaleToggle';

/**
 * The marketing surface's own nav — not `components/shell/RoleNav`, which is
 * surface B/C/D's post-login shell (role switcher, logout) and would be
 * meaningless to a signed-out visitor landing here from a WhatsApp link.
 *
 * One row on desktop — logo, centred links, locale + CTA — because the old
 * two-row layout read as broken at 1440px. Below `lg` the links drop into a
 * horizontally scrolling strip (zero extra JS for a hamburger a client-side
 * surface would have to hand-roll), and the active page is underlined so the
 * strip reads as navigation, not a tag cloud.
 */
export function MarketingNav({ locale }: { locale: Locale }) {
  const t = useT();
  const { pathname } = useLocation();

  const links = [
    { href: '/services', label: t('marketing.nav.services') },
    { href: '/how-it-works', label: t('marketing.nav.howItWorks') },
    { href: '/for-partners', label: t('marketing.nav.forPartners') },
    { href: '/download', label: t('marketing.nav.download') },
    { href: '/contact', label: t('marketing.nav.contact') },
  ];

  const isActive = (href: string) => pathname.endsWith(href) || pathname.includes(`${href}/`);

  const linkClass = (href: string) =>
    `relative flex min-h-touch shrink-0 items-center whitespace-nowrap text-sm font-medium transition-colors after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:transition-transform ${
      isActive(href)
        ? 'text-brand after:scale-x-100 after:bg-brand'
        : 'text-slate-600 after:scale-x-0 after:bg-brand hover:text-brand hover:after:scale-x-100'
    }`;

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
        <Link to={buildLocalizedHref(locale, '/')} className="flex shrink-0 items-center gap-2.5">
          <BrandLogo size={34} />
          <span className="text-lg font-bold tracking-tight text-slate-900">{APP_NAME}</span>
        </Link>

        <nav
          aria-label={t('marketing.nav.menu')}
          className="hidden flex-1 items-center justify-center gap-7 lg:flex"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              to={buildLocalizedHref(locale, link.href)}
              className={linkClass(link.href)}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2.5 lg:ml-0">
          <LocaleToggle />
          <Link
            to={buildLocalizedHref(locale, '/app')}
            className="inline-flex min-h-touch items-center justify-center rounded-full bg-brand px-5 text-sm font-semibold text-brand-foreground shadow-sm transition-all hover:-translate-y-px hover:opacity-90"
          >
            {t('marketing.nav.bookNow')}
          </Link>
        </div>
      </div>

      {/* Mobile / tablet link strip — desktop gets the inline row above. */}
      <nav
        aria-label={t('marketing.nav.menu')}
        className="flex gap-6 overflow-x-auto px-4 pb-2.5 sm:px-6 lg:hidden"
      >
        {links.map((link) => (
          <Link
            key={link.href}
            to={buildLocalizedHref(locale, link.href)}
            className={linkClass(link.href)}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
