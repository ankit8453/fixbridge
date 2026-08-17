'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useT } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { useBookingDetail } from '@/components/customer/data/bookings';
import { useBookingPayments, derivePaymentState } from '@/components/customer/data/payments';
import { istDateLabel, istTime } from '@/components/customer/data/ist-date';
import { BILLABLE_STATUSES } from '@/components/customer/data/booking-status';
import { OtpDisplay } from '@/components/customer/bookings/OtpDisplay';
import { BookingTimeline } from '@/components/customer/bookings/BookingTimeline';
import { QuoteCard } from '@/components/customer/bookings/QuoteCard';
import { CancelDialog, canCancelBooking } from '@/components/customer/bookings/CancelDialog';
import {
  DeclineWorkDialog,
  canDeclineWork,
} from '@/components/customer/bookings/DeclineWorkDialog';
import { PaymentPanel } from '@/components/customer/bookings/PaymentPanel';
import { ReviewForm } from '@/components/customer/bookings/ReviewForm';
import { canRaiseComplaint } from '@/components/customer/bookings/ComplaintForm';
import { Badge, Button, Card, DetailRow, QueryState } from '@/components/ui';

export default function BookingDetailPage() {
  const t = useT();
  const locale = useLocale();
  const { bookingId } = useParams<{ bookingId: string }>();
  const query = useBookingDetail(bookingId);
  const paymentsQuery = useBookingPayments(bookingId);

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
              />

              <Card title={t('app.booking.providerHeading')}>
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
                      bookingId={bookingId}
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
                <PaymentPanel bookingId={bookingId} payable={booking.payable} />
              ) : null}

              {booking.status === 'WORK_DONE' && isPaid ? (
                <ReviewForm bookingId={bookingId} />
              ) : null}

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
                    href={buildLocalizedHref(locale, `/app/bookings/${bookingId}/complaint`)}
                    className="min-h-touch text-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
                  >
                    {t('app.booking.raiseComplaint')}
                  </Link>
                ) : null}
              </div>

              {showCancel ? (
                <CancelDialog bookingId={bookingId} onClose={() => setShowCancel(false)} />
              ) : null}
              {showDecline ? (
                <DeclineWorkDialog
                  bookingId={bookingId}
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
