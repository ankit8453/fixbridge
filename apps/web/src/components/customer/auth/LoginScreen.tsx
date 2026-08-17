'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { apiRequest } from '@/lib/api';
import { Button, Card, ErrorState, Field, TextInput } from '@/components/ui';
import { useCustomerProfile, useUpdateCustomerProfile } from '@/components/customer/data/addresses';
import type { CustomerProfile } from '@/components/customer/data/types';
import type { Locale } from '@fixbridge/shared';

type Step = 'phone' | 'otp' | 'onboarding';

/**
 * Phone → OTP → (first time only) name + language.
 *
 * "First time" is detected from `GET /customers/me` returning
 * `{ profile: null }` (the API's own documented signal — see `docs/API.md`
 * "Customers" section) rather than the login response's `isNewUser` flag: the
 * `/api/session/login` route handler (`src/app/api/session/login/route.ts`,
 * outside this surface's lane) strips every field except
 * `{ accessToken, expiresIn, user }` before it reaches page JS, so
 * `isNewUser` never arrives here. The profile check is not a workaround for
 * that — it is the API's own documented mechanism — but it is worth naming
 * because it means a returning user who happens to have never saved a display
 * name also sees this step, which is the correct behaviour either way.
 */
export function LoginScreen() {
  const { requestOtp, login } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const t = useT();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  /**
   * The masked form the API echoes back (`+9199999*****`), for display only.
   *
   * Kept separate from `phone` because they are not interchangeable: the API
   * masks the number in its response deliberately, and verifying with that
   * string fails validation — it is not a phone number. Storing it over the
   * real one is an easy mistake to make and produces a login screen that can
   * never log anybody in.
   */
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [resendableAt, setResendableAt] = useState<number>(0);

  const isDevPhone = /^\+?91?9{5}/.test(phone.replace(/[^\d+]/g, ''));
  const showDevHint = process.env.NODE_ENV === 'development' && isDevPhone;

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

  function handleRequestOtp(event: FormEvent) {
    event.preventDefault();
    void sendOtp();
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
        router.replace(buildLocalizedHref(locale, '/app'));
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'onboarding') {
    return <OnboardingStep onDone={() => router.replace(buildLocalizedHref(locale, '/app'))} />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Card title={t('app.auth.title')}>
        {step === 'phone' ? (
          <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
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
              disabled={busy || phone.trim().length < 10}
            >
              {busy ? t('common.loading') : t('auth.sendCode')}
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
            {showDevHint ? <p className="text-sm text-amber-700">{t('auth.devHint')}</p> : null}
            {error ? <ErrorState error={error} /> : null}
            <Button type="submit" variant="primary" fullWidth disabled={busy || otp.length !== 6}>
              {busy ? t('common.loading') : t('auth.verifyCode')}
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
              {t('app.auth.changeNumber')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

function OnboardingStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
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
        router.replace(buildLocalizedHref(language, '/app'));
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
            disabled={updateProfile.isPending || name.trim().length === 0}
          >
            {updateProfile.isPending ? t('common.loading') : t('app.onboarding.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
