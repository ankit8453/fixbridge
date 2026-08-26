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
import { IconRupee, IconAccepted, IconWaiting, IconStopped } from './BookingIcons';
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
 * derivation this renders.
 *
 * ## Why every state gets its own coloured strip
 *
 * Money is the one place on this surface where an ambiguous screen is worse
 * than an ugly one. "Paid", "we are still confirming", "it failed, try again"
 * and "the technician says you paid cash" are four genuinely different
 * situations, and a customer must never have to read a sentence carefully to
 * tell which one they are in. Each therefore gets its own tint, its own glyph
 * and — where the customer can do something about it — its own action, rather
 * than four variations of grey body text.
 *
 * "Still confirming" in particular is deliberately not styled as an error: the
 * webhook resolves it on its own, the list is polling for that, and an alarmed
 * screen would push somebody into paying a second time.
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
    <div className="overflow-hidden rounded-xl border border-shop-line bg-white">
      <div className="flex items-center gap-2.5 border-b border-shop-line px-4 py-2.5">
        <IconRupee className="h-[18px] w-[18px] shrink-0 text-shop" aria-hidden="true" />
        <h3 className="text-[13px] font-semibold text-shop-ink">
          {t('app.booking.payableHeading')}
        </h3>
      </div>

      <div className="px-4 py-3">
        <dl className="text-sm">
          {payable.components.map((component, index) => (
            <div key={index} className="flex items-baseline justify-between gap-3 py-1">
              <dt className="text-shop-ink-soft">
                {t(payableLabelKey(component.labelKey))}
                {component.waived ? (
                  <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                    {t('app.booking.waived')}
                  </span>
                ) : null}
              </dt>
              <dd
                className={`shrink-0 tabular-nums ${
                  component.waived ? 'text-shop-ink-soft line-through' : 'text-shop-ink'
                }`}
              >
                {formatPaise(component.amountPaise)}
              </dd>
            </div>
          ))}

          <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t-2 border-shop-ink/10 pt-2">
            <dt className="text-[15px] font-bold text-shop-ink">{t('app.booking.payableTotal')}</dt>
            {/* The API's own rendering of the integer paise total, verbatim. */}
            <dd className="shrink-0 text-[19px] font-bold leading-none tabular-nums text-shop-ink">
              {payable.payableDisplay}
            </dd>
          </div>
        </dl>
      </div>

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
              <div className="flex items-center gap-2.5 border-t border-emerald-200 bg-emerald-50 px-4 py-3">
                <IconAccepted className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                <p className="text-sm font-semibold text-emerald-900">{t('app.booking.paid')}</p>
              </div>
            );
          }

          if (state.kind === 'cash_recorded') {
            return (
              <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <IconAccepted
                    className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-900">
                      {t('app.booking.cashRecorded', { amount: state.payment.amountDisplay })}
                    </p>
                    {/* Recoverable, always: a cash amount is a claim by the
                        other party, so the way to dispute it is on the same
                        strip as the claim itself. */}
                    <p className="mt-1 text-xs leading-relaxed text-emerald-900/80">
                      {t('app.booking.cashDisputeHint')}
                    </p>
                    <Link
                      to={buildLocalizedHref(locale, `/app/bookings/${bookingId}/complaint`)}
                      className="mt-1.5 inline-block text-sm font-semibold text-emerald-900 underline underline-offset-2"
                    >
                      {t('app.booking.raiseCashDispute')}
                    </Link>
                  </div>
                </div>
              </div>
            );
          }

          if (state.kind === 'awaiting_confirmation') {
            return (
              <div className="flex items-start gap-2.5 border-t border-amber-200 bg-amber-50 px-4 py-3">
                <IconWaiting
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-900">
                    {t('app.booking.confirmingPayment')}
                  </p>
                  {/* Said plainly, because the alternative is somebody paying
                      twice out of doubt. The payments query polls while this
                      state holds; nothing here needs a manual refresh. */}
                  <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
                    {t('app.booking.confirmingPaymentHint')}
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div className="flex flex-col gap-2 border-t border-shop-line bg-shop-soft/40 px-4 py-3">
              {state.kind === 'failed' ? (
                <div className="flex items-start gap-2.5 rounded-lg bg-rose-50 px-3 py-2">
                  <IconStopped
                    className="mt-0.5 h-5 w-5 shrink-0 text-rose-700"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-rose-900">
                      {t('app.booking.paymentFailed')}
                    </p>
                    {/* Explicit, because a failed attempt is the state people
                        most often assume has taken their money. */}
                    <p className="mt-0.5 text-xs leading-relaxed text-rose-900/80">
                      {t('app.booking.paymentFailedHint')}
                    </p>
                  </div>
                </div>
              ) : null}

              {startPayment.isError ? <ErrorState error={startPayment.error} /> : null}

              <Button
                variant="shop"
                fullWidth
                disabled={!razorpayReady || startPayment.isPending}
                onClick={() => void handlePayNow()}
                className="border-transparent bg-shop text-shop-foreground hover:opacity-90"
              >
                {startPayment.isPending
                  ? t('common.loading')
                  : t('app.booking.payNow', { amount: payable.payableDisplay })}
              </Button>

              {/* The gateway script is loaded lazily, and a customer tapping a
                  dead button learns nothing. Only shown while it is actually
                  the thing blocking them. */}
              {!razorpayReady ? (
                <p className="text-center text-xs text-shop-ink-soft">
                  {t('app.booking.gatewayLoading')}
                </p>
              ) : null}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
