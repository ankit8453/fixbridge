import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { enqueueOutbox } from '../../core/outbox';
import { formatPaise } from '../search/service';
import { splitRefund } from './commission';
import * as ledger from './ledger';
import * as repo from './repository';
import { applyPaymentEvent, PAYMENT_TOPICS, type PaymentStatusName } from './state-machine';
import type { PaymentDeps } from './service';
import type { RefundView } from './types';

/**
 * Giving money back.
 *
 * Two rules shape everything here:
 *
 *   1. **The technician bears their share.** A refund reverses the original
 *      split in the same proportion, at the *snapshotted* rate. Refunding out of
 *      platform revenue alone would quietly turn every refund into a subsidy
 *      paid by us to the technician for work the customer rejected.
 *   2. **Cash is not refundable through us.** We never held that money — it went
 *      from the customer's hand to the technician's. A cash refund is a
 *      conversation between those two people, with ops mediating; issuing one
 *      from the ledger would mean paying out money we never received.
 */

export function toRefundView(refund: {
  id: string;
  paymentId: string;
  amountPaise: number;
  status: string;
  reason: string | null;
  createdAt: Date;
}): RefundView {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    amountPaise: refund.amountPaise,
    amountDisplay: formatPaise(refund.amountPaise),
    status: refund.status as RefundView['status'],
    reason: refund.reason,
    createdAt: refund.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Requesting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Asks the gateway to send money back. Ops only, this phase.
 *
 * Nothing is posted here — the refund row is `created` and the ledger waits for
 * `refund.processed` from the gateway. Same law as capture: a refund we asked
 * for is not a refund that happened.
 */
export async function requestRefund(
  deps: PaymentDeps,
  paymentId: string,
  input: { amountPaise?: number; reason?: string },
): Promise<RefundView> {
  const { context } = deps;
  const payment = await repo.findPayment(context.prisma, paymentId);

  if (!payment) {
    throw new AppError(404, 'PAYMENT_NOT_FOUND', `Payment ${paymentId} not found`, {
      messageKey: 'errors.payments.notFound',
    });
  }

  if (payment.method === 'cash') {
    throw new AppError(409, 'REFUND_NOT_POSSIBLE', 'Cash payments cannot be refunded through us', {
      messageKey: 'errors.payments.cashNotRefundable',
    });
  }

  if (!['captured', 'partially_refunded'].includes(payment.status)) {
    throw new AppError(
      409,
      'REFUND_NOT_POSSIBLE',
      `A ${payment.status} payment cannot be refunded`,
      {
        messageKey: 'errors.payments.notRefundable',
        details: { status: payment.status },
      },
    );
  }

  const alreadyRefunded = await repo.refundedTotal(context.prisma, paymentId);
  const remaining = payment.amountPaise - alreadyRefunded;
  const amountPaise = input.amountPaise ?? remaining;

  if (amountPaise <= 0 || amountPaise > remaining) {
    throw AppError.badRequest(`At most ${remaining} paise can still be refunded`, {
      messageKey: 'errors.payments.refundTooLarge',
      details: { remainingPaise: remaining },
    });
  }

  const issued = await context.gateway.initiateRefund({
    paymentId: payment.gatewayPaymentId as string,
    amountPaise,
    notes: { paymentId },
  });

  const refund = await context.prisma.refund.create({
    data: {
      paymentId,
      amountPaise,
      gatewayRefundId: issued.refundId,
      status: 'created',
      reason: input.reason ?? null,
    },
  });

  context.logger.info(
    { paymentId, refundId: refund.id, amountPaise },
    'refund requested — ledger waits for the gateway to confirm',
  );

  return toRefundView(refund);
}

/* -------------------------------------------------------------------------- */
/* Completing                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The gateway says the money is on its way back. Now it moves.
 *
 * ```
 *   debit  provider_payable  refund − cut   (they give back their share)
 *   debit  platform_revenue  cut            (we give back ours)
 *   credit gateway_cash      refund         (it leaves our balance at the gateway)
 * ```
 *
 * Collapsed into **one journal** rather than the two-step
 * (…→ `refunds_payable` → settlement) the prompt allowed. The reason is that
 * with this gateway the money leaves our balance at the moment the refund is
 * processed — there is no interval during which we owe a refund we have not yet
 * paid, so a `refunds_payable` leg would be credited and debited in the same
 * breath and would describe a state that never exists. The account still exists
 * for a gateway that settles differently.
 */
export async function completeRefund(deps: PaymentDeps, gatewayRefundId: string): Promise<void> {
  const { context } = deps;
  const refund = await repo.findRefundByGatewayId(context.prisma, gatewayRefundId);

  if (!refund) {
    throw new Error(`no refund recorded for gateway refund ${gatewayRefundId}`);
  }

  if (refund.status === 'processed') {
    // Redelivered webhook. The ledger already has it.
    context.logger.info({ refundId: refund.id }, 'refund already processed; ignoring redelivery');
    return;
  }

  const payment = await repo.findPayment(context.prisma, refund.paymentId);
  if (!payment) throw new Error(`refund ${refund.id} points at a payment that is gone`);

  const split = splitRefund(refund.amountPaise, payment.commissionBpsSnapshot);

  const refundedAfter = await repo.refundedTotal(context.prisma, payment.id);
  const isFull = refundedAfter >= payment.amountPaise;

  const outcome = applyPaymentEvent(
    payment.status as PaymentStatusName,
    isFull ? 'refunded_fully' : 'refunded_partially',
  );

  if (!outcome.ok) {
    throw new Error(`payment ${payment.id} cannot be refunded from ${payment.status}`);
  }

  const providerId = payment.bookingId
    ? (
        await context.prisma.booking.findUnique({
          where: { id: payment.bookingId },
          select: { providerId: true },
        })
      )?.providerId
    : null;

  await context.prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: 'processed' },
    });

    await tx.payment.update({ where: { id: payment.id }, data: { status: outcome.status } });

    await ledger.post(tx, {
      journalType: 'refund',
      bookingId: payment.bookingId,
      paymentId: payment.id,
      memo: `refund ${split.grossPaise}p (provider ${split.providerPaise}p, platform ${split.commissionPaise}p)`,
      entries: [
        ...(split.providerPaise > 0 && providerId
          ? ([
              {
                accountType: 'provider_payable' as const,
                ownerType: 'provider' as const,
                ownerId: providerId,
                direction: 'debit' as const,
                amountPaise: split.providerPaise,
              },
            ] as const)
          : []),
        ...(split.commissionPaise > 0
          ? ([
              {
                accountType: 'platform_revenue' as const,
                ownerType: 'platform' as const,
                direction: 'debit' as const,
                amountPaise: split.commissionPaise,
              },
            ] as const)
          : []),
        // When the booking is gone (erasure) the provider leg cannot be posted,
        // so the platform absorbs it rather than the journal failing to balance.
        ...(split.providerPaise > 0 && !providerId
          ? ([
              {
                accountType: 'platform_revenue' as const,
                ownerType: 'platform' as const,
                direction: 'debit' as const,
                amountPaise: split.providerPaise,
              },
            ] as const)
          : []),
        {
          accountType: 'gateway_cash',
          ownerType: 'platform',
          direction: 'credit',
          amountPaise: split.grossPaise,
        },
      ],
    });

    if (payment.bookingId) {
      await enqueueOutbox(tx, {
        topic: PAYMENT_TOPICS.refunded,
        aggregateType: 'booking',
        aggregateId: payment.bookingId,
        payload: {
          paymentId: payment.id,
          refundId: refund.id,
          amountPaise: split.grossPaise,
          fullyRefunded: isFull,
        },
      });
    }
  });

  context.logger.info(
    { refundId: refund.id, paymentId: payment.id, ...split, isFull },
    'refund processed and reversed in the ledger',
  );
}

