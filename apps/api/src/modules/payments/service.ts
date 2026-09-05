import type { Payment, PaymentPurpose, Prisma } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { enqueueOutbox } from '../../core/outbox';
import { formatPaise } from '../search/service';
import { isBillableBooking, type BookingStatus } from '../bookings/state-machine';
import { resolveCommissionRate, splitCommission } from './commission';
import * as coupons from '../coupons/service';
import * as ledger from './ledger';
import * as repo from './repository';
import { applyPaymentEvent, PAYMENT_TOPICS, type PaymentStatusName } from './state-machine';
import type { PaymentView, StartPaymentResponse } from './types';
import { writeDepsAudit, type AuditableDeps } from '../../core/audit';

export interface PaymentDeps extends AuditableDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: PaymentDeps): Date => (deps.now ? deps.now() : new Date());

const notFound = (id: string): AppError =>
  new AppError(404, 'PAYMENT_NOT_FOUND', `Payment ${id} not found`, {
    messageKey: 'errors.payments.notFound',
  });

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

export function toPaymentView(payment: Payment): PaymentView {
  return {
    id: payment.id,
    bookingId: payment.bookingId,
    purpose: payment.purpose,
    method: payment.method,
    amountPaise: payment.amountPaise,
    amountDisplay: formatPaise(payment.amountPaise),
    status: payment.status,
    commissionBps: payment.commissionBpsSnapshot,
    // Deliberately not the gateway *payment* id: that is an internal reference
    // and a customer has no use for it.
    gatewayOrderId: payment.gatewayOrderId,
    checkoutVerifiedAt: payment.checkoutVerifiedAt?.toISOString() ?? null,
    capturedAt: payment.capturedAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Commission                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Our rate for this booking, right now.
 *
 * Called once, at collection, and the answer is written onto the payment row.
 * Everything downstream — the capture journal, a refund's proportional split —
 * reads the snapshot, so a config change can never reach back into money that
 * has already moved.
 */
export async function resolveCommissionForBooking(
  deps: PaymentDeps,
  cityId: number,
  categoryId: number,
): Promise<number> {
  const { context } = deps;

  const category = await context.prisma.category.findUnique({
    where: { id: categoryId },
    select: { parentId: true },
  });

  const parentCategoryId = category?.parentId ?? null;
  const candidates = [categoryId, ...(parentCategoryId ? [parentCategoryId] : [])];
  const rows = await repo.listCommissionConfig(context.prisma, cityId, candidates);

  return resolveCommissionRate(
    rows,
    { categoryId, parentCategoryId },
    context.config.COMMISSION_DEFAULT_BPS,
    nowOf(deps),
  ).rateBps;
}

/* -------------------------------------------------------------------------- */
/* Loading a billable booking                                                 */
/* -------------------------------------------------------------------------- */

interface BillableBooking {
  id: string;
  status: BookingStatus;
  customerId: string;
  providerId: string;
  categoryId: number;
  payablePaise: number;
  cityId: number;
}

/**
 * Statuses in which an **upfront visit fee** may be collected.
 *
 * Only before anybody sets off. Once the technician has arrived, the visit is
 * part of the job and the fee belongs in the final bill — collecting it twice
 * from two different endpoints is exactly the sort of thing nobody notices until
 * a customer does.
 */
const UPFRONT_FEE_STATUSES: readonly BookingStatus[] = ['REQUESTED', 'ACCEPTED'];

/**
 * Loads a booking that is ready to be paid for.
 *
 * The payable is read from the **frozen snapshot** and never recomputed. Phase 7
 * decided what is owed at the terminal transition; this phase's only job is to
 * collect that number.
 */
async function loadBillable(
  deps: PaymentDeps,
  bookingId: string,
  userId: string,
  side: 'customer' | 'provider',
  purpose: PaymentPurpose = 'final_bill',
): Promise<BillableBooking> {
  const booking = await deps.context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      customerId: true,
      providerId: true,
      categoryId: true,
      payablePaise: true,
      visitFeePaise: true,
      category: { select: { cityId: true } },
    },
  });

  const isParty =
    booking && (side === 'customer' ? booking.customerId : booking.providerId) === userId;

  if (!booking || !isParty) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  const status = booking.status as BookingStatus;

  /**
   * Two purposes, two entirely different moments.
   *
   * The final bill is collected at the end, against Phase 7's frozen payable.
   * The upfront visit fee is collected at the *start*, against the fee
   * snapshotted at booking — before there is a payable at all, and before
   * anybody has done anything.
   */
  const amountPaise =
    purpose === 'visit_fee_upfront'
      ? (() => {
          if (!UPFRONT_FEE_STATUSES.includes(status)) {
            throw new AppError(
              409,
              'BOOKING_NOT_BILLABLE',
              `A visit fee cannot be collected on a booking in ${status}`,
              { messageKey: 'errors.payments.notBillable', details: { status } },
            );
          }

          return booking.visitFeePaise;
        })()
      : (() => {
          if (!isBillableBooking(status)) {
            throw new AppError(409, 'BOOKING_NOT_BILLABLE', `A booking in ${status} owes nothing`, {
              messageKey: 'errors.payments.notBillable',
              details: { status },
            });
          }

          if (booking.payablePaise === null || booking.payablePaise <= 0) {
            // Phase 7 writes the payable in the same transaction as the terminal
            // status, so this cannot happen — and if it ever does, the honest
            // answer is to stop rather than to invent an amount.
            throw AppError.internal(`booking ${bookingId} is ${status} with no frozen payable`);
          }

          return booking.payablePaise;
        })();

  if (amountPaise <= 0) {
    throw new AppError(409, 'BOOKING_NOT_BILLABLE', 'There is nothing to collect', {
      messageKey: 'errors.payments.notBillable',
      details: { status },
    });
  }

  return {
    id: booking.id,
    status,
    customerId: booking.customerId,
    providerId: booking.providerId,
    categoryId: booking.categoryId,
    payablePaise: amountPaise,
    cityId: booking.category.cityId,
  };
}

