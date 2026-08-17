import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth/useAuth';
import { useLocale } from '../../i18n/useT';
import { createTranslator } from '../../i18n/dictionaries';
import { buildLocalizedHref } from '../../i18n/config';
import { Button, Card, ErrorState, Field, TextInput } from '../../components/ui';

/**
 * `/admin/login` — the ops console's two-factor sign-in: ID + password
 * (`adminPasswordStep`), then the OTP that step sends (`adminLogin`). See
 * `apps/api/src/modules/auth/admin-login.ts` for why it is two calls rather
 * than one: password alone never issues a session, so a leaked password is
 * only half of an access attempt.
 *
 * A placeholder wired to the real two admin auth calls — the console UI
 * (branding, "which account is this" messaging) belongs to whichever agent
 * builds `/admin` for real.
 */
export default function AdminLogin() {
  const { adminPasswordStep, adminLogin } = useAuth();
  const navigate = useNavigate();
  // Only for `buildLocalizedHref` below — the post-login redirect keeps
  // whatever locale prefix the operator arrived on, so /en/admin/login lands
  // on /en/admin rather than silently dropping them to the Hindi tree.
  const locale = useLocale();

  /**
   * English, always — deliberately NOT `useT()`.
   *
   * The ops console is English-only by decision (see README's surface table
   * and the phase brief): every string in `surfaces/admin/**` is hardcoded
   * English, and `adminRequest` pins `Accept-Language: en` so server-rendered
   * errors match. This screen was the one exception — it read the locale from
   * the URL, so the unprefixed `/admin/login` rendered Hindi and then flipped
   * to English the moment sign-in succeeded. Pinning it here makes the
   * console consistent from the first screen instead of mid-session.
   */
  const t = useMemo(() => createTranslator('en'), []);

  // Dev-only hint — never rendered in a production build
  // (`import.meta.env.DEV`, Vite's equivalent of `NODE_ENV==='development'`).
  // Matches the seeded dev admin account so a new agent/reviewer can sign in
  // without hunting for credentials.
  const devHint = import.meta.env.DEV
    ? 'Dev mode: ID +919999900001, password fixbridge-dev-admin, OTP 000000'
    : null;

  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const challenge = await adminPasswordStep(loginId, password);
      setChallengeId(challenge.challengeId);
      setMaskedPhone(challenge.phone);
      setStep('otp');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminLogin(challengeId, otp);
      navigate(buildLocalizedHref(locale, '/admin'), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Card title={t('auth.signInAs', { surface: t('nav.admin') })}>
        {step === 'password' ? (
          <form onSubmit={(event) => void submitPassword(event)} className="flex flex-col gap-4">
            <Field label={t('auth.admin.loginIdLabel')}>
              {(id) => (
                <TextInput
                  id={id}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="username"
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t('auth.admin.passwordLabel')}>
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              )}
            </Field>
            {error ? <ErrorState error={error} /> : null}
            {devHint ? <p className="text-sm text-muted">{devHint}</p> : null}
            <Button type="submit" variant="primary" fullWidth loading={busy}>
              {t('auth.admin.signIn')}
            </Button>
          </form>
        ) : (
          <form onSubmit={(event) => void submitOtp(event)} className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">
              {t('auth.admin.codeSentTo', { phone: maskedPhone })}
            </p>
            <Field label={t('auth.admin.otpLabel')}>
              {(id) => (
                <TextInput
                  id={id}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  required
                />
              )}
            </Field>
            {error ? <ErrorState error={error} /> : null}
            {devHint ? <p className="text-sm text-muted">{devHint}</p> : null}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={busy}
              disabled={otp.length < 4}
            >
              {t('auth.admin.verify')}
            </Button>
            <Button type="button" variant="ghost" fullWidth onClick={() => setStep('password')}>
              {t('auth.admin.backToLogin')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
