import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useBookingDetail } from '@/surfaces/customer/data/bookings';
import { useBookingPayments, derivePaymentState } from '@/surfaces/customer/data/payments';
import { istDateLabel, istDayOfWeekKey, istTime } from '@/surfaces/customer/data/ist-date';
import { BILLABLE_STATUSES } from '@/surfaces/customer/data/booking-status';
import { OtpDisplay } from '@/surfaces/customer/components/bookings/OtpDisplay';
import { BookingTimeline } from '@/surfaces/customer/components/bookings/BookingTimeline';
import { QuoteCard } from '@/surfaces/customer/components/bookings/QuoteCard';
import { statusTheme } from '@/surfaces/customer/components/bookings/status-theme';
import {
  BookingStatusIcon,
  IconLocked,
  IconNote,
  IconPhone,
  IconWhere,
} from '@/surfaces/customer/components/bookings/BookingIcons';
import {
  CancelDialog,
  canCancelBooking,
} from '@/surfaces/customer/components/bookings/CancelDialog';
import {
  DeclineWorkDialog,
  canDeclineWork,
} from '@/surfaces/customer/components/bookings/DeclineWorkDialog';
import { PaymentPanel } from '@/surfaces/customer/components/bookings/PaymentPanel';
import { ReviewForm } from '@/surfaces/customer/components/bookings/ReviewForm';
import { canRaiseComplaint } from '@/surfaces/customer/components/bookings/ComplaintForm';
import { Avatar, ErrorState, Skeleton } from '@/components/ui';

/**
 * One fact about the job, with its own drawn glyph.
 *
 * A `<dl>` of label/value rows made every fact the same size and shape, so the
 * phone number — the only one on this list a customer ever needs in a hurry —
 * was as easy to miss as the category id. Icon-led rows let the eye find the
 * handset without reading, and the value is the emphasised half rather than the
 * label.
 */
function Fact({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 shrink-0 text-shop-ink-soft" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-shop-ink-soft">
          {label}
        </p>
        <div className="mt-0.5 text-sm leading-snug text-shop-ink">{children}</div>
      </div>
    </div>
  );
}

/** Holds the page's shape while the booking loads — see `Bookings.tsx` on why not a spinner. */
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-44 w-full rounded-2xl" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}

/**
 * `/app/bookings/:bookingId` — mission control for one job.
 *
 * ## The order of this page is the order of the customer's questions
 *
 * 1. **What is happening?** — the status header, colour-coded from the same
 *    `statusTheme` the list card uses, so the booking a customer just tapped
 *    keeps its colour rather than turning blue on arrival.
 * 2. **What do I do right now?** — the OTP handshake, or the quote awaiting a
 *    decision, or the bill. Whatever the job's state demands next is the first
 *    thing under the header, above every reference detail.
 * 3. **Who is coming, and where?** — the technician panel.
 * 4. **What happened so far** and the ways out — the timeline, then the
 *    destructive actions last, where they cannot be hit by accident.
 *
 * The previous version led with the date, put the OTP under a plain grey box,
 * and stacked five `Card`s of equal weight, so an arriving technician's code
 * and the read-only event log looked equally urgent.
 *
 * Phone and address come from the API already redacted — `phoneRevealed` is
 * false and `phone` is null before acceptance, and `photoUrl` is withheld until
 * ops approves it. Nothing here re-derives that gating; the page renders an
 * honest "not yet" instead.
 */
