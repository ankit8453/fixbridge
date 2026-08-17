import { Link } from 'react-router-dom';
import { CustomerAuthScreen } from './CustomerAuthScreen';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';

/**
 * `/register` — the identical phone → OTP → onboarding flow as `/login`
 * (there is no separate sign-up endpoint: the API creates the account on
 * first successful OTP verification — see `docs/API.md`), framed as signing
 * up per the phase brief ("the same first-time path, framed as signing
 * up"). A distinct route exists so an incoming link ("create your account")
 * lands somewhere that says "register", not "sign in" — only the heading
 * and switch-link differ from `/login`.
 */
export default function CustomerRegister() {
  const t = useT();
  const locale = useLocale();

  return (
    <CustomerAuthScreen
      title={t('auth.registerAs', { surface: t('nav.app') })}
      hint={t('auth.registerHint')}
      switchLink={
        <Link to={buildLocalizedHref(locale, '/login')} className="text-brand hover:underline">
          {t('auth.goToLogin')}
        </Link>
      }
    />
  );
}