/* -------------------------------------------------------------------------- */
/* Online rail — starting a payment                                           */
/* -------------------------------------------------------------------------- */

/**
 * Creates (or re-returns) the gateway order for a booking's bill.
 *
 * **Idempotent by design.** A customer who backs out of checkout and taps "Pay"
 * again gets the *same* order, not a second one: two live orders for one bill is
 * how a customer ends up paying twice and how reconciliation stops being
 * possible. The partial unique index enforces it even if this check loses a race.
 */
export async function startPayment(
  deps: PaymentDeps,
  customerId: string,
  bookingId: string,
  purpose: PaymentPurpose = 'final_bill',
): Promise<StartPaymentResponse> {
  const { context } = deps;
  const booking = await loadBillable(deps, bookingId, customerId, 'customer', purpose);

  const existing = await repo.findLivePayment(context.prisma, bookingId, purpose);

  if (existing) {
    if (existing.status !== 'created') {
      throw new AppError(409, 'PAYMENT_ALREADY_SETTLED', 'This booking has already been paid', {
        messageKey: 'errors.payments.alreadySettled',
        details: { status: existing.status },
      });
    }

    if (existing.method === 'cash') {
      throw new AppError(409, 'PAYMENT_ALREADY_SETTLED', 'This booking was settled in cash', {
        messageKey: 'errors.payments.alreadySettled',
      });
    }

    // Same order, same amount. Nothing new is created.
    return {
      payment: toPaymentView(existing),
      orderId: existing.gatewayOrderId as string,
      amountPaise: existing.amountPaise,
      currency: 'INR',
      keyId: keyIdFor(context),
      reused: true,
    };
  }

  const commissionBps = await resolveCommissionForBooking(deps, booking.cityId, booking.categoryId);

  /**
   * The coupon, if the customer attached one.
   *
   * Only the **final bill** can carry one: an upfront visit fee is collected
   * before there is a bill to discount, and a coupon against it would be a
   * discount on a number the customer has not yet agreed to.
   *
   * The gateway order is created for the *discounted* amount — that is what the
   * customer actually pays. What the technician earns is unaffected, because the
   * capture journal below splits commission on the **pre-discount** gross, which
   * is recorded on the payment row as `amountPaise` for exactly that reason.
   */
  const discount =
    purpose === 'final_bill' ? await coupons.findBookingDiscount(context.prisma, bookingId) : null;

  const chargePaise = booking.payablePaise - (discount?.discountPaise ?? 0);

  if (chargePaise <= 0) {
    // A coupon that covers the whole bill leaves nothing for the gateway to
    // collect. Rare, and better refused loudly here than sent to Razorpay as a
    // zero-rupee order it will reject with a message nobody can act on.
    throw new AppError(409, 'BOOKING_NOT_BILLABLE', 'There is nothing left to collect', {
      messageKey: 'errors.payments.notBillable',
    });
  }

  const order = await context.gateway.createOrder({
    amountPaise: chargePaise,
    // A stable, meaningless-to-anyone-else reference the gateway echoes back.
    receipt: `bk_${bookingId.replace(/-/g, '').slice(0, 30)}`,
    notes: { bookingId, purpose },
  });

  try {
    const payment = await repo.createPayment(context.prisma, {
      bookingId,
      purpose,
      /**
       * `amountPaise` stays the **pre-discount** bill.
       *
       * This is the number the technician is paid on, so it is the one the
       * payment row has to carry — the discounted figure is what the gateway
       * collects and is recoverable as `amountPaise − discountPaise`. Storing
       * the discounted amount here instead would silently move the coupon's
       * cost onto the technician at every downstream split, which is the one
       * thing this feature must never do.
       */
      method: 'online',
      amountPaise: booking.payablePaise,
      discountPaise: discount?.discountPaise ?? 0,
      commissionBpsSnapshot: commissionBps,
      gateway: context.gateway.name,
      gatewayOrderId: order.orderId,
    });

    return {
      payment: toPaymentView(payment),
      orderId: order.orderId,
      amountPaise: order.amountPaise,
      currency: 'INR',
      keyId: order.keyId,
      reused: false,
    };
  } catch (error) {
    if (repo.isDuplicatePaymentError(error)) {
      // Somebody tapped twice. The order we just made is abandoned — harmless,
      // gateway orders expire — and the customer gets the one that exists.
      throw new AppError(409, 'PAYMENT_IN_PROGRESS', 'A payment for this booking already exists', {
        messageKey: 'errors.payments.inProgress',
      });
    }

    throw error;
  }
}

