import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../i18n/useT';
import {
  Badge,
  Button,
  Card,
  DetailRow,
  ErrorState,
  QueryState,
  type Tone,
} from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { formatPaise } from '../../../lib/money';
import { CashCollectButton } from '../components/CashCollectButton';
import { OtpKeypad } from '../components/OtpKeypad';
import { QuoteBuilder } from '../components/QuoteBuilder';
import { ReasonPicker } from '../components/ReasonPicker';
import {
  acceptBooking,
  cancelBooking,
  fetchBooking,
  fetchBookingPayments,
  markEnRoute,
  rejectBooking,
  submitEndOtp,
  submitStartOtp,
  withdrawQuotation,
} from '../lib/api';
import { partnerKeys } from '../lib/query-keys';
import { PROVIDER_CANCEL_REASONS, REJECTION_REASONS, type BookingDetail } from '../lib/types';

const QUOTE_STATUS_TONE: Record<string, Tone> = {
  sent: 'info',
  approved: 'success',
  rejected: 'danger',
  superseded: 'neutral',
  withdrawn: 'neutral',
};

/**
 * The API's `payable.components[].labelKey` values (`payable.approvedQuotation`,
 * `payable.priceCard`, `payable.visitFee` — `apps/api/src/modules/quotations/payable.ts`)
 * are not under this surface's `partner.*` namespace, and the foundation's
 * `src/locales/{hi,en}.json` are outside this agent's lane. Rather than
 * reach into a catalog this surface does not control, the three known
 * values are mapped to this surface's own keys here; anything unrecognised
 * falls back to the raw key so a future component kind fails visibly instead
 * of throwing.
 */
function payableComponentLabel(labelKey: string, t: ReturnType<typeof useT>): string {
  if (labelKey === 'payable.approvedQuotation') return t('partner.job.payableApprovedQuotation');
  if (labelKey === 'payable.priceCard') return t('partner.job.payablePriceCard');
  if (labelKey === 'payable.visitFee') return t('partner.job.payableVisitFee');
  return labelKey;
}

function otpErrorDetails(
  error: unknown,
): { message: string; remaining: number | null; locked: boolean } | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== 'BOOKING_OTP_INVALID' && error.code !== 'BOOKING_OTP_LOCKED') return null;

  const details = error.details as { remaining?: number } | null;
  return {
    message: error.message,
    remaining: typeof details?.remaining === 'number' ? details.remaining : null,
    locked: error.code === 'BOOKING_OTP_LOCKED',
  };
}

