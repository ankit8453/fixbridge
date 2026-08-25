import { useT } from '@/i18n/useT';
import { otpDisplayFor } from './otp-display';
import { Avatar } from '@/components/ui';
import type { BookingStatus } from '@/surfaces/customer/data/types';

/**
 * Ported from `legacy-next-src/components/customer/bookings/OtpDisplay.tsx`.
 *
 * The technician's face and name sit **inside this box, above the code**, and
 * that placement is the point of the feature rather than a layout preference.
 *
 * The moment this box exists for is the one where somebody is standing at the
 * door asking for a number. What the customer actually has to decide then is not
 * "what is my code" but "is this the person the app sent me" — and a photo on a
 * card further down the page is not in front of them while they decide. Photo,
 * name and code in one glance is the whole handshake.
 *
 * `photoUrl` is null far more often than not — no photo uploaded, one still
 * awaiting moderation, or a booking not yet accepted — so `Avatar` falling back
 * to initials is the normal path, not the error path.
 */
export function OtpDisplay({
  status,
  startOtp,
  endOtp,
  providerName,
  providerPhotoUrl,
}: {
  status: BookingStatus;
  startOtp: string | null;
  endOtp: string | null;
  providerName?: string | null;
  providerPhotoUrl?: string | null;
}) {
  const t = useT();
  const state = otpDisplayFor(status, startOtp, endOtp);

  if (state.kind === 'none' || !state.code) return null;

  const heading =
    state.kind === 'start' ? t('app.booking.startOtpHeading') : t('app.booking.endOtpHeading');
  const hint = state.kind === 'start' ? t('app.booking.startOtpHint') : t('app.booking.endOtpHint');

  return (
    <div
      role="status"
      className="rounded-xl border-2 border-brand bg-slate-50 px-4 py-3 text-center"
      data-otp-kind={state.kind}
    >
      {/*
        Only on the *start* handshake. By `IN_PROGRESS` the technician is already
        inside and working — the identity check has happened, and repeating it
        while asking for the closing code would just be noise.
      */}
      {state.kind === 'start' && (providerPhotoUrl || providerName) ? (
        <div className="mb-2.5 flex flex-col items-center gap-1.5">
          <Avatar name={providerName} src={providerPhotoUrl} size={56} />
          <p className="text-sm font-semibold text-slate-900">
            {providerName ?? t('app.find.unnamedProvider')}
          </p>
          <p className="text-xs text-slate-600">{t('app.booking.photoVerifyHint')}</p>
        </div>
      ) : null}

      <p className="text-sm font-medium text-slate-700">{heading}</p>
      <p className="my-1 text-4xl font-bold tracking-[0.3em] text-slate-900">{state.code}</p>
      <p className="text-xs text-slate-600">{hint}</p>
    </div>
  );
}