function keyIdFor(context: AppContext): string {
  return context.config.RAZORPAY_KEY_ID ?? 'rzp_test_fake_key';
}

/* -------------------------------------------------------------------------- */
/* Online rail — the optimistic callback                                      */
/* -------------------------------------------------------------------------- */

/**
 * The browser says the customer got through checkout.
 *
 * **This moves nothing.** It verifies the signature so a screen can honestly say
 * "payment received, confirming…" and it stamps `checkout_verified_at` so support
 * can tell the difference between "the customer says they paid" and "the client
 * has a signed receipt". The ledger waits for the webhook, because the browser
 * is not a source of truth about money: it can lie, and more often it simply
 * dies on the train home before the callback fires.
 */
export async function recordCheckoutCallback(
  deps: PaymentDeps,
  customerId: string,
  paymentId: string,
  input: { gatewayOrderId: string; gatewayPaymentId: string; signature: string },
): Promise<PaymentView> {
  const { context } = deps;
  const payment = await repo.findPayment(context.prisma, paymentId);

  if (!payment || !payment.bookingId) throw notFound(paymentId);
  // The payment's own purpose, so an upfront fee's callback is not judged
  // against the rules for a final bill.
  await loadBillable(deps, payment.bookingId, customerId, 'customer', payment.purpose);

  if (payment.gatewayOrderId !== input.gatewayOrderId) {
    throw AppError.badRequest('That order does not belong to this payment', {
      messageKey: 'errors.payments.orderMismatch',
    });
  }

  const valid = context.gateway.verifyCheckoutSignature(
    input.gatewayOrderId,
    input.gatewayPaymentId,
    input.signature,
  );

  if (!valid) {
    throw new AppError(400, 'PAYMENT_SIGNATURE_INVALID', 'That checkout signature is not valid', {
      messageKey: 'errors.payments.signatureInvalid',
    });
  }

  const updated = await context.prisma.payment.update({
    where: { id: paymentId },
    data: { checkoutVerifiedAt: nowOf(deps) },
  });

  context.logger.info(
    { paymentId, bookingId: payment.bookingId },
    'checkout callback verified — awaiting webhook before any money moves',
  );

  return toPaymentView(updated);
}

