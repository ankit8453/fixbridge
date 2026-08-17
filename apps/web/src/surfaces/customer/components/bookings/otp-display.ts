import type { BookingStatus } from '@/surfaces/customer/data/types';

export type OtpDisplayKind = 'start' | 'end' | 'none';

export interface OtpDisplayState {
  kind: OtpDisplayKind;
  code: string | null;
}

/**
 * Which of the two handshake codes is the one a customer needs *right now*,
 * purely a function of booking status — never of which fields happen to be
 * non-null, even though the API's own visibility rule (`docs/API.md`
 * `BookingDetail` field table) already makes `endOtp` null before
 * `IN_PROGRESS`. Two independent reasons to still gate on `status` here
 * rather than trust "is the field present":
 *
 * 1. **The one thing this screen must never get wrong.** Showing the *start*
 *    code once work is already under way would have a customer read out a
 *    code the technician has no use for anymore (it was already spent) while
 *    withholding the *end* code they actually need to close the job — a
 *    real-world failure the phase brief calls out by name.
 * 2. A defensive layer independent of the API's own gating means a bug in
 *    that gating (a stale `startOtp` echoed back after `IN_PROGRESS`, say)
 *    cannot silently make it to the screen — this function still refuses to
 *    show it for the wrong status.
 *
 * Ported verbatim from
 * `legacy-next-src/components/customer/bookings/otp-display.ts` — this is
 * the pure function the regression matrix in `__tests__/otp-display.test.ts`
 * exercises against every `BookingStatus`.
 */
export function otpDisplayFor(
  status: BookingStatus,
  startOtp: string | null,
  endOtp: string | null,
): OtpDisplayState {
  switch (status) {
    case 'ACCEPTED':
    case 'EN_ROUTE':
    case 'ARRIVED':
      return { kind: 'start', code: startOtp };
    case 'IN_PROGRESS':
      return { kind: 'end', code: endOtp };
    default:
      return { kind: 'none', code: null };
  }
}
