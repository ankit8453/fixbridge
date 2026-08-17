import { Link } from 'react-router-dom';
import { CustomerAuthScreen } from './CustomerAuthScreen';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';

/**
 * `/login` — the customer surface's sign-in screen. See
 * `CustomerAuthScreen` for the actual phone → OTP → onboarding flow this
 * and `/register` share.
 */
export default function CustomerLogin() {
  const t = useT();
  const locale = useLocale();

  return (
    <CustomerAuthScreen
      title={t('app.auth.title')}
      switchLink={
        <Link to={buildLocalizedHref(locale, '/register')} className="text-brand hover:underline">
          {t('auth.goToRegister')}
        </Link>
      }
    />
  );
}
