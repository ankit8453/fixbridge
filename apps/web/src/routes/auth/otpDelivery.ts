import type { OtpDelivery } from '../../lib/auth/session';

/**
 * What the OTP step remembers about the last `POST /auth/otp/request`, shared
 * by `PhoneOtpForm` (partner) and `CustomerAuthScreen` (customer).
 *
 * `maskedPhone` is the API's masked echo and is **display only** — the verify
 * call always sends what the person typed (see `src/test/login-phone.test.tsx`).
 */
export interface OtpSentState {
  maskedPhone: string;
  delivery: OtpDelivery;
  /** Whole minutes the code stays valid, rounded, never below 1. */
  minutes: number;
}

export function otpSentState(result: {
  phone: string;
  expiresInSeconds?: number;
  delivery?: OtpDelivery;
}): OtpSentState {
  const seconds = Number(result.expiresInSeconds);
  return {
    maskedPhone: result.phone,
    // Anything but an explicit `team_relay` keeps the existing "code sent" copy.
    delivery: result.delivery === 'team_relay' ? 'team_relay' : 'automatic',
    minutes: Math.max(1, Math.round((Number.isFinite(seconds) ? seconds : 0) / 60)),
  };
}
