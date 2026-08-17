import { useState } from 'react';
import { useT } from '../../../i18n/useT';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

/**
 * The handshake-code keypad — entering the start/end OTP the customer reads
 * aloud (docs/bookings.md: "four digits, not six … spoken aloud, in person,
 * often over the noise of a job"). Deliberately not a password field: these
 * codes are read out loud by design, so hiding the digits on screen would
 * only make a technician second-guess what they just typed while someone is
 * standing there waiting.
 *
 * Auto-submits the moment 4 digits are entered — the fastest path when the
 * customer is reciting the code, and a wrong entry is cheaply fixed with
 * "galat" (clear) rather than needing a separate confirm tap every time.
 *
 * Keys are deliberately larger than the kit's normal 44px floor (`h-16 w-20`
 * here vs `min-h-touch`) — PHASE12_PROMPT.md calls for "big numeric keypad,
 * thumb-sized" specifically for this control, one-handed, often mid-job.
 */
export function OtpKeypad({
  length = 4,
  pending,
  error,
  remainingAttempts,
  onSubmit,
}: {
  length?: number;
  pending?: boolean;
  error?: string | null;
  remainingAttempts?: number | null;
  onSubmit: (otp: string) => void;
}) {
  const t = useT();
  const [digits, setDigits] = useState('');

  function press(key: (typeof KEYS)[number]) {
    if (pending) return;

    if (key === 'back') {
      setDigits((prev) => prev.slice(0, -1));
      return;
    }

    if (key === 'clear') {
      setDigits('');
      return;
    }

    const next = digits.length < length ? digits + key : digits;
    setDigits(next);

    if (next.length === length) {
      onSubmit(next);
      setDigits('');
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-3" aria-label={t('partner.otp.enteredLabel')}>
        {Array.from({ length }).map((_, index) => (
          <div
            key={index}
            className="flex h-16 w-12 items-center justify-center rounded-lg border-2 border-slate-300 text-3xl font-bold tabular-nums text-slate-900"
          >
            {digits[index] ?? ''}
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-center text-base font-semibold text-danger">
          {error}
          {typeof remainingAttempts === 'number'
            ? ` (${t('partner.otp.attemptsLeft', { count: remainingAttempts })})`
            : ''}
        </p>
      ) : null}

      {pending ? <p className="text-sm text-muted">{t('partner.otp.checking')}</p> : null}

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={pending}
            onClick={() => press(key)}
            aria-label={
              key === 'back'
                ? t('partner.otp.backspace')
                : key === 'clear'
                  ? t('partner.otp.clear')
                  : key
            }
            className="flex h-16 w-20 items-center justify-center rounded-xl border border-slate-300 bg-white text-2xl font-semibold text-slate-900 transition-colors duration-150 active:bg-slate-100 disabled:opacity-50"
          >
            {key === 'back' ? '⌫' : key === 'clear' ? t('partner.otp.clearShort') : key}
          </button>
        ))}
      </div>
    </div>
  );
}