/* -------------------------------------------------------------------------- */
/* Online rail — capture (webhook only)                                       */
/* -------------------------------------------------------------------------- */

export class PaymentAmountMismatchError extends Error {
  constructor(
    readonly expectedPaise: number,
    readonly actualPaise: number,
  ) {
    super(`gateway reported ${actualPaise} paise but the frozen payable is ${expectedPaise}`);
    this.name = 'PaymentAmountMismatchError';
  }
}

/**
 * Money has actually arrived. This is the only function that says so.
 *
 * The journal:
 *
 * ```
 *   debit  gateway_cash      gross          (the platform now holds it)
 *   credit provider_payable  gross − cut    (we owe the technician)
 *   credit platform_revenue  cut            (our share)
 * ```
 *
 * The commission comes from the payment's **snapshot**, not from today's config.
 * The two credits are derived from one subtraction so they cannot fail to add
 * back to the gross — the journal balances by construction, and the database
 * checks it again anyway.
 *
 * ## With a coupon
 *
 * A platform-funded coupon changes only the **debit** side — what actually
 * arrived, and who funded the rest:
 *
 * ```
 *   debit  gateway_cash        gross − discount   (what the customer paid)
 *   debit  marketing_discount  discount           (what the platform funded)
 *   credit provider_payable    gross − cut        (unchanged — see below)
 *   credit platform_revenue    cut                (unchanged)
 * ```
 *
 * Both credits are computed from the **pre-discount gross**, so the technician
 * is owed exactly what they would have been owed with no coupon at all. That is
 * the single rule this feature exists to keep: the discount comes out of the
 * platform's margin, never out of somebody's earnings. `marketing_discount` is
 * an expense account, so the books balance and the cost is visible as a number
 * rather than merely as revenue that came in lower than expected.
 *
 * Note the platform's net on a generous coupon can be negative — a discount
 * larger than our commission is a real marketing loss, correctly recorded. That
 * is precisely why `maxDiscountPaise` is mandatory.
 */
export async function capturePayment(
  deps: PaymentDeps,
  input: { paymentId: string; gatewayPaymentId: string; amountPaise: number },
): Promise<void> {
  const { context } = deps;
  const payment = await repo.findPayment(context.prisma, input.paymentId);

  if (!payment) throw notFound(input.paymentId);

  if (payment.status !== 'created') {
    // A redelivered webhook. Nothing to do, and saying so is the whole point of
    // at-least-once being survivable.
    context.logger.info(
      { paymentId: payment.id, status: payment.status },
      'capture ignored: payment is no longer awaiting money',
    );
    return;
  }

  /**
   * The gateway must agree to the paisa with what we asked it to collect.
   *
   * That is the **discounted** figure, not the frozen payable: the order was
   * created for `amountPaise − discountPaise`, so comparing against the gross
   * would park every couponed payment as a mismatch. A genuine mismatch still
   * parks for ops rather than being reconciled automatically.
   */
  const chargedPaise = payment.amountPaise - payment.discountPaise;

  if (input.amountPaise !== chargedPaise) {
    throw new PaymentAmountMismatchError(chargedPaise, input.amountPaise);
  }

  const outcome = applyPaymentEvent(payment.status as PaymentStatusName, 'captured');
  if (!outcome.ok) throw new Error(`payment ${payment.id} cannot be captured (${outcome.reason})`);

  const split = splitCommission(payment.amountPaise, payment.commissionBpsSnapshot);
  const at = nowOf(deps);

  const providerId = await providerOf(deps, payment.bookingId);

  await context.prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: outcome.status,
        gatewayPaymentId: input.gatewayPaymentId,
        capturedAt: at,
      },
    });

    await ledger.post(tx, {
      journalType: 'payment_captured',
      bookingId: payment.bookingId,
      paymentId: payment.id,
      memo:
        payment.discountPaise > 0
          ? `online capture ${chargedPaise}p (${split.grossPaise}p less ${payment.discountPaise}p coupon, platform-funded), commission ${split.commissionPaise}p`
          : `online capture ${split.grossPaise}p, commission ${split.commissionPaise}p`,
      entries: [
        // What actually arrived at the gateway.
        {
          accountType: 'gateway_cash',
          ownerType: 'platform',
          direction: 'debit',
          amountPaise: chargedPaise,
        },
        /**
         * The part of the bill the platform paid on the customer's behalf.
         *
         * An expense, debited, so the two credits below can stay at their
         * pre-discount values and the journal still balances. Omitted entirely
         * when there is no coupon, so the overwhelming majority of journals are
         * byte-identical to what Phase 8 posted.
         */
        ...(payment.discountPaise > 0
          ? ([
              {
                accountType: 'marketing_discount' as const,
                ownerType: 'platform' as const,
                direction: 'debit' as const,
                amountPaise: payment.discountPaise,
              },
            ] as const)
          : []),
        ...(split.providerPaise > 0
          ? ([
              {
                accountType: 'provider_payable' as const,
                ownerType: 'provider' as const,
                ownerId: providerId,
                direction: 'credit' as const,
                amountPaise: split.providerPaise,
              },
            ] as const)
          : []),
        ...(split.commissionPaise > 0
          ? ([
              {
                accountType: 'platform_revenue' as const,
                ownerType: 'platform' as const,
                direction: 'credit' as const,
                amountPaise: split.commissionPaise,
              },
            ] as const)
          : []),
      ],
    });

    if (payment.bookingId) {
      await enqueueOutbox(tx, {
        topic: PAYMENT_TOPICS.captured,
        aggregateType: 'booking',
        aggregateId: payment.bookingId,
        payload: {
          paymentId: payment.id,
          // The gross, so a consumer reading this sees the bill that was agreed.
          amountPaise: split.grossPaise,
          // What the customer actually paid, and who funded the difference.
          chargedPaise,
          discountPaise: payment.discountPaise,
          commissionPaise: split.commissionPaise,
          providerPaise: split.providerPaise,
        } satisfies Prisma.InputJsonValue,
      });
    }
  });

  context.logger.info(
    { paymentId: payment.id, ...split },
    'payment captured and posted to the ledger',
  );
}

