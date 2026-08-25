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
  const { adminLogin } = useAuth();
  const navigate = useNavigate();
  const locale = useLocale();
  const t = useMemo(() => createTranslator('en'), []);

  /**
   * The email only — never the password.
   *
   * A dev hint is a convenience for whoever runs this locally; it is not a
   * place to put a real credential. This one held the actual admin password,
   * which would have been committed to git and is reused on another system.
   * Whoever needs it can read ADMIN_PASSWORD from apps/api/.env.
   */
  const devHint = import.meta.env.DEV
    ? 'Dev mode: sign in as the email in ADMIN_EMAIL (apps/api/.env)'
    : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminLogin(email, password);
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
        <form onSubmit={(event) => void submitLogin(event)} className="flex flex-col gap-4">
          <Field label="Email">
            {(id) => (
              <TextInput
                id={id}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
      </Card>
    </div>
  );
}