export default function BookingDetail() {
  const t = useT();
  const locale = useLocale();
  const { bookingId } = useParams<{ bookingId: string }>();
  const id = bookingId ?? '';
  const query = useBookingDetail(id);
  const paymentsQuery = useBookingPayments(id);

  const [showCancel, setShowCancel] = useState(false);
  const [showDecline, setShowDecline] = useState(false);

  if (query.status === 'pending') {
    return (
      <div className="w-full">
        <DetailSkeleton />
      </div>
    );
  }

  if (query.status === 'error' || query.data === undefined) {
    return (
      <div className="w-full">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const { booking } = query.data;
  const hasPending = Boolean(booking.pendingQuotation);
  const hasApproved = Boolean(booking.approvedQuotation);
  const paymentState = derivePaymentState(paymentsQuery.data?.payments ?? []);
  const isPaid = paymentState.kind === 'captured' || paymentState.kind === 'cash_recorded';
  const theme = statusTheme(booking.status);

  const canCancel = canCancelBooking(booking.status);
  const canDecline = canDeclineWork(booking.status, hasPending, hasApproved);
  const canComplain = canRaiseComplaint(booking.status);
  const hasExits = canCancel || canDecline || canComplain;

  return (
    <div className="flex w-full flex-col gap-4">
      {/* ---------------- 1. What is happening ---------------- */}
      <header className={`flex items-center gap-3 rounded-xl ${theme.chip} px-4 py-3`}>
        <span className={`shrink-0 ${theme.ink}`} aria-hidden="true">
          <BookingStatusIcon status={booking.status} className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h1 className={`text-[17px] font-bold leading-tight tracking-tight ${theme.ink}`}>
            {t(`app.bookingStatus.${booking.status}`)}
          </h1>
          <p className="mt-0.5 text-[13px] text-shop-ink-soft">
            {t(istDayOfWeekKey(booking.startsAt))} · {istDateLabel(booking.startsAt)} ·{' '}
            {istTime(booking.startsAt)}
          </p>
        </div>
      </header>

      {/* ---------------- 2. What to do right now ----------------
          The handshake renders itself away outside ACCEPTED…IN_PROGRESS (see
          `otp-display.ts`), so no status check is repeated here. */}
      <OtpDisplay
        status={booking.status}
        startOtp={booking.startOtp}
        endOtp={booking.endOtp}
        providerName={booking.counterpart.name}
        providerPhotoUrl={booking.counterpart.photoUrl}
      />

      {booking.quotations.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[15px] font-bold tracking-tight text-shop-ink">
            {t('app.booking.quotesHeading')}
          </h2>
          {/* Newest first: a superseded version is history, and the one
              awaiting a decision must never be below the fold. */}
          {[...booking.quotations].reverse().map((quotation) => (
            <QuoteCard
              key={quotation.id}
              bookingId={id}
              quotation={quotation}
              isPending={quotation.id === booking.pendingQuotation?.id}
            />
          ))}
        </section>
      ) : null}

      {BILLABLE_STATUSES.has(booking.status) && booking.payable ? (
        <PaymentPanel bookingId={id} payable={booking.payable} />
      ) : null}

      {booking.status === 'WORK_DONE' && isPaid ? <ReviewForm bookingId={id} /> : null}

      {/* ---------------- 3. Who is coming, and where ---------------- */}
      <section className="overflow-hidden rounded-xl border border-shop-line bg-white">
        <div className="flex items-center gap-3 border-b border-shop-line px-4 py-3">
          {/*
            The same face again, lower down the page. Deliberate repetition
            rather than a choice between the two placements: the OTP box
            disappears once work is under way, and a customer scrolling back to
            check who they let in still needs a face to check against.

            `photoUrl` is only ever non-null once the booking is accepted AND
            ops approved the photo — the API withholds it otherwise, so there is
            nothing to gate on here.
          */}
          <Avatar name={booking.counterpart.name} src={booking.counterpart.photoUrl} size={44} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-shop-ink">
              {booking.counterpart.name ?? t('app.find.unnamedProvider')}
            </p>
            <p className="mt-0.5 text-xs text-shop-ink-soft">{t('app.booking.photoCaption')}</p>
          </div>
        </div>

        <div className="divide-y divide-shop-line px-4 py-1">
          <Fact
            icon={<IconPhone className="h-[18px] w-[18px]" />}
            label={t('app.booking.providerPhone')}
          >
            {booking.counterpart.phoneRevealed && booking.counterpart.phone ? (
              /* A real tel: link, because the moment this number exists is the
                 moment somebody wants to dial it without retyping it. */
              <a
                href={`tel:${booking.counterpart.phone}`}
                className="inline-flex items-center gap-1.5 font-semibold text-shop underline-offset-2 hover:underline"
              >
                {booking.counterpart.phone}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-shop-ink-soft">
                <IconLocked className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('app.booking.phoneHiddenYet')}
              </span>
            )}
          </Fact>

          {booking.address ? (
            <Fact
              icon={<IconWhere className="h-[18px] w-[18px]" />}
              label={t('app.booking.address')}
            >
              {booking.address.addressText}
              {booking.address.landmark ? (
                <span className="block text-shop-ink-soft">{booking.address.landmark}</span>
              ) : null}
            </Fact>
          ) : null}

          {booking.problemNote ? (
            <Fact
              icon={<IconNote className="h-[18px] w-[18px]" />}
              label={t('app.booking.problemNote')}
            >
              {booking.problemNote}
            </Fact>
          ) : null}
        </div>
      </section>

      {/* ---------------- 4. History ---------------- */}
      {booking.events.length > 0 ? (
        <section className="rounded-xl border border-shop-line bg-white px-4 py-3">
          <h2 className="mb-2.5 text-[13px] font-semibold text-shop-ink">
            {t('app.booking.timelineHeading')}
          </h2>
          <BookingTimeline events={booking.events} />
        </section>
      ) : null}

      {/* ---------------- 5. The ways out ----------------
          Last on the page, quiet, and separated by a rule. These are the three
          irreversible things a customer can do; none of them should ever be the
          nearest control to a thumb resting at the bottom of the screen. */}
      {hasExits ? (
        <div className="flex flex-col items-stretch gap-1 border-t border-shop-line pt-3">
          {canDecline ? (
            <button
              type="button"
              onClick={() => setShowDecline(true)}
              className="min-h-touch rounded-xl border border-shop-line bg-white text-sm font-semibold text-shop-ink transition-colors hover:bg-shop-soft/50"
            >
              {t('app.booking.declineWork')}
            </button>
          ) : null}

          {canCancel ? (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="min-h-touch text-sm font-medium text-shop-ink-soft underline-offset-2 hover:underline"
            >
              {t('app.booking.cancelBooking')}
            </button>
          ) : null}

          {canComplain ? (
            <Link
              to={buildLocalizedHref(locale, `/app/bookings/${id}/complaint`)}
              className="min-h-touch flex items-center justify-center text-sm font-medium text-shop-ink-soft underline-offset-2 hover:underline"
            >
              {t('app.booking.raiseComplaint')}
            </Link>
          ) : null}
        </div>
      ) : null}

      {showCancel ? <CancelDialog bookingId={id} onClose={() => setShowCancel(false)} /> : null}
      {showDecline ? (
        <DeclineWorkDialog
          bookingId={id}
          visitFeePaise={booking.visitFeePaise}
          onClose={() => setShowDecline(false)}
        />
      ) : null}
    </div>
  );
}
