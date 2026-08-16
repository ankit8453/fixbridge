import type { Payment, PaymentPurpose, Prisma } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { enqueueOutbox } from '../../core/outbox';
import { formatPaise } from '../search/service';
import { isBillableBooking, type BookingStatus } from '../bookings/state-machine';
import { resolveCommissionRate, splitCommission } from './commission';
import * as ledger from './ledger';
import * as repo from './repository';
import { applyPaymentEvent, PAYMENT_TOPICS, type PaymentStatusName } from './state-machine';
import type { PaymentView, StartPaymentResponse } from './types';

export interface PaymentDeps {
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

  if (!isBillableBooking(status)) {
    throw new AppError(409, 'BOOKING_NOT_BILLABLE', `A booking in ${status} owes nothing`, {
      messageKey: 'errors.payments.notBillable',
      details: { status },
    });
  }

  if (booking.payablePaise === null || booking.payablePaise <= 0) {
    // Phase 7 writes the payable in the same transaction as the terminal status,
    // so this cannot happen — and if it ever does, the honest answer is to stop
    // rather than to invent an amount.
    throw AppError.internal(`booking ${bookingId} is ${status} with no frozen payable`);
  }

  return {
    id: booking.id,
    status,
    customerId: booking.customerId,
    providerId: booking.providerId,
    categoryId: booking.categoryId,
    payablePaise: booking.payablePaise,
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
  const booking = await loadBillable(deps, bookingId, customerId, 'customer');

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

  const order = await context.gateway.createOrder({
    amountPaise: booking.payablePaise,
    // A stable, meaningless-to-anyone-else reference the gateway echoes back.
    receipt: `bk_${bookingId.replace(/-/g, '').slice(0, 30)}`,
    notes: { bookingId, purpose },
  });

  try {
    const payment = await repo.createPayment(context.prisma, {
      bookingId,
      purpose,
      method: 'online',
      amountPaise: booking.payablePaise,
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
  await loadBillable(deps, payment.bookingId, customerId, 'customer');

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

  // The gateway must agree with the frozen payable to the paisa. A mismatch is
  // not something to reconcile automatically — it parks for ops.
  if (input.amountPaise !== payment.amountPaise) {
    throw new PaymentAmountMismatchError(payment.amountPaise, input.amountPaise);
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
      memo: `online capture ${split.grossPaise}p, commission ${split.commissionPaise}p`,
      entries: [
        {
          accountType: 'gateway_cash',
          ownerType: 'platform',
          direction: 'debit',
          amountPaise: split.grossPaise,
        },
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
          amountPaise: split.grossPaise,
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

  if (existing) {
    throw new AppError(409, 'PAYMENT_ALREADY_SETTLED', 'This booking already has a payment', {
      messageKey: 'errors.payments.alreadySettled',
      details: { status: existing.status, method: existing.method },
    });
  }

  const commissionBps = await resolveCommissionForBooking(deps, booking.cityId, booking.categoryId);
  const split = splitCommission(booking.payablePaise, commissionBps);
  const at = nowOf(deps);

  try {
    const payment = await context.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          bookingId,
          purpose: 'final_bill',
          method: 'cash',
          amountPaise: booking.payablePaise,
          commissionBpsSnapshot: commissionBps,
          // Cash is captured the moment it is handed over. There is no webhook
          // to wait for, and no second source of truth to disagree with.
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
       * The customer is told, in Phase 10.
       *
       * Marking cash collected is the one action in this system a technician can
       * take unilaterally about money, so it gets sunlight: the customer sees
       * "your technician recorded ₹X in cash" and can say otherwise. Disputes
       * are Phase 9; visibility is what makes them possible.
       */
      await enqueueOutbox(tx, {
        topic: PAYMENT_TOPICS.cashRecorded,
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: {
          paymentId: created.id,
          amountPaise: split.grossPaise,
          commissionPaise: split.commissionPaise,
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
