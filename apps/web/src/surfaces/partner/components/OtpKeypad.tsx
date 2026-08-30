import { useCallback, useEffect, useRef, useState } from 'react';
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
 *
 * **Both input methods work.** The on-screen keys are for the phone this is
 * designed around; a physical keyboard is for the desk, where clicking twelve
 * buttons with a mouse to type four digits is absurd. Ops and assisted
 * onboarding both run on laptops, so the keypad is focusable and listens for
 * number keys, Backspace, Escape and paste — a code arriving over WhatsApp is
 * pasted far more often than retyped.
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
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Appends digits and fires as soon as the code is complete.
   *
   * Takes a string rather than one character so a paste of the whole code goes
   * through exactly the same path as four keystrokes.
   */
  const append = useCallback(
    (input: string) => {
      const cleaned = input.replace(/\D/g, '');
      if (cleaned.length === 0) return;

      setDigits((prev) => {
        const next = (prev + cleaned).slice(0, length);

        if (next.length === length) {
          // After the state settles, so a re-render never lands mid-submit.
          queueMicrotask(() => {
            onSubmit(next);
            setDigits('');
          });
        }

        return next;
      });
    },
    [length, onSubmit],
  );

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

    append(key);
  }

  /**
   * Focus lands here on mount, so a technician at a desk can simply type.
   *
   * Only when nothing else is focused — stealing focus from a field somebody
   * is already filling in would be worse than the problem it solves.
   */
  useEffect(() => {
    const active = document.activeElement;
    const nothingFocused = active === null || active === document.body;

    if (nothingFocused) containerRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={t('partner.otp.keypadLabel')}
      onKeyDown={(event) => {
        if (pending) return;

        // Never swallow the keys that move around or activate a button.
        if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' ') return;

        if (/^[0-9]$/.test(event.key)) {
          event.preventDefault();
          append(event.key);
          return;
        }

        if (event.key === 'Backspace') {
          event.preventDefault();
          setDigits((prev) => prev.slice(0, -1));
          return;
        }

        if (event.key === 'Escape' || event.key === 'Delete') {
          event.preventDefault();
          setDigits('');
        }
      }}
      onPaste={(event) => {
        if (pending) return;
        event.preventDefault();
        append(event.clipboardData.getData('text'));
      }}
      className="flex flex-col items-center gap-4 rounded-2xl outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="flex gap-3" aria-label={t('partner.otp.enteredLabel')}>
        {Array.from({ length }).map((_, index) => (
          <div
            key={index}
            className={`flex h-16 w-12 items-center justify-center rounded-lg border-2 text-3xl font-bold tabular-nums text-slate-900 transition-colors ${
              index === digits.length ? 'border-brand' : 'border-slate-300'
            }`}
          >
            {digits[index] ?? ''}
          </div>
        ))}
      </div>

      {/* Says the keyboard works, because nothing else on screen suggests it. */}
      <p className="text-xs text-muted">{t('partner.otp.typeHint')}</p>

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
            /**
             * Not focusable: the group above owns the keyboard. Without this,
             * Tab walks twelve buttons and Space "presses" whichever one the
             * technician happened to land on.
             */
            tabIndex={-1}
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