export async function failPayment(deps: PaymentDeps, paymentId: string): Promise<void> {
  const { context } = deps;
  const payment = await repo.findPayment(context.prisma, paymentId);

  if (!payment || payment.status !== 'created') return;

  await context.prisma.payment.update({ where: { id: paymentId }, data: { status: 'failed' } });

  if (payment.bookingId) {
    await context.prisma.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        topic: PAYMENT_TOPICS.failed,
        aggregateType: 'booking',
        aggregateId: payment.bookingId as string,
        payload: { paymentId },
      });
    });
  }

  // `failed` is outside the partial unique index, so the customer can try again.
  context.logger.info({ paymentId }, 'payment failed; the customer may re-initiate');
}

async function providerOf(deps: PaymentDeps, bookingId: string | null): Promise<string> {
  if (!bookingId)
    throw new Error('cannot post a provider entry for a booking that no longer exists');

  const booking = await deps.context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { providerId: true },
  });

  if (!booking) throw new Error(`booking ${bookingId} vanished before its payment posted`);
  return booking.providerId;
}

/* -------------------------------------------------------------------------- */
/* Cash rail                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The customer says they will pay in cash.
 *
 * **Only the customer chooses the method.** That is the whole point of this
 * function existing. Before it, the moment a bill was frozen the customer got
 * "Pay now" and the technician got "Got the cash", independently, with nothing
 * between them — so a customer could pay by card while the technician marked
 * it cash, and the job was settled twice with no way to tell which was true.
 * The technician now cannot act at all until this has been called.
 *
 * It writes a real `created` cash payment rather than a flag on the booking, so
 * it occupies the booking's payment slot exactly as an online order does. That
 * is what makes double payment impossible rather than merely unlikely: the same
 * `findLivePayment` check that stops two online orders stops this too.
 */
