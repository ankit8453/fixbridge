// All Prisma for money. Ledger writes go through `ledger.ts`, never from here.
import { Prisma } from '@prisma/client';
import type {
  Payment,
  PaymentPurpose,
  PaymentStatus,
  PayoutBatch,
  PrismaClient,
  Refund,
} from '@prisma/client';
import { enqueueOutbox } from '../../core/outbox';

export type { Payment, Refund };

/** Statuses in which a payment still occupies its booking's slot for that purpose. */
export const LIVE_PAYMENT_STATUSES: PaymentStatus[] = [
  'created',
  'captured',
  'refunded',
  'partially_refunded',
];

/** Postgres's code for a unique violation, as Prisma reports it. */
export const UNIQUE_VIOLATION = 'P2002';

/**
 * Did this fail because a payment for that booking and purpose already exists?
 *
 * The partial unique index is what makes "one live payment per purpose" true;
 * this turns losing that race into a 409 rather than a 500.
 */
export function isDuplicatePaymentError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];

    return fields.some((field) => field.includes('booking_id') || field.includes('payments'));
  }

  const meta = (error as { meta?: { message?: string } }).meta;
  const text = `${error instanceof Error ? error.message : String(error)}\n${meta?.message ?? ''}`;

  return /Key \(booking_id, purpose\)=.* already exists/.test(text);
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

export function findPayment(prisma: PrismaClient, id: string): Promise<Payment | null> {
  return prisma.payment.findUnique({ where: { id } });
}

/**
 * The webhook's way in.
 *
 * At most one payment can carry a given order id — a partial unique index says
 * so — which is what makes this lookup unambiguous. Without that guarantee a
 * capture could land on whichever row came back first, and the wrong booking
 * would be marked paid.
 */
export function findPaymentByOrderId(
  prisma: PrismaClient,
  gatewayOrderId: string,
): Promise<Payment | null> {
  return prisma.payment.findFirst({ where: { gatewayOrderId } });
}

export function listPaymentsForBooking(
  prisma: PrismaClient,
  bookingId: string,
): Promise<Payment[]> {
  return prisma.payment.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
}

/** The one that still counts for a purpose, if any. `failed` does not count. */
export function findLivePayment(
  prisma: PrismaClient,
  bookingId: string,
  purpose: PaymentPurpose,
): Promise<Payment | null> {
  return prisma.payment.findFirst({
    where: { bookingId, purpose, status: { in: LIVE_PAYMENT_STATUSES } },
  });
}

export interface CreatePaymentInput {
  bookingId: string;
  purpose: PaymentPurpose;
  method: 'online' | 'cash';
  /** The pre-discount bill. Commission and payout are both computed from it. */
  amountPaise: number;
  /** What a coupon took off, funded by the platform. Zero on nearly every row. */
  discountPaise?: number;
  commissionBpsSnapshot: number;
  gateway?: 'fake' | 'razorpay' | null;
  gatewayOrderId?: string | null;
}

