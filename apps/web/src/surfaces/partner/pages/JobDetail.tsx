import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, MapPin, Phone, Wallet } from 'lucide-react';
import { useLocale, useT } from '../../../i18n/useT';
import { Button, ErrorState, QueryState } from '../../../components/ui';
import { DetailRow, Panel, StatusPill, type Tone } from '../components/ui';
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
import {
  PROVIDER_CANCEL_REASONS,
  REJECTION_REASONS,
  type BookingDetail,
  type BookingStatus,
} from '../lib/types';

const QUOTE_STATUS_TONE: Record<string, Tone> = {
  sent: 'brand',
  approved: 'success',
  rejected: 'danger',
  superseded: 'neutral',
  withdrawn: 'neutral',
};

const STATUS_TONE: Record<BookingStatus, Tone> = {
  REQUESTED: 'warning',
  ACCEPTED: 'brand',
  EN_ROUTE: 'brand',
  ARRIVED: 'brand',
  IN_PROGRESS: 'brand',
  WORK_DONE: 'success',
  REJECTED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED_BY_CUSTOMER: 'neutral',
  CANCELLED_BY_PROVIDER: 'danger',
  CLOSED_QUOTE_DECLINED: 'warning',
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

/**
 * The OTP handshake, boxed and tinted.
 *
 * The start and end codes are the two moments where the technician is
 * standing in front of the customer waiting to be read four digits, so the
 * keypad gets a tinted, bordered frame of its own rather than sitting as one
 * more paragraph in a card — it has to be findable at a glance, mid-job.
 */
function OtpPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-brand/25 bg-brand/5 p-4">
      <p className="flex items-center justify-center gap-2 text-center text-base font-semibold text-slate-800">
        <KeyRound className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" strokeWidth={2} />
        {title}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export default function JobDetail() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const locale = useLocale();
  const t = useT();
  /**
   * Dates follow the reader, not the country.
   *
   * This screen hardcoded 'hi-IN', so a technician reading English still got
   * Hindi-formatted dates on the one screen they look at mid-job. Every other
   * screen already derived it from the active locale.
   */
  const intlLocale = locale === 'hi' ? 'hi-IN' : 'en-IN';
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
    <div className="flex flex-col gap-4 lg:gap-5">
      <QueryState
        status={bookingQuery.status}
        error={bookingQuery.error}
        data={bookingQuery.data}
        onRetry={() => bookingQuery.refetch()}
        loadingLabel={t('partner.common.loading')}
      >
        {({ booking }: { booking: BookingDetail }) => (
          /* Two columns from `lg`: the job's facts and the money on the left,
             the action the technician has to take right now on the right, so
             the OTP keypad is never below the fold on a laptop. */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-5">
            <div className="flex flex-col gap-4 lg:col-span-3 lg:gap-5">
              <Panel
                title={t('partner.job.title')}
                action={
                  <StatusPill tone={STATUS_TONE[booking.status]}>
                    {t(`partner.jobs.status.${booking.status}`)}
                  </StatusPill>
                }
              >
                <dl>
                  <DetailRow label={t('partner.job.timeLabel')}>
                    {new Date(booking.startsAt).toLocaleString(intlLocale, {
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
                      <span className="flex items-start gap-2">
                        <MapPin
                          className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                          aria-hidden="true"
                          strokeWidth={1.75}
                        />
                        <span>
                          {booking.address.addressText}
                          {booking.address.landmark ? ` (${booking.address.landmark})` : ''}
                        </span>
                      </span>
                    </DetailRow>
                  ) : null}
                  {booking.counterpart.name ? (
                    <DetailRow label={t('partner.job.customerLabel')}>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{booking.counterpart.name}</span>
                        {/* The number is only present once the API has decided
                            to reveal it; both halves of that guard stay. */}
                        {booking.counterpart.phoneRevealed && booking.counterpart.phone ? (
                          <a
                            href={`tel:${booking.counterpart.phone}`}
                            className="inline-flex min-h-touch items-center gap-1.5 rounded-lg bg-brand/10 px-3 text-sm font-semibold text-brand transition-opacity hover:opacity-80"
                          >
                            <Phone className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
                            {booking.counterpart.phone}
                          </a>
                        ) : null}
                      </span>
                    </DetailRow>
                  ) : null}
                </dl>
              </Panel>

              {booking.status === 'IN_PROGRESS' && (
                <>
                  <Panel title={t('partner.job.quotesTitle')}>
                    {booking.quotations.length === 0 ? (
                      <p className="text-sm text-muted">{t('partner.job.noQuotesYet')}</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {booking.quotations.map((quote) => (
                          <li
                            key={quote.id}
                            className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-medium text-slate-700">
                                {t('partner.job.quoteVersion', { v: quote.version })}
                              </span>
                              <StatusPill tone={QUOTE_STATUS_TONE[quote.status] ?? 'neutral'}>
                                {t(`partner.job.quoteStatus.${quote.status}`)}
                              </StatusPill>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-lg font-semibold tabular-nums text-slate-900">
                                {quote.totalDisplay}
                              </p>
                              {quote.status === 'sent' ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={withdraw.isPending}
                                  onClick={() => withdraw.mutate(quote.id)}
                                >
                                  {t('partner.job.withdrawQuote')}
                                </Button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>

                  {!booking.approvedQuotation ? (
                    <Panel title={t('partner.job.newQuoteTitle')}>
                      <QuoteBuilder bookingId={id} onSent={invalidateBooking} />
                    </Panel>
                  ) : null}
                </>
              )}

              {(booking.status === 'WORK_DONE' || booking.status === 'CLOSED_QUOTE_DECLINED') && (
                <Panel
                  title={t('partner.job.payableTitle')}
                  action={
                    <Wallet
                      className="h-4 w-4 text-slate-400"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                  }
                >
                  {booking.payable ? (
                    <ul className="mb-4 flex flex-col gap-1.5">
                      {booking.payable.components.map((component, index) => (
                        <li key={index} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-slate-600">
                            {payableComponentLabel(component.labelKey, t)}
                            {component.waived ? ` (${t('partner.job.waived')})` : ''}
                          </span>
                          <span className="shrink-0 tabular-nums text-slate-900">
                            {formatPaise(component.amountPaise)}
                          </span>
                        </li>
                      ))}
                      {/* The total is the number that gets said out loud to the
                          customer, so it is the largest thing in this panel. */}
                      <li className="mt-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                        <span className="text-sm font-semibold text-slate-700">
                          {t('partner.job.totalPayable')}
                        </span>
                        <span className="text-2xl font-bold tabular-nums text-slate-900">
                          {booking.payable.payableDisplay}
                        </span>
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
                          <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm font-medium text-success">
                            <CheckCircle2
                              className="h-4 w-4 shrink-0"
                              aria-hidden="true"
                              strokeWidth={2}
                            />
                            {t('partner.job.alreadyPaid')}
                          </p>
                        );
                      }
                      if (payments.some((payment) => payment.status === 'created')) {
                        return (
                          <p className="rounded-lg bg-warning/10 px-3 py-2.5 text-sm font-medium text-warning">
                            {t('partner.job.paymentPending')}
                          </p>
                        );
                      }
                      if (!booking.payablePaise || booking.payablePaise <= 0) return null;
                      return (
                        <CashCollectButton bookingId={id} amountPaise={booking.payablePaise} />
                      );
                    }}
                  </QueryState>
                </Panel>
              )}
            </div>

            {/* ---------------- Action column ---------------- */}
            <div className="flex flex-col gap-4 lg:col-span-2 lg:gap-5">
              {booking.status === 'REQUESTED' ? (
                <Panel title={t('partner.job.title')}>
                  <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                    <Button
                      variant="primary"
                      fullWidth
                      disabled={accept.isPending}
                      onClick={() => accept.mutate()}
                    >
                      {accept.isPending ? t('partner.job.accepting') : t('partner.job.accept')}
                    </Button>
                    <Button variant="danger" fullWidth onClick={() => setShowReject(true)}>
                      {t('partner.job.reject')}
                    </Button>
                  </div>
                  {accept.isError ? (
                    <div className="mt-3">
                      <ErrorState error={accept.error} onRetry={() => accept.reset()} />
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {(booking.status === 'ACCEPTED' || booking.status === 'EN_ROUTE') && (
                <Panel title={t('partner.job.onTheWayTitle')}>
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
                    <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm font-medium text-success">
                      <CheckCircle2
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                        strokeWidth={2}
                      />
                      {t('partner.job.enRouteConfirmed')}
                    </p>
                  )}

                  <div className="mt-4">
                    <OtpPanel title={t('partner.job.enterStartOtp')}>
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
                    </OtpPanel>
                  </div>

                  <Button
                    variant="ghost"
                    fullWidth
                    className="mt-4"
                    onClick={() => setShowCancel(true)}
                  >
                    {t('partner.job.cancelBooking')}
                  </Button>
                </Panel>
              )}

              {booking.status === 'IN_PROGRESS' && (
                <Panel title={t('partner.job.finishTitle')}>
                  {booking.approvedQuotation ? (
                    <p className="mb-3 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm font-medium text-success">
                      <CheckCircle2
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                        strokeWidth={2}
                      />
                      {t('partner.job.priceAgreed')}
                    </p>
                  ) : (
                    <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2.5 text-sm font-medium text-warning">
                      {t('partner.job.priceNotAgreedHint')}
                    </p>
                  )}

                  <OtpPanel title={t('partner.job.enterEndOtp')}>
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
                  </OtpPanel>
                </Panel>
              )}
            </div>
          </div>
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