export async function declareCash(
  deps: PaymentDeps,
  customerId: string,
  bookingId: string,
): Promise<PaymentView> {
  const { context } = deps;
  const booking = await loadBillable(deps, bookingId, customerId, 'customer');

  const existing = await repo.findLivePayment(context.prisma, bookingId, 'final_bill');

  if (existing) {
    // Already chosen. Returning it rather than erroring makes a double tap
    // harmless, which on a bad connection is the common case.
    if (existing.method === 'cash' && existing.status === 'created') {
      return toPaymentView(existing);
    }

    throw new AppError(409, 'PAYMENT_ALREADY_SETTLED', 'This booking already has a payment', {
      messageKey: 'errors.payments.alreadySettled',
      details: { status: existing.status, method: existing.method },
    });
  }

  const commissionBps = await resolveCommissionForBooking(deps, booking.cityId, booking.categoryId);

  const created = await context.prisma.payment.create({
    data: {
      bookingId,
      purpose: 'final_bill',
      method: 'cash',
      // The full bill. Cash is always handed over at the pre-discount amount,
      // and the coupon is dropped when the technician confirms.
      amountPaise: booking.payablePaise,
      commissionBpsSnapshot: commissionBps,
      // Chosen, not collected. Nothing has moved and nothing is in the ledger
      // until the technician says the notes are in their hand.
      status: 'created',
    },
  });

  context.logger.info({ bookingId, paymentId: created.id }, 'customer chose to pay in cash');

  return toPaymentView(created);
}

/**
 * The customer changes their mind and wants to pay online after all.
 *
 * Necessary rather than tidy: without it, a customer who taps cash and then
 * finds the technician has already left is stuck with a bill they cannot
 * settle, and the only way out is a support call.
 *
 * Refuses once the technician has confirmed. At that point the money is
 * genuinely in somebody's hand and un-choosing it would be a lie.
 */
export async function withdrawCashChoice(
  deps: PaymentDeps,
  customerId: string,
  bookingId: string,
): Promise<void> {
  const { context } = deps;
  await loadBillable(deps, bookingId, customerId, 'customer');

  const existing = await repo.findLivePayment(context.prisma, bookingId, 'final_bill');

  if (!existing || existing.method !== 'cash' || existing.status !== 'created') {
    throw new AppError(409, 'NO_CASH_CHOICE', 'There is no unconfirmed cash choice to undo', {
      messageKey: 'errors.payments.noCashChoice',
    });
  }

  // `failed` rather than deleted: the row is the record that cash was chosen
  // and abandoned, which is exactly what somebody will ask about later. There
  // is no reason column on a payment, so the booking event carries the why.
  await context.prisma.payment.update({
    where: { id: existing.id },
    data: { status: 'failed' },
  });

  context.logger.info({ bookingId, paymentId: existing.id }, 'customer withdrew the cash choice');
}

/**
 * The technician says the cash never arrived.
 *
 * The other half of letting the customer choose. Without it a customer could
 * tap "pay cash" and walk away, and the technician had no button at all except
 * one that says the money is in their hand — so the honest options were to lie
 * or to leave the job sitting unsettled forever with no explanation attached.
 *
 * What it does **not** do is charge anybody or move a paisa. It withdraws the
 * choice, which puts the customer back in front of both options — including
 * paying online, which is the outcome worth steering towards when somebody has
 * turned up and not been paid. The refusal is recorded on the booking so it is
 * not merely the technician's word later.
 *
 * Refused once confirmed, exactly like the customer's own undo: after that the
 * money genuinely moved and this would be a retraction, not a report.
 */
export async function reportCashNotReceived(
  deps: PaymentDeps,
  providerId: string,
  bookingId: string,
): Promise<void> {
  const { context } = deps;
  await loadBillable(deps, bookingId, providerId, 'provider');

  const existing = await repo.findLivePayment(context.prisma, bookingId, 'final_bill');

  if (!existing || existing.method !== 'cash' || existing.status !== 'created') {
    throw new AppError(409, 'NO_CASH_CHOICE', 'There is no unconfirmed cash payment to report', {
      messageKey: 'errors.payments.noCashChoice',
    });
  }

  await context.prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: existing.id }, data: { status: 'failed' } });

    /**
     * Both sides are told, and the customer's copy is the point.
     *
     * A technician marking this while the customer is still standing there is
     * the ordinary case — a mistap, or they meant to pay online. The message
     * is what turns that into "oh, let me pay properly" rather than a dispute
     * three days later.
     */
    await enqueueOutbox(tx, {
      topic: PAYMENT_TOPICS.cashNotReceived,
      aggregateType: 'booking',
      aggregateId: bookingId,
      payload: { paymentId: existing.id, amountPaise: existing.amountPaise },
    });
  });

  context.logger.info(
    { bookingId, paymentId: existing.id },
    'technician reported cash was not received',
  );
}

