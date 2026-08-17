'use client';

import { useT } from '@/i18n/useT';
import { otpDisplayFor } from './otp-display';
import type { BookingStatus } from '@/components/customer/data/types';

export function OtpDisplay({
  status,
  startOtp,
  endOtp,
}: {
  status: BookingStatus;
  startOtp: string | null;
  endOtp: string | null;
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
      <p className="text-sm font-medium text-slate-700">{heading}</p>
      <p className="my-1 text-4xl font-bold tracking-[0.3em] text-slate-900">{state.code}</p>
      <p className="text-xs text-slate-600">{hint}</p>
    </div>
  );
}