export default function JobDetail() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const t = useT();
  const queryClient = useQueryClient();

  const [showReject, setShowReject] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  const id = bookingId ?? '';
  const bookingKey = partnerKeys.booking(id);
  const bookingQuery = useQuery({
    queryKey: bookingKey,
    queryFn: () => fetchBooking(id),
    enabled: Boolean(id),
  });

  const invalidateBooking = () => {
    queryClient.invalidateQueries({ queryKey: bookingKey });
    queryClient.invalidateQueries({ queryKey: partnerKeys.bookings('provider') });
  };

  const accept = useMutation({
    mutationFn: () => acceptBooking(id),
    onSuccess: invalidateBooking,
  });
  const reject = useMutation({
    mutationFn: ({ reason, note }: { reason: string; note?: string }) =>
      rejectBooking(id, reason, note),
    onSuccess: () => {
      invalidateBooking();
      setShowReject(false);
    },
  });
  const enRoute = useMutation({
    mutationFn: () => markEnRoute(id),
    onSuccess: invalidateBooking,
  });
  const cancel = useMutation({
    mutationFn: ({ reason, note }: { reason: string; note?: string }) =>
      cancelBooking(id, reason, note),
    onSuccess: () => {
      invalidateBooking();
      setShowCancel(false);
    },
  });

  const startOtp = useMutation({
    mutationFn: (otp: string) => submitStartOtp(id, otp),
    onSuccess: invalidateBooking,
  });
  const endOtp = useMutation({
    mutationFn: (otp: string) => submitEndOtp(id, otp),
    onSuccess: invalidateBooking,
  });
  const withdraw = useMutation({
    mutationFn: (quotationId: string) => withdrawQuotation(quotationId),
    onSuccess: invalidateBooking,
  });

  const paymentsQuery = useQuery({
    queryKey: partnerKeys.payments(id),
    queryFn: () => fetchBookingPayments(id),
    enabled: bookingQuery.data
      ? ['WORK_DONE', 'CLOSED_QUOTE_DECLINED'].includes(bookingQuery.data.booking.status)
      : false,
    refetchInterval: (query) => {
      const payments = query.state.data?.payments ?? [];
      return payments.some((payment) => payment.status === 'created') ? 5_000 : false;
    },
  });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <QueryState
        status={bookingQuery.status}
        error={bookingQuery.error}
        data={bookingQuery.data}
        onRetry={() => bookingQuery.refetch()}
      >
        {({ booking }: { booking: BookingDetail }) => (
          <>
            <Card
              title={t('partner.job.title')}
              actions={<Badge tone="info">{t(`partner.jobs.status.${booking.status}`)}</Badge>}
            >
              <DetailRow label={t('partner.job.timeLabel')}>
                {new Date(booking.startsAt).toLocaleString('hi-IN', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </DetailRow>
              <DetailRow label={t('partner.job.problemLabel')}>
                {booking.problemNote ?? t('partner.jobs.noProblemNote')}
              </DetailRow>
              {booking.address ? (
                <DetailRow label={t('partner.job.addressLabel')}>
                  {booking.address.addressText}
                  {booking.address.landmark ? ` (${booking.address.landmark})` : ''}
                </DetailRow>
              ) : null}
              {booking.counterpart.name ? (
                <DetailRow label={t('partner.job.customerLabel')}>
                  {booking.counterpart.name}
                  {booking.counterpart.phoneRevealed && booking.counterpart.phone ? (
                    <a
                      href={`tel:${booking.counterpart.phone}`}
                      className="ml-2 font-medium text-brand"
                    >
                      {booking.counterpart.phone}
                    </a>
                  ) : null}
                </DetailRow>
              ) : null}
            </Card>

            {booking.status === 'REQUESTED' ? (
              <div className="flex gap-2">
                <Button variant="danger" fullWidth onClick={() => setShowReject(true)}>
                  {t('partner.job.reject')}
                </Button>
                <Button
                  variant="primary"
                  fullWidth
                  disabled={accept.isPending}
                  onClick={() => accept.mutate()}
                >
                  {accept.isPending ? t('partner.job.accepting') : t('partner.job.accept')}
                </Button>
              </div>
            ) : null}
            {accept.isError ? (
              <ErrorState error={accept.error} onRetry={() => accept.reset()} />
            ) : null}

            {(booking.status === 'ACCEPTED' || booking.status === 'EN_ROUTE') && (
              <Card title={t('partner.job.onTheWayTitle')}>
                {booking.status === 'ACCEPTED' ? (
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={enRoute.isPending}
                    onClick={() => enRoute.mutate()}
                  >
                    {enRoute.isPending
                      ? t('partner.job.markingEnRoute')
                      : t('partner.job.markEnRoute')}
                  </Button>
                ) : (
                  <p className="text-sm font-medium text-slate-600">
                    {t('partner.job.enRouteConfirmed')}
                  </p>
                )}

                <p className="mt-4 text-center text-base font-medium text-slate-700">
                  {t('partner.job.enterStartOtp')}
                </p>
                <div className="mt-2">
                  <OtpKeypad
                    pending={startOtp.isPending}
                    error={
                      otpErrorDetails(startOtp.error)?.message ??
                      (startOtp.isError && startOtp.error instanceof ApiError
                        ? startOtp.error.message
                        : null)
                    }
                    remainingAttempts={otpErrorDetails(startOtp.error)?.remaining ?? null}
                    onSubmit={(otp) => startOtp.mutate(otp)}
                  />
                </div>

                <Button
                  variant="ghost"
                  fullWidth
                  className="mt-4"
                  onClick={() => setShowCancel(true)}
                >
                  {t('partner.job.cancelBooking')}
                </Button>
              </Card>
            )}

            {booking.status === 'IN_PROGRESS' && (
              <>
                <Card title={t('partner.job.quotesTitle')}>
                  {booking.quotations.length === 0 ? (
                    <p className="text-sm text-muted">{t('partner.job.noQuotesYet')}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {booking.quotations.map((quote) => (
                        <li key={quote.id} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-700">
                              {t('partner.job.quoteVersion', { v: quote.version })}
                            </span>
                            <Badge tone={QUOTE_STATUS_TONE[quote.status] ?? 'neutral'}>
                              {t(`partner.job.quoteStatus.${quote.status}`)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-right text-lg font-semibold tabular-nums">
                            {quote.totalDisplay}
                          </p>
                          {quote.status === 'sent' ? (
                            <Button
                              variant="ghost"
                              disabled={withdraw.isPending}
                              onClick={() => withdraw.mutate(quote.id)}
                            >
                              {t('partner.job.withdrawQuote')}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {!booking.approvedQuotation ? (
                  <Card title={t('partner.job.newQuoteTitle')}>
                    <QuoteBuilder bookingId={id} onSent={invalidateBooking} />
                  </Card>
                ) : null}

                <Card title={t('partner.job.finishTitle')}>
                  {booking.approvedQuotation ? (
                    <p className="mb-3 text-sm text-green-700">{t('partner.job.priceAgreed')}</p>
                  ) : (
                    <p className="mb-3 text-sm text-amber-700">
                      {t('partner.job.priceNotAgreedHint')}
                    </p>
                  )}
                  <p className="text-center text-base font-medium text-slate-700">
                    {t('partner.job.enterEndOtp')}
                  </p>
                  <div className="mt-2">
                    <OtpKeypad
                      pending={endOtp.isPending}
                      error={
                        otpErrorDetails(endOtp.error)?.message ??
                        (endOtp.isError && endOtp.error instanceof ApiError
                          ? endOtp.error.message
                          : null)
                      }
                      remainingAttempts={otpErrorDetails(endOtp.error)?.remaining ?? null}
                      onSubmit={(otp) => endOtp.mutate(otp)}
                    />
                  </div>
                </Card>
              </>
            )}

            {(booking.status === 'WORK_DONE' || booking.status === 'CLOSED_QUOTE_DECLINED') && (
              <Card title={t('partner.job.payableTitle')}>
                {booking.payable ? (
                  <ul className="mb-3 flex flex-col gap-1">
                    {booking.payable.components.map((component, index) => (
                      <li key={index} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">
                          {payableComponentLabel(component.labelKey, t)}
                          {component.waived ? ` (${t('partner.job.waived')})` : ''}
                        </span>
                        <span className="tabular-nums text-slate-900">
                          {formatPaise(component.amountPaise)}
                        </span>
                      </li>
                    ))}
                    <li className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1 text-base font-semibold">
                      <span>{t('partner.job.totalPayable')}</span>
                      <span className="tabular-nums">{booking.payable.payableDisplay}</span>
                    </li>
                  </ul>
                ) : null}

                <QueryState
                  status={paymentsQuery.status}
                  error={paymentsQuery.error}
                  data={paymentsQuery.data}
                  onRetry={() => paymentsQuery.refetch()}
                >
                  {({ payments }) => {
                    const settled = payments.some(
                      (p) =>
                        p.status === 'captured' ||
                        p.status === 'refunded' ||
                        p.status === 'partially_refunded',
                    );
                    if (settled) {
                      return (
                        <p className="text-sm font-medium text-green-700">
                          {t('partner.job.alreadyPaid')}
                        </p>
                      );
                    }
                    if (payments.some((payment) => payment.status === 'created')) {
                      return (
                        <p className="text-sm font-medium text-amber-700">
                          {t('partner.job.paymentPending')}
                        </p>
                      );
                    }
                    if (!booking.payablePaise || booking.payablePaise <= 0) return null;
                    return <CashCollectButton bookingId={id} amountPaise={booking.payablePaise} />;
                  }}
                </QueryState>
              </Card>
            )}
          </>
        )}
      </QueryState>

      {showReject && bookingQuery.data ? (
        <ReasonPicker
          title={t('partner.job.rejectTitle')}
          reasons={REJECTION_REASONS}
          reasonLabelKey="partner.job.rejectReason"
          onClose={() => setShowReject(false)}
          pending={reject.isPending}
          error={reject.error}
          onSubmit={(reasonCode, note) => reject.mutate({ reason: reasonCode, note })}
        />
      ) : null}

      {showCancel && bookingQuery.data ? (
        <ReasonPicker
          title={t('partner.job.cancelTitle')}
          reasons={PROVIDER_CANCEL_REASONS}
          reasonLabelKey="partner.job.cancelReason"
          onClose={() => setShowCancel(false)}
          pending={cancel.isPending}
          error={cancel.error}
          onSubmit={(reasonCode, note) => cancel.mutate({ reason: reasonCode, note })}
        />
      ) : null}
    </div>
  );
}