export function createPayment(prisma: PrismaClient, input: CreatePaymentInput): Promise<Payment> {
  return prisma.payment.create({
    data: {
      bookingId: input.bookingId,
      purpose: input.purpose,
      method: input.method,
      amountPaise: input.amountPaise,
      discountPaise: input.discountPaise ?? 0,
      commissionBpsSnapshot: input.commissionBpsSnapshot,
      gateway: input.gateway ?? null,
      gatewayOrderId: input.gatewayOrderId ?? null,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Webhook events                                                             */
/* -------------------------------------------------------------------------- */

export interface WebhookInsert {
  gateway: string;
  gatewayEventId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
  topic: string;
}

export interface WebhookInsertResult {
  webhookEventId: string;
  /** False when the gateway had already delivered this event. */
  isNew: boolean;
}

/**
 * Records a delivery and queues it for processing.
 *
 * **The unique `gateway_event_id` is the idempotency wall.** A gateway will
 * deliver the same event more than once — on its own retry schedule, and again
 * whenever an operator hits "resend" — and the second insert simply loses. The
 * caller answers 200 either way, because telling a gateway "error" for an event
 * we already handled just makes it try harder.
 *
 * Insert and outbox row go in one transaction, so an event can never be recorded
 * without being queued, and never queued without being recorded.
 */
export async function recordWebhookEvent(
  prisma: PrismaClient,
  input: WebhookInsert,
): Promise<WebhookInsertResult> {
  return prisma.$transaction(async (tx) => {
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO webhook_events (id, gateway, gateway_event_id, event_type, payload, received_at)
      VALUES (gen_random_uuid(), ${input.gateway}, ${input.gatewayEventId}, ${input.eventType},
              ${input.payload}::jsonb, NOW())
      ON CONFLICT (gateway_event_id) DO NOTHING
      RETURNING id
    `;

    const row = inserted[0];

    if (!row) {
      const existing = await tx.webhookEvent.findUnique({
        where: { gatewayEventId: input.gatewayEventId },
        select: { id: true },
      });

      return { webhookEventId: existing?.id ?? '', isNew: false };
    }

    await enqueueOutbox(tx, {
      topic: input.topic,
      aggregateType: 'webhook_event',
      aggregateId: row.id,
      payload: { gatewayEventId: input.gatewayEventId, eventType: input.eventType },
    });

    return { webhookEventId: row.id, isNew: true };
  });
}

export function findWebhookEvent(prisma: PrismaClient, id: string) {
  return prisma.webhookEvent.findUnique({ where: { id } });
}

export async function markWebhookProcessed(
  prisma: PrismaClient,
  id: string,
  error: string | null,
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      // A parked event keeps `processed_at` null so ops can see it is unfinished
      // while still reading why.
      processedAt: error ? null : new Date(),
      processingError: error?.slice(0, 1000) ?? null,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Refunds                                                                    */
/* -------------------------------------------------------------------------- */

export function findRefund(prisma: PrismaClient, id: string): Promise<Refund | null> {
  return prisma.refund.findUnique({ where: { id } });
}

export function findRefundByGatewayId(
  prisma: PrismaClient,
  gatewayRefundId: string,
): Promise<Refund | null> {
  return prisma.refund.findFirst({ where: { gatewayRefundId } });
}

export function listRefunds(prisma: PrismaClient, paymentId: string): Promise<Refund[]> {
  return prisma.refund.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } });
}

/** How much of a payment has already been given back, excluding failures. */
export async function refundedTotal(prisma: PrismaClient, paymentId: string): Promise<number> {
  const result = await prisma.refund.aggregate({
    where: { paymentId, status: { in: ['created', 'processed'] } },
    _sum: { amountPaise: true },
  });

  return result._sum.amountPaise ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Payouts                                                                    */
/* -------------------------------------------------------------------------- */

export function findPayoutBatch(prisma: PrismaClient, id: string): Promise<PayoutBatch | null> {
  return prisma.payoutBatch.findUnique({ where: { id } });
}

export function listPayoutsForProvider(prisma: PrismaClient, providerId: string, limit: number) {
  return prisma.payout.findMany({
    where: { providerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

export interface CommissionCandidate {
  categoryId: number | null;
  rateBps: number;
  isActive: boolean;
  effectiveFrom: Date;
}

/** Every row that could set the rate for this booking. Resolution is pure. */
export function listCommissionConfig(
  prisma: PrismaClient,
  cityId: number,
  categoryIds: number[],
): Promise<CommissionCandidate[]> {
  return prisma.commissionConfig.findMany({
    where: {
      cityId,
      isActive: true,
      OR: [{ categoryId: null }, { categoryId: { in: categoryIds } }],
    },
    select: { categoryId: true, rateBps: true, isActive: true, effectiveFrom: true },
  });
}

export { Prisma };
