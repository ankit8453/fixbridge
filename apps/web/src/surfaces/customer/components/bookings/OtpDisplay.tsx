import { useT } from '@/i18n/useT';
import { otpDisplayFor } from './otp-display';
import { IconHandshake, IconDone } from './BookingIcons';
import { Avatar } from '@/components/ui';
import type { BookingStatus } from '@/surfaces/customer/data/types';

/**
 * The handshake panel — the single most important thing on the booking screen.
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
 * ## Why this one panel is allowed to be loud
 *
 * Everywhere else on this surface the rule is fewer containers, quieter type.
 * This is the deliberate exception: it is read at arm's length, through a
 * half-open door, often by somebody who has never used the app before, and it
 * has to be found on the page in under a second. So it gets the deep plum
 * ground, the largest type in the product, and a spaced digit grid that can be
 * read aloud one numeral at a time without losing your place.
 *
 * The two states are visually distinct on purpose. Reading the *closing* code
 * out before the work is finished is the one mistake that costs the customer
 * real money, so the end-of-job panel is a different colour and carries a
 * warning rather than an invitation — a customer must never be able to act on
 * muscle memory from the arrival handshake.
 *
 * `photoUrl` is null far more often than not — no photo uploaded, one still
 * awaiting moderation, or a booking not yet accepted — so `Avatar` falling back
 * to initials is the normal path, not the error path.
 *
 * Which code shows in which state is decided entirely by `otpDisplayFor` and is
 * not re-derived here; see that file for why it gates on status rather than on
 * which field happens to be non-null.
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

  const isStart = state.kind === 'start';
  const heading = isStart ? t('app.booking.startOtpHeading') : t('app.booking.endOtpHeading');
  const hint = isStart ? t('app.booking.startOtpHint') : t('app.booking.endOtpHint');

  return (
    <div
      role="status"
      data-otp-kind={state.kind}
      className={`overflow-hidden rounded-2xl text-white shadow-lg ${
        isStart ? 'bg-shop' : 'bg-shop-deep'
      }`}
    >
      <div className="flex items-center gap-2 border-b border-white/15 px-4 py-2.5">
        {isStart ? (
          <IconHandshake className="h-[18px] w-[18px] shrink-0" />
        ) : (
          <IconDone className="h-[18px] w-[18px] shrink-0" />
        )}
        <p className="text-[13px] font-semibold leading-tight">{heading}</p>
      </div>

      <div className="px-4 pb-4 pt-3.5 text-center">
        {/*
          Only on the *start* handshake. By `IN_PROGRESS` the technician is
          already inside and working — the identity check has happened, and
          repeating it while asking for the closing code would just be noise.
        */}
        {isStart && (providerPhotoUrl || providerName) ? (
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5 text-left">
            <Avatar name={providerName} src={providerPhotoUrl} size={44} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight">
                {providerName ?? t('app.find.unnamedProvider')}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-white/75">
                {t('app.booking.photoVerifyHint')}
              </p>
            </div>
          </div>
        ) : null}

        {/*
          One box per digit rather than one letter-spaced string. A customer
          reading four numerals aloud to somebody at the door keeps their place
          far more easily when the digits are physically separated, and the
          separation survives being photographed and sent on WhatsApp — which
          is what actually happens when the person at the door is not the one
          holding the phone.

          `state.code` is split rather than assumed four characters long: the
          API owns the code length, and a five-digit code should render as five
          boxes, not silently truncate.
        */}
        <p className="flex items-center justify-center gap-1.5 sm:gap-2" aria-hidden="true">
          {state.code.split('').map((digit, index) => (
            <span
              key={index}
              className="flex h-14 w-11 items-center justify-center rounded-xl bg-white/95 text-[30px] font-bold leading-none tabular-nums text-shop-deep shadow-sm sm:h-16 sm:w-12 sm:text-[34px]"
            >
              {digit}
            </span>
          ))}
        </p>
        {/*
          The whole code once, for a screen reader and for the test matrix —
          the per-digit boxes above are `aria-hidden` because a reader
          announcing "one, two, three, four" as four separate elements is
          harder to act on than one spoken number.
        */}
        <span className="sr-only">{state.code}</span>

        <p
          className={`mx-auto mt-3 max-w-sm text-[12.5px] leading-relaxed ${
            isStart ? 'text-white/80' : 'font-medium text-white/90'
          }`}
        >
          {hint}
        </p>
      </div>
    </div>
  );
}