/**
 * The technician took notes at the door.
 *
 * This is the Jabalpur reality and pretending otherwise would just push the
 * money off-platform entirely, where we can see nothing at all.
 *
 * The journal is **asymmetric to the online one**, and that asymmetry is the
 * whole design:
 *
 * ```
 *   debit  provider_dues     commission   (they hold our cut, so they owe us)
 *   credit platform_revenue  commission   (it is still our revenue)
 * ```
 *
 * Only the commission moves through our books, because only the commission is
 * ever ours to move — the rest of the money went from the customer's hand into
 * the technician's and never touched the platform. Posting the gross here would
 * put cash on our balance sheet that we do not have.
 */
export async function recordCashCollected(
  deps: PaymentDeps,
  providerId: string,
  bookingId: string,
  note?: string,
): Promise<PaymentView> {
  const { context } = deps;
  const booking = await loadBillable(deps, bookingId, providerId, 'provider');

  const existing = await repo.findLivePayment(context.prisma, bookingId, 'final_bill');

  /**
   * The customer must have chosen cash first.
   *
   * A technician can confirm receipt; they cannot decide how they were paid.
   * Before this check both sides had independent buttons, so a customer paying
   * by card while the technician marked cash settled the same job twice with
   * nothing to say which was true. Now the technician's button does not even
   * appear until `declareCash` has written the row this reads.
   */
  if (!existing) {
    throw new AppError(409, 'CASH_NOT_CHOSEN', 'The customer has not chosen to pay in cash', {
      messageKey: 'errors.payments.cashNotChosen',
    });
  }

  if (existing.method !== 'cash') {
    throw new AppError(409, 'PAYMENT_IS_ONLINE', 'This customer is paying online', {
      messageKey: 'errors.payments.payingOnline',
      details: { status: existing.status },
    });
  }

  if (existing.status !== 'created') {
    throw new AppError(409, 'PAYMENT_ALREADY_SETTLED', 'This booking already has a payment', {
      messageKey: 'errors.payments.alreadySettled',
      details: { status: existing.status, method: existing.method },
    });
  }

  // The rate frozen when the customer chose, not today's config — the choice
  // and the confirmation can be minutes apart and must agree.
  const commissionBps = existing.commissionBpsSnapshot;
  const split = splitCommission(booking.payablePaise, commissionBps);
  const at = nowOf(deps);

  try {
    const payment = await context.prisma.$transaction(async (tx) => {
      /**
       * A coupon cannot survive the switch to cash. Enforced here, server-side.
       *
       * The discount is funded out of our commission, which only works while the
       * money passes through us. On cash the technician hands over the
       * discounted amount themselves while commission is computed on the full
       * price — so honouring the coupon would take it straight out of their
       * earnings, which is the one thing this feature must never do.
       *
       * Dropping the redemption returns the coupon to the campaign's budget and
       * to this customer's own allowance: they did not use it, so they keep it.
       * The customer is told, because a discount that silently disappears from a
       * bill is how somebody ends up paying more than the screen last showed.
       */
      const dropped = await coupons.dropCouponForCash(tx, bookingId);

      /**
       * Captures the row the customer created, rather than making a second one.
       *
       * One payment per bill, from choice through to settlement, so the history
       * reads as what happened: chosen at 4:02, confirmed at 4:05. Creating a
       * new row here would leave the customer's choice orphaned as `created`
       * forever and put two cash payments on one booking.
       *
       * Cash is captured the moment it is handed over — there is no webhook to
       * wait for and no second source of truth to disagree with.
       */
      const created = await tx.payment.update({
        where: { id: existing.id },
        data: {
          // Re-stated in case the bill was refrozen between choice and
          // confirmation. The amount that matters is the one being handed over.
          amountPaise: booking.payablePaise,
          status: 'captured',
          capturedAt: at,
        },
      });

      if (split.commissionPaise > 0) {
        await ledger.post(tx, {
          journalType: 'cash_collected',
          bookingId,
          paymentId: created.id,
          memo: `cash ${split.grossPaise}p collected by technician; commission ${split.commissionPaise}p owed`,
          entries: [
            {
              accountType: 'provider_dues',
              ownerType: 'provider',
              ownerId: booking.providerId,
              direction: 'debit',
              amountPaise: split.commissionPaise,
            },
            {
              accountType: 'platform_revenue',
              ownerType: 'platform',
              direction: 'credit',
              amountPaise: split.commissionPaise,
            },
          ],
        });
      }

      /**
       * Marking cash collected is the one action in this system a technician can
       * take unilaterally about money, so it gets sunlight: the customer sees
       * "your technician recorded ₹X in cash" and can say otherwise.
       *
       * This topic routes to the customer on **all three channels**, SMS
       * included — it has to arrive even with no data connection, because a
       * charge nobody can dispute is a charge somebody will eventually invent.
       * See docs/notifications.md.
       */
      await enqueueOutbox(tx, {
        topic: PAYMENT_TOPICS.cashRecorded,
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: {
          paymentId: created.id,
          amountPaise: split.grossPaise,
          commissionPaise: split.commissionPaise,
          // Present only when a coupon was dropped, so the customer's message
          // can say why the amount is higher than the screen last showed.
          couponDropped: dropped
            ? { code: dropped.code, discountPaise: dropped.discountPaise }
            : null,
          note: note ?? null,
        },
      });

      return created;
    });

    return toPaymentView(payment);
  } catch (error) {
    if (repo.isDuplicatePaymentError(error)) {
      throw new AppError(409, 'PAYMENT_ALREADY_SETTLED', 'This booking already has a payment', {
        messageKey: 'errors.payments.alreadySettled',
      });
    }

    throw error;
  }
}

