import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useBookingDetail } from '@/surfaces/customer/data/bookings';
import { useBookingPayments, derivePaymentState } from '@/surfaces/customer/data/payments';
import { istDateLabel, istTime } from '@/surfaces/customer/data/ist-date';
import { BILLABLE_STATUSES } from '@/surfaces/customer/data/booking-status';
import { OtpDisplay } from '@/surfaces/customer/components/bookings/OtpDisplay';
import { BookingTimeline } from '@/surfaces/customer/components/bookings/BookingTimeline';
import { QuoteCard } from '@/surfaces/customer/components/bookings/QuoteCard';
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
import { Avatar, Badge, Button, Card, DetailRow, QueryState } from '@/components/ui';

/**
 * `/app/bookings/:bookingId` — mission control: status timeline, provider
 * info with phone reveal after acceptance, start/end OTP, quote
 * approve/reject, decline-work, cancel with reason codes, payment.
 * Ported from `legacy-next-src/app/[locale]/app/bookings/[bookingId]/page.tsx`.
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel={t('app.booking.loading')}
        onRetry={() => void query.refetch()}
      >
        {({ booking }) => {
          const hasPending = Boolean(booking.pendingQuotation);
          const hasApproved = Boolean(booking.approvedQuotation);
          const paymentState = derivePaymentState(paymentsQuery.data?.payments ?? []);
          const isPaid = paymentState.kind === 'captured' || paymentState.kind === 'cash_recorded';

          return (
            <>
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold text-slate-900">
                  {istDateLabel(booking.startsAt)} · {istTime(booking.startsAt)}
                </h1>
                <Badge tone="info">{t(`app.bookingStatus.${booking.status}`)}</Badge>
              </div>

              <OtpDisplay
                status={booking.status}
                startOtp={booking.startOtp}
                endOtp={booking.endOtp}
                providerName={booking.counterpart.name}
                providerPhotoUrl={booking.counterpart.photoUrl}
              />

              <Card title={t('app.booking.providerHeading')}>
                {/*
                  The same face again, at the top of the technician's card.
                  Deliberate repetition rather than a choice between the two
                  placements: the OTP box disappears once work is under way, and
                  a customer scrolling back to check who they let in still needs
                  a face to check against.

                  `photoUrl` is only ever non-null once the booking is accepted
                  AND ops approved the photo — the API withholds it otherwise, so
                  there is nothing to gate on here.
                */}
                {booking.counterpart.photoUrl ? (
                  <div className="mb-3 flex items-center gap-3">
                    <Avatar
                      name={booking.counterpart.name}
                      src={booking.counterpart.photoUrl}
                      size={48}
                    />
                    <p className="text-sm text-slate-600">{t('app.booking.photoCaption')}</p>
                  </div>
                ) : null}

                <dl>
                  <DetailRow label={t('app.booking.providerName')}>
                    {booking.counterpart.name ?? t('app.find.unnamedProvider')}
                  </DetailRow>
                  <DetailRow label={t('app.booking.providerPhone')}>
                    {booking.counterpart.phoneRevealed && booking.counterpart.phone ? (
                      <a
                        href={`tel:${booking.counterpart.phone}`}
                        className="font-medium text-brand"
                      >
                        {booking.counterpart.phone}
                      </a>
                    ) : (
                      t('app.booking.phoneHiddenYet')
                    )}
                  </DetailRow>
                  {booking.address ? (
                    <DetailRow label={t('app.booking.address')}>
                      {booking.address.addressText}
                      {booking.address.landmark ? ` (${booking.address.landmark})` : ''}
                    </DetailRow>
                  ) : null}
                  {booking.problemNote ? (
                    <DetailRow label={t('app.booking.problemNote')}>
                      {booking.problemNote}
                    </DetailRow>
                  ) : null}
                </dl>
              </Card>

              {booking.quotations.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-base font-semibold text-slate-900">
                    {t('app.booking.quotesHeading')}
                  </h2>
                  {[...booking.quotations].reverse().map((quotation) => (
                    <QuoteCard
                      key={quotation.id}
                      bookingId={id}
                      quotation={quotation}
                      isPending={quotation.id === booking.pendingQuotation?.id}
                    />
                  ))}
                </section>
              )}

              <Card title={t('app.booking.timelineHeading')}>
                <BookingTimeline events={booking.events} />
              </Card>

              {BILLABLE_STATUSES.has(booking.status) && booking.payable ? (
                <PaymentPanel bookingId={id} payable={booking.payable} />
              ) : null}

              {booking.status === 'WORK_DONE' && isPaid ? <ReviewForm bookingId={id} /> : null}

              <div className="flex flex-col gap-2">
                {canDeclineWork(booking.status, hasPending, hasApproved) ? (
                  <Button variant="secondary" fullWidth onClick={() => setShowDecline(true)}>
                    {t('app.booking.declineWork')}
                  </Button>
                ) : null}

                {canCancelBooking(booking.status) ? (
                  <Button variant="ghost" fullWidth onClick={() => setShowCancel(true)}>
                    {t('app.booking.cancelBooking')}
                  </Button>
                ) : null}

                {canRaiseComplaint(booking.status) ? (
                  <Link
                    to={buildLocalizedHref(locale, `/app/bookings/${id}/complaint`)}
                    className="min-h-touch text-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
                  >
                    {t('app.booking.raiseComplaint')}
                  </Link>
                ) : null}
              </div>

              {showCancel ? (
                <CancelDialog bookingId={id} onClose={() => setShowCancel(false)} />
              ) : null}
              {showDecline ? (
                <DeclineWorkDialog
                  bookingId={id}
                  visitFeePaise={booking.visitFeePaise}
                  onClose={() => setShowDecline(false)}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
