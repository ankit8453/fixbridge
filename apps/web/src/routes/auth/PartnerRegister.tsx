import { Link } from 'react-router-dom';
import { PhoneOtpForm } from './PhoneOtpForm';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';

/**
 * `/partner/register`. See `PartnerLogin`'s comment — this signs a phone
 * number in exactly the same way; the actual "become a partner" provider
 * registration happens after landing on `/partner`, not here.
 */
export default function PartnerRegister() {
  const t = useT();
  const locale = useLocale();

  return (
    <PhoneOtpForm
      title={t('auth.registerAs', { surface: t('nav.partner') })}
      hint={t('auth.registerHint')}
      submitLabel={t('auth.verifyCode')}
      onSuccessPath="/partner"
      switchLink={
        <Link
          to={buildLocalizedHref(locale, '/partner/login')}
          className="text-brand hover:underline"
        >
          {t('auth.goToLogin')}
        </Link>
      }
    />
  );
}