/**
 * A technician has paid back what they owed on cash jobs.
 *
 * ```
 *   debit  gateway_cash    amount   (their transfer reached us)
 *   credit provider_dues   amount   (the debt is cleared)
 * ```
 *
 * Ops-recorded for the pilot: the technician sends a UPI transfer to the
 * platform and somebody marks it. Phase 11 gives that a screen.
 */
export async function settleProviderDues(
  deps: PaymentDeps,
  providerId: string,
  amountPaise: number,
  memo: string | null,
): Promise<{ journalId: string; duesPaise: number }> {
  const { context } = deps;
  const balance = await ledger.providerBalance(context.prisma, providerId);

  if (amountPaise <= 0) {
    throw AppError.badRequest('A settlement must be more than zero', {
      messageKey: 'errors.payments.invalidAmount',
    });
  }

  if (amountPaise > balance.duesPaise) {
    throw AppError.badRequest(
      `That technician owes ${balance.duesPaise} paise, not ${amountPaise}`,
      {
        messageKey: 'errors.payments.settlementTooLarge',
        details: { duesPaise: balance.duesPaise },
      },
    );
  }

  const { journalId } = await context.prisma.$transaction(async (tx) => {
    // The ops audit row, in the same transaction as the decision it records.
    await writeDepsAudit(tx, deps);

    const posted = await ledger.post(tx, {
      journalType: 'dues_settled',
      memo: memo ?? `dues settled ${amountPaise}p`,
      entries: [
        { accountType: 'gateway_cash', ownerType: 'platform', direction: 'debit', amountPaise },
        {
          accountType: 'provider_dues',
          ownerType: 'provider',
          ownerId: providerId,
          direction: 'credit',
          amountPaise,
        },
      ],
    });

    await enqueueOutbox(tx, {
      topic: PAYMENT_TOPICS.duesSettled,
      aggregateType: 'provider',
      aggregateId: providerId,
      payload: { amountPaise, journalId: posted.journalId },
    });

    return posted;
  });

  const after = await ledger.providerBalance(context.prisma, providerId);

  return { journalId, duesPaise: after.duesPaise };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listBookingPayments(
  deps: PaymentDeps,
  userId: string,
  bookingId: string,
): Promise<PaymentView[]> {
  const booking = await deps.context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { customerId: true, providerId: true },
  });

  if (!booking || (booking.customerId !== userId && booking.providerId !== userId)) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  const payments = await repo.listPaymentsForBooking(deps.context.prisma, bookingId);
  return payments.map(toPaymentView);
}
