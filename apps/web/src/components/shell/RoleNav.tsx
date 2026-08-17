import { Link } from 'react-router-dom';
import { APP_NAME, BrandLogo } from '../../brand/tokens';
import { useAuth } from '../../lib/auth/useAuth';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';
import { Button } from '../ui/Button';
import { SurfaceSwitcher } from './SurfaceSwitcher';
import { LocaleToggle } from './LocaleToggle';

/**
 * A minimal, working top bar — logo, surface switcher, locale toggle, log
 * out — for surfaces that have not built their own yet. It is a starting
 * point, not a fixture: a surface with different navigation needs (the
 * partner app's bottom tab bar for one-handed use, say — see
 * `MobileAppShell`) should replace this rather than fight it. What matters
 * is reusing `SurfaceSwitcher` and `LocaleToggle` rather than re-deriving
 * their logic.
 */
export function RoleNav() {
  const { status, logout } = useAuth();
  const locale = useLocale();
  const t = useT();

  return (
    <header className="sticky top-0 z-40 flex min-h-touch items-center justify-between gap-3 border-b border-border bg-white px-4 py-2">
      <Link to={buildLocalizedHref(locale, '/')} className="flex items-center gap-2">
        <BrandLogo size={28} />
        <span className="text-sm font-semibold text-slate-900">{APP_NAME}</span>
      </Link>
      <div className="flex items-center gap-1">
        <SurfaceSwitcher />
        <LocaleToggle />
        {status === 'signedIn' ? (
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            {t('nav.logout')}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
