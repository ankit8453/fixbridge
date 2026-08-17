import { Link } from 'react-router-dom';
import { PhoneOtpForm } from './PhoneOtpForm';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';

/**
 * `/partner/login`. Lands on `/partner` on success — same as the customer
 * flow, this does not itself check for the `technician` role. A brand-new
 * phone number only ever holds `customer` on first verification (the API
 * has no separate "register as a technician" auth path — becoming a partner
 * is `POST /providers/me/register`, called from inside the app, not at sign
 * in). That is why `/partner/*` in `router.tsx` is guarded with
 * `RequireAuth`, not `RequireRole('technician')` — ported directly from the
 * legacy Next app's `partner/(protected)/layout.tsx`, whose own comment
 * explains it: the partner surface is expected to show a "become a partner"
 * gate to a signed-in non-technician rather than bounce them back here.
 */
export default function PartnerLogin() {
  const t = useT();
  const locale = useLocale();

  return (
    <PhoneOtpForm
      title={t('auth.signInAs', { surface: t('nav.partner') })}
      submitLabel={t('auth.verifyCode')}
      onSuccessPath="/partner"
      switchLink={
        <Link
          to={buildLocalizedHref(locale, '/partner/register')}
          className="text-brand hover:underline"
        >
          {t('auth.goToRegister')}
        </Link>
      }
    />
  );
}
