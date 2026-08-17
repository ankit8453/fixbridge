import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth/useAuth';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref, DEFAULT_LOCALE } from '../../i18n/config';
import { apiRequest } from '../../lib/api';

/**
 * Switches locale by navigating to the equivalent URL in the other locale —
 * not a client-side state flip — because the locale IS the URL in this app
 * (see `router/router.tsx`). A stateful toggle that left the URL alone would
 * desync a bookmark or a shared link from what's actually on screen.
 */
export function LocaleToggle() {
  const locale = useLocale();
  const t = useT();
  const { pathname } = useLocation();
  const { status } = useAuth();

  const target = locale === 'hi' ? 'en' : 'hi';
  const bare =
    locale === DEFAULT_LOCALE ? pathname : pathname.replace(new RegExp(`^/${locale}`), '') || '/';
  const href = buildLocalizedHref(target, bare);

  const handleClick = () => {
    // "logged-in users' preferred_language synced on toggle" (phase spec).
    // Fire-and-forget: the navigation must not wait on this, and a failure
    // here (offline, token mid-refresh) should never block switching locale.
    if (status === 'signedIn') {
      void apiRequest('/api/v1/auth/me', {
        method: 'PATCH',
        body: { preferredLanguage: target },
        locale: target,
      }).catch(() => undefined);
    }
  };

  return (
    <Link
      to={href}
      onClick={handleClick}
      aria-label={target === 'en' ? t('locale.toggleToEnglish') : t('locale.toggleToHindi')}
      className="inline-flex min-h-touch items-center px-2 text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
    >
      {target === 'en' ? t('locale.toggleToEnglish') : t('locale.toggleToHindi')}
    </Link>
  );
}
