import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth/useAuth';
import { useLocale, useT } from '../../i18n/useT';
import { buildLocalizedHref } from '../../i18n/config';
import { apiRequest } from '../../lib/api';
import { Button, Card, ErrorState, Field, TextInput } from '../../components/ui';
import {
  useCustomerProfile,
  useUpdateCustomerProfile,
} from '../../surfaces/customer/data/addresses';
import type { CustomerProfile } from '../../surfaces/customer/data/types';
import type { Locale } from '../../i18n/config';

type Step = 'phone' | 'otp' | 'onboarding';

/**
 * The shared implementation behind both `/login` and `/register`: phone →
 * OTP → (first time only) name + language. Ported from
 * `legacy-next-src/components/customer/auth/LoginScreen.tsx`. `CustomerLogin`
 * and `CustomerRegister` are both thin wrappers around this — the API makes
 * no distinction between signing in and signing up (an account is created on
 * first successful OTP verification; see `docs/API.md`), so the two routes
 * exist only to carry different heading copy and a "wrong door" switch link,
 * not two different flows.
 *
 * "First time" is detected from `GET /customers/me` returning
 * `{ profile: null }` (the API's own documented signal — `docs/API.md`
 * "Customers") rather than a login-response flag — this app's session layer
 * (`lib/auth/session.ts`) only ever exposes `{ user, roles }` after login,
 * nothing about newness. A returning user who has simply never saved a
 * display name also sees the onboarding step, which is correct either way.
 *
 * **The masked-phone bug this form exists to avoid** (see
 * `src/test/login-phone.test.tsx`): `POST /auth/otp/request` echoes the
 * phone back masked (`+9199999*****`). `phone` (what the user typed) and
 * `maskedPhone` (display only) are kept as separate state on purpose — the
 * verify call always sends `phone`, never the masked echo.
 */
export function CustomerAuthScreen({
  title,
  hint,
  switchLink,
}: {
  title: string;
  hint?: ReactNode;
  switchLink?: ReactNode;
}) {
  const { requestOtp, login } = useAuth();
  const navigate = useNavigate();
  const locale = useLocale();
  const t = useT();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [resendableAt, setResendableAt] = useState(0);

  // Same fixed-OTP hint the admin console and partner surface show — only
  // ever for a phone in the dev bypass prefix, and only in a dev build.
  const showDevHint = import.meta.env.DEV && /^\+?91?9{5}/.test(phone.replace(/[^\d+]/g, ''));

  async function sendOtp() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestOtp(phone);
      // Display only — `phone` keeps what the person actually typed, because
      // that is what the verify call has to send.
      setMaskedPhone(result.phone);
      setResendableAt(Date.now() + 60_000);
      setStep('otp');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, otp);

      const { profile } = await apiRequest<{ profile: CustomerProfile | null }>(
        '/api/v1/customers/me',
      );

      if (profile === null) {
        setStep('onboarding');
      } else {
        navigate(buildLocalizedHref(locale, '/app'), { replace: true });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'onboarding') {
    return (
      <OnboardingStep
        onDone={() => navigate(buildLocalizedHref(locale, '/app'), { replace: true })}
      />
    );
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
                    onChange={(e) => setPhone(e.target.value)}
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
            <form onSubmit={(e) => void handleVerifyOtp(e)} className="flex flex-col gap-4">
              <p className="text-sm text-slate-600">
                {t('app.auth.otpSentTo', { phone: maskedPhone || phone })}
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
                    onChange={(e) => setOtp(e.target.value)}
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
                {t('auth.verifyCode')}
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
              <Button
                type="button"
                variant="ghost"
                fullWidth
                onClick={() => {
                  setStep('phone');
                  setError(null);
                }}
              >
                {t('app.auth.changeNumber')}
              </Button>
            </form>
          )}

          {switchLink ? <div className="text-center text-sm">{switchLink}</div> : null}
        </div>
      </Card>
    </div>
  );
}

function OnboardingStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { data } = useCustomerProfile();
  const updateProfile = useUpdateCustomerProfile();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await updateProfile.mutateAsync({ displayName: name.trim() });

      if (language !== locale) {
        await apiRequest('/api/v1/auth/me', {
          method: 'PATCH',
          body: { preferredLanguage: language },
        });
        navigate(buildLocalizedHref(language, '/app'), { replace: true });
        return;
      }

      onDone();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Card title={t('app.onboarding.title')}>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">{t('app.onboarding.hint')}</p>
          <Field label={t('app.onboarding.nameLabel')}>
            {(id) => (
              <TextInput
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={data?.profile?.displayName ?? ''}
                required
                maxLength={120}
              />
            )}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-slate-700">
              {t('app.onboarding.languageLabel')}
            </legend>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={language === 'hi' ? 'primary' : 'secondary'}
                onClick={() => setLanguage('hi')}
              >
                हिंदी
              </Button>
              <Button
                type="button"
                variant={language === 'en' ? 'primary' : 'secondary'}
                onClick={() => setLanguage('en')}
              >
                English
              </Button>
            </div>
          </fieldset>
          {error ? <ErrorState error={error} onRetry={() => setError(null)} /> : null}
          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={updateProfile.isPending}
            disabled={name.trim().length === 0}
          >
            {t('app.onboarding.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
