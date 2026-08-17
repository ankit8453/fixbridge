import { Link } from 'react-router-dom';
import { useT, useLocale } from '@/i18n/useT';
import { buildLocalizedHref } from '@/i18n/config';
import { formatPaise } from '@/lib/money';
import { APP_NAME } from '@/brand/tokens';
import {
  derivePaymentState,
  useBookingPayments,
  useCheckoutCallback,
  useOpenRazorpayCheckout,
  useRazorpayReady,
  useStartPayment,
} from '@/surfaces/customer/data/payments';
import { Button, ErrorState, QueryState } from '@/components/ui';
import type { PayableView } from '@/surfaces/customer/data/types';

/**
 * `PayableView.components[].labelKey` comes from the API's own i18n
 * namespace (`payable.approvedQuotation`, `payable.visitFee` —
 * `docs/API.md` "The frozen bill") — server keys, not this app's. This
 * surface's locale file nests everything under a single top-level `app` key
 * (see `apps/web/README.md`), so the server key is remapped onto this app's
 * own `app.payable.*` copy rather than looked up directly, which would
 * silently fall through to showing the raw key string.
 */
function payableLabelKey(serverKey: string): string {
  return `app.${serverKey}`;
}

/**
 * Online pay + the cash path, both driven entirely by what the payments list
 * says — never by anything this browser remembers about its own checkout
 * attempt. That is what makes reopening this screen after the browser was
 * closed mid-checkout safe: there is no "did I finish paying?" local flag to
 * have gone stale, only a re-fetch of the same list a fresh page load would
 * also see. See `derivePaymentState` in `data/payments.ts` for the state
 * derivation this renders. Ported from
 * `legacy-next-src/components/customer/bookings/PaymentPanel.tsx`.
 */
export function PaymentPanel({ bookingId, payable }: { bookingId: string; payable: PayableView }) {
  const t = useT();
  const locale = useLocale();
  const query = useBookingPayments(bookingId);
  const startPayment = useStartPayment(bookingId);
  const checkoutCallback = useCheckoutCallback(bookingId);
  const openCheckout = useOpenRazorpayCheckout();
  const { ready: razorpayReady } = useRazorpayReady();

  /**
   * Same `mutateAsync` trap as the booking modal, and it matters more here.
   *
   * If creating the gateway order fails — the booking already paid, a network
   * blip, the gateway refusing — an uncaught rejection would crash the page a
   * customer is standing on with money owed. They would have no idea whether
   * anything had been charged. The error belongs in `ErrorState`, where it can
   * say so and offer a retry.
   *
   * Note the checkout itself is only opened on success: opening Razorpay for an
   * order that was never created is how somebody ends up paying against nothing.
   */
  async function handlePayNow() {
    if (startPayment.isPending) return;

    let order: Awaited<ReturnType<typeof startPayment.mutateAsync>>;

    try {
      order = await startPayment.mutateAsync();
    } catch {
      // Rendered from the mutation's own state below.
      return;
    }

    openCheckout({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      order_id: order.orderId,
      name: APP_NAME,
      description: t('app.booking.payDescription'),
      handler: (response) => {
        checkoutCallback.mutate({ paymentId: order.payment.id, ...response });
      },
      theme: { color: '#0f6e5c' },
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{t('app.booking.payableHeading')}</h3>

      <dl className="mt-2 divide-y divide-slate-100 text-sm">
        {payable.components.map((component, index) => (
          <div key={index} className="flex items-center justify-between py-1">
            <dt className="text-slate-700">
              {t(payableLabelKey(component.labelKey))}
              {component.waived ? ` (${t('app.booking.waived')})` : ''}
            </dt>
            <dd className="tabular-nums text-slate-900">{formatPaise(component.amountPaise)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between py-2 text-base font-semibold">
          <dt>{t('app.booking.payableTotal')}</dt>
          <dd className="tabular-nums">{payable.payableDisplay}</dd>
        </div>
      </dl>

      <QueryState
        status={query.status}
        error={query.error}
        data={query.data}
        loadingLabel={t('app.booking.checkingPaymentStatus')}
        onRetry={() => void query.refetch()}
      >
        {(data) => {
          const state = derivePaymentState(data.payments);

          if (state.kind === 'captured') {
            return (
              <p className="mt-3 text-sm font-medium text-green-700">{t('app.booking.paid')}</p>
            );
          }

          if (state.kind === 'cash_recorded') {
            return (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-sm font-medium text-green-700">
                  {t('app.booking.cashRecorded', { amount: state.payment.amountDisplay })}
                </p>
                <p className="text-xs text-slate-500">{t('app.booking.cashDisputeHint')}</p>
                <Link
                  to={buildLocalizedHref(locale, `/app/bookings/${bookingId}/complaint`)}
                  className="text-sm font-medium text-brand underline-offset-2 hover:underline"
                >
                  {t('app.booking.raiseCashDispute')}
                </Link>
              </div>
            );
          }

          if (state.kind === 'awaiting_confirmation') {
            return (
              <p className="mt-3 text-sm text-slate-600">{t('app.booking.confirmingPayment')}</p>
            );
          }

          return (
            <div className="mt-3 flex flex-col gap-2">
              {state.kind === 'failed' ? (
                <p className="text-sm text-red-700">{t('app.booking.paymentFailed')}</p>
              ) : null}
              {startPayment.isError ? <ErrorState error={startPayment.error} /> : null}
              <Button
                variant="primary"
                fullWidth
                disabled={!razorpayReady || startPayment.isPending}
                onClick={() => void handlePayNow()}
              >
                {startPayment.isPending
                  ? t('common.loading')
                  : t('app.booking.payNow', { amount: payable.payableDisplay })}
              </Button>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
