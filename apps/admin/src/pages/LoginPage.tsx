import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { requestOtp, verifyOtp } from '../api/endpoints';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/ui/Button';
import { Field, TextInput } from '../components/ui/Field';
import { ErrorState } from '../components/ui/States';
import { getDeviceId } from '../lib/api';

/**
 * OTP login, the same one the rest of the product uses.
 *
 * There is deliberately no separate ops credential. One identity per person
 * across the whole platform is what makes the audit log meaningful — an ops user
 * with a second, console-only account would be a second name for the same human
 * in the one place where names matter.
 */
export function LoginPage() {
  const { status, adopt, refusal, clearRefusal } = useAuth();

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'phone' | 'otp'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (status === 'signedIn') return <Navigate to="/" replace />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    clearRefusal();

    try {
      if (stage === 'phone') {
        await requestOtp(phone.trim());
        setStage('otp');
      } else {
        const session = await verifyOtp(phone.trim(), otp.trim(), getDeviceId());
        // The role gate lives in the provider, not here — a refusal must clean
        // up the tokens it was handed, and that is the provider's job.
        adopt(session);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm rounded border border-slate-200 bg-white p-6">
        <h1 className="text-base font-semibold text-slate-900">Operations console</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sign in with the phone number your ops account is registered to.
        </p>

        {refusal ? (
          <div role="alert" className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm text-red-900">{refusal}</p>
          </div>
        ) : null}

        {/* Submits on Enter from either field — this screen is used dozens of
            times a week and reaching for the mouse each time is friction. */}
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="Phone number">
            {(id) => (
              <TextInput
                id={id}
                name="phone"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+91…"
                value={phone}
                disabled={stage === 'otp'}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>

          {stage === 'otp' ? (
            <Field label="6-digit code" hint="Sent to that number. Valid for 5 minutes.">
              {(id) => (
                <TextInput
                  id={id}
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                />
              )}
            </Field>
          ) : null}

          {error ? <ErrorState error={error} /> : null}

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Working…' : stage === 'phone' ? 'Send code' : 'Sign in'}
            </Button>
            {stage === 'otp' ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStage('phone');
                  setOtp('');
                  setError(null);
                }}
              >
                Change number
              </Button>
            ) : null}
          </div>
        </form>

        <DevHint />
      </div>
    </div>
  );
}

/**
 * The local-development crib sheet.
 *
 * Gated on `import.meta.env.DEV`, which Vite replaces with a literal `false` in
 * a production build so the whole block is removed by dead-code elimination.
 * That matters: this text names real seeded accounts, and shipping it to a
 * deployed console would be publishing a list of privileged phone numbers.
 */
function DevHint() {
  if (!import.meta.env.DEV) return null;

  return (
    <div className="mt-6 rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <p className="font-medium text-slate-700">Local development only</p>
      <p className="mt-1">
        Phones starting <code>+9199999</code> accept the fixed OTP <code>000000</code> (the API
        refuses to boot with that setting in production).
      </p>
      <ul className="mt-1 list-inside list-disc">
        <li>
          Ops: <code>+919999900002</code>
        </li>
        <li>
          Admin: <code>+919999900001</code>
        </li>
      </ul>
    </div>
  );
}
