import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth/useAuth';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';
import { Button, Card, ErrorState, Field, TextInput } from '../../components/ui';

/**
 * The phone → OTP flow shared by the customer and partner sign-in/register
 * placeholders (`CustomerLogin`, `CustomerRegister`, `PartnerLogin`,
 * `PartnerRegister`). Login and register are the same API call — the API
 * creates the account on first successful OTP verification and has no
 * separate sign-up endpoint (docs/API.md) — so this one component IS both
 * screens; only the heading/CTA copy and the post-login destination differ,
 * which is why those are props rather than two divergent implementations.
 *
 * **The bug this exists to prevent, ported from the Next app's regression
 * test** (`src/test/login-phone.test.tsx`): `POST /auth/otp/request` echoes
 * the phone back masked (`+9199999*****`). Writing that value over what the
 * person typed produces a screen that sends the OTP fine and then can never
 * verify — the verify call would carry a string of asterisks. `phone` and
 * `maskedPhone` are therefore two separate pieces of state, and only
 * `maskedPhone` is ever shown on screen.
 */
export function PhoneOtpForm({
  title,
  hint,
  submitLabel,
  onSuccessPath,
  switchLink,
}: {
  title: string;
  hint?: ReactNode;
  submitLabel: string;
  /** Locale-unprefixed pathname to land on after a successful sign-in. */
  onSuccessPath: string;
  /** e.g. "New here? Create an account" linking to the sibling register/login route. */
  switchLink?: ReactNode;
}) {
  const { requestOtp, login } = useAuth();
  const navigate = useNavigate();
  const locale = useLocale();
  const t = useT();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [resendableAt, setResendableAt] = useState(0);

  // Same fixed-OTP hint the admin console and the old Next app show — only
  // ever for a phone in the dev bypass prefix, and only in a dev build
  // (`import.meta.env.DEV`, Vite's equivalent of `NODE_ENV==='development'`).
  const showDevHint = import.meta.env.DEV && /^\+?91?9{5}/.test(phone.replace(/[^\d+]/g, ''));

  async function sendOtp() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestOtp(phone);
      setMaskedPhone(result.phone);
      setResendableAt(Date.now() + 60_000);
      setStep('otp');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, otp);
      navigate(buildLocalizedHref(locale, onSuccessPath), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Card title={title}>
        <div className="flex flex-col gap-4">
          {hint ? <p className="text-sm text-muted">{hint}</p> : null}

          {step === 'phone' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendOtp();
              }}
              className="flex flex-col gap-4"
            >
              <Field label={t('auth.phoneLabel')}>
                {(id) => (
                  <TextInput
                    id={id}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder={t('auth.phonePlaceholder')}
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    required
                  />
                )}
              </Field>
              {error ? <ErrorState error={error} /> : null}
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={busy}
                disabled={phone.trim().length < 10}
              >
                {t('auth.sendCode')}
              </Button>
            </form>
          ) : (
            <form onSubmit={(event) => void verify(event)} className="flex flex-col gap-4">
              <p className="text-sm text-slate-600">
                {t('auth.otpSentTo', { phone: maskedPhone || phone })}
              </p>
              <Field label={t('auth.otpLabel')}>
                {(id) => (
                  <TextInput
                    id={id}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value)}
                    required
                  />
                )}
              </Field>
              {showDevHint ? <p className="text-sm text-warning">{t('auth.devHint')}</p> : null}
              {error ? <ErrorState error={error} /> : null}
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={busy}
                disabled={otp.length !== 6}
              >
                {submitLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                disabled={Date.now() < resendableAt}
                onClick={() => void sendOtp()}
              >
                {t('auth.resend')}
              </Button>
              <Button type="button" variant="ghost" fullWidth onClick={() => setStep('phone')}>
                {t('auth.changeNumber')}
              </Button>
            </form>
          )}

          {switchLink ? <div className="text-center text-sm">{switchLink}</div> : null}
        </div>
      </Card>
    </div>
  );
}