/* -------------------------------------------------------------------------- */
/* Upfront-fee auto refund                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A booking with a paid-up-front visit fee that ended without a visit.
 *
 * Only reachable when `COLLECT_FEE_AT_BOOKING` is on, which it is not for the
 * pilot — but a fee taken for a visit that never happened has to come back
 * without anybody asking, or the flag is not safe to turn on. Registered as an
 * outbox consumer so it runs off the same at-least-once machinery as everything
 * else, and is therefore idempotent: a second delivery finds the refund already
 * requested and does nothing.
 */
export async function autoRefundUpfrontFee(
  context: AppContext,
  bookingId: string,
): Promise<'refunded' | 'nothing_to_refund' | 'disabled'> {
  if (!context.config.COLLECT_FEE_AT_BOOKING) return 'disabled';

  const payment = await repo.findLivePayment(context.prisma, bookingId, 'visit_fee_upfront');

  if (!payment || payment.status !== 'captured' || payment.method !== 'online') {
    return 'nothing_to_refund';
  }

  const already = await repo.refundedTotal(context.prisma, payment.id);
  if (already >= payment.amountPaise) return 'nothing_to_refund';

  await requestRefund({ context }, payment.id, {
    amountPaise: payment.amountPaise - already,
    reason: 'Booking ended before the visit; upfront fee returned',
  });

  return 'refunded';
}
