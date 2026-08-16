import { Router, type Request, type RequestHandler } from 'express';
import { AUDIT_ACTIONS, auditActor, type AuditEntry } from '../../core/audit';
import { getContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { authenticate, getAuthUser } from '../../core/middleware/authenticate';
import { requireRoles } from '../../core/middleware/require-roles';
import { bookingIdParamSchema } from '../bookings/types';
import * as payouts from './payouts';
import * as refunds from './refunds';
import * as service from './service';
import { PAYMENT_TOPICS } from './state-machine';
import * as repo from './repository';
import {
  batchIdParamSchema,
  cashCollectedSchema,
  checkoutCallbackSchema,
  failPayoutSchema,
  markPaidSchema,
  paymentIdParamSchema,
  payoutIdParamSchema,
  refundSchema,
  settleDuesSchema,
  startPaymentSchema,
} from './types';

const handle =
  (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const deps = (req: Request): service.PaymentDeps => ({ context: getContext(req) });

/**
 * The same deps, carrying the ops decision's audit entry.
 *
 * The services below already open exactly the right transaction; the entry rides
 * into it so the record and the money move together or not at all.
 */
const opsDeps = (req: Request, entry: AuditEntry): service.PaymentDeps => ({
  context: getContext(req),
  audit: { actor: auditActor(req), entry },
});

/* -------------------------------------------------------------------------- */
/* /api/v1/payments                                                           */
/* -------------------------------------------------------------------------- */

export const router = Router();

router.use(authenticate);

/**
 * The optimistic callback.
 *
 * Verifies the signature and stamps a flag so the app can honestly say
 * "confirming your payment". **No money moves here** — see `webhook.ts`.
 */
router.post(
  '/:paymentId/checkout-callback',
  requireRoles('customer'),
  handle(async (req, res) => {
    const { paymentId } = paymentIdParamSchema.parse(req.params);
    const input = checkoutCallbackSchema.parse(req.body);

    const payment = await service.recordCheckoutCallback(
      deps(req),
      getAuthUser(req).id,
      paymentId,
      {
        gatewayOrderId: input.razorpay_order_id,
        gatewayPaymentId: input.razorpay_payment_id,
        signature: input.razorpay_signature,
      },
    );

    res.status(200).json({ payment, message: req.t('payments.confirming') });
  }),
);

/**
 * Refunds moved to `/api/v1/admin/payments/:paymentId/refund` in Phase 11.
 *
 * It was always an ops-only action guarded by a role check, but it sat outside
 * the `/api/v1/admin` prefix — which is the prefix the audit-coverage test
 * enumerates. A money mutation escaping that net is exactly the hole the test
 * exists to close, so the route went where the net is.
 */

/* -------------------------------------------------------------------------- */
/* Mounted under /api/v1/bookings/:bookingId                                  */
/* -------------------------------------------------------------------------- */

export const bookingPaymentRouter = Router({ mergeParams: true });

bookingPaymentRouter.use(authenticate);

bookingPaymentRouter.get(
  '/',
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const payments = await service.listBookingPayments(deps(req), getAuthUser(req).id, bookingId);

    res.status(200).json({ bookingId, payments });
  }),
);

/**
 * Starts (or re-returns) the gateway order for the frozen payable.
 *
 * Calling it twice returns the same order, deliberately — two live orders for
 * one bill is how a customer pays twice.
 */
bookingPaymentRouter.post(
  '/',
  requireRoles('customer'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = startPaymentSchema.parse(req.body ?? {});
    const context = getContext(req);

    if (input.purpose === 'visit_fee_upfront' && !context.config.COLLECT_FEE_AT_BOOKING) {
      throw AppError.badRequest('Upfront visit fees are not being collected', {
        messageKey: 'errors.payments.upfrontDisabled',
      });
    }

    const result = await service.startPayment(
      deps(req),
      getAuthUser(req).id,
      bookingId,
      input.purpose,
    );

    res
      .status(result.reused ? 200 : 201)
      .json({ ...result, message: req.t('payments.orderReady') });
  }),
);

/** The technician took notes at the door. */
bookingPaymentRouter.post(
  '/cash',
  requireRoles('technician'),
  handle(async (req, res) => {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const input = cashCollectedSchema.parse(req.body ?? {});
    const payment = await service.recordCashCollected(
      deps(req),
      getAuthUser(req).id,
      bookingId,
      input.note,
    );

    res.status(201).json({ payment, message: req.t('payments.cashRecorded') });
  }),
);

/* -------------------------------------------------------------------------- */
/* Provider wallet                                                            */
/* -------------------------------------------------------------------------- */

export const walletRouter = Router();

walletRouter.use(authenticate, requireRoles('technician'));

walletRouter.get(
  '/',
  handle(async (req, res) => {
    const wallet = await payouts.getWallet(deps(req), getAuthUser(req).id);
    res.status(200).json({ wallet });
  }),
);

/* -------------------------------------------------------------------------- */
/* Ops                                                                        */
/* -------------------------------------------------------------------------- */

export const opsRouter = Router();

opsRouter.use(authenticate, requireRoles('ops', 'admin'));

opsRouter.post(
  '/:paymentId/refund',
  handle(async (req, res) => {
    const { paymentId } = paymentIdParamSchema.parse(req.params);
    const input = refundSchema.parse(req.body);

    const refund = await refunds.requestRefund(
      opsDeps(req, {
        action: AUDIT_ACTIONS.paymentRefund,
        targetType: 'payment',
        targetId: paymentId,
        // The substance: how much, and why. A refund with no stated reason is
        // the one an auditor will ask about first.
        payload: { amountPaise: input.amountPaise ?? null, reason: input.reason ?? null },
      }),
      paymentId,
      input,
    );

    res.status(202).json({ refund, message: req.t('payments.refundRequested') });
  }),
);

/** Drafts a batch from everybody's current balance. Also runs as a daily job. */
opsRouter.post(
  '/payout-batches',
  handle(async (req, res) => {
    const result = await payouts.buildPayoutBatch(
      opsDeps(req, {
        action: AUDIT_ACTIONS.payoutBatchCreate,
        targetType: 'payout_batch',
        targetId: null,
        payload: {},
      }),
      getAuthUser(req).id,
    );

    res.status(result.batchId ? 201 : 200).json(result);
  }),
);

/** Closes a reviewed batch. Everything in it has been paid or failed by hand. */
opsRouter.post(
  '/payout-batches/:batchId/close',
  handle(async (req, res) => {
    const { batchId } = batchIdParamSchema.parse(req.params);

    const batch = await payouts.completeBatch(
      opsDeps(req, {
        action: AUDIT_ACTIONS.payoutBatchClose,
        targetType: 'payout_batch',
        targetId: batchId,
        payload: {},
      }),
      batchId,
    );

    res.status(200).json({ batch });
  }),
);

opsRouter.get(
  '/payout-batches/:batchId',
  handle(async (req, res) => {
    const context = getContext(req);
    const batch = await context.prisma.payoutBatch.findUnique({
      where: { id: String((req.params as { batchId?: string }).batchId ?? '') },
      include: { payouts: true },
    });

    if (!batch) {
      throw new AppError(404, 'PAYOUT_BATCH_NOT_FOUND', 'No such payout batch', {
        messageKey: 'errors.payments.batchNotFound',
      });
    }

    res.status(200).json({ batch: payouts.toBatchView(batch) });
  }),
);

/** Ops made the transfer by hand and typed the reference back in. */
opsRouter.post(
  '/payouts/:payoutId/paid',
  handle(async (req, res) => {
    const { payoutId } = payoutIdParamSchema.parse(req.params);
    const input = markPaidSchema.parse(req.body);

    const payout = await payouts.markPayoutPaid(
      opsDeps(req, {
        action: AUDIT_ACTIONS.payoutMarkPaid,
        targetType: 'payout',
        targetId: payoutId,
        // The UTR is the substance: it is the number a technician quotes at
        // their bank when they say the money never arrived.
        payload: { utrRef: input.utrRef },
      }),
      payoutId,
      input.utrRef,
    );

    res.status(200).json({ payout, message: req.t('payments.payoutPaid') });
  }),
);

opsRouter.post(
  '/payouts/:payoutId/failed',
  handle(async (req, res) => {
    const { payoutId } = payoutIdParamSchema.parse(req.params);
    const input = failPayoutSchema.parse(req.body);

    const payout = await payouts.markPayoutFailed(
      opsDeps(req, {
        action: AUDIT_ACTIONS.payoutMarkFailed,
        targetType: 'payout',
        targetId: payoutId,
        payload: { note: input.note },
      }),
      payoutId,
      input.note,
    );

    res.status(200).json({ payout });
  }),
);

/** A technician paid back what they owed on cash jobs. */
opsRouter.post(
  '/dues/settle',
  handle(async (req, res) => {
    const input = settleDuesSchema.parse(req.body);

    const result = await service.settleProviderDues(
      opsDeps(req, {
        action: AUDIT_ACTIONS.duesSettle,
        targetType: 'provider',
        targetId: input.providerId,
        payload: { amountPaise: input.amountPaise, memo: input.memo ?? null },
      }),
      input.providerId,
      input.amountPaise,
      input.memo ?? null,
    );

    res.status(200).json({ ...result, message: req.t('payments.duesSettled') });
  }),
);

/** The platform's own position. Straight from the view — no cached numbers. */
opsRouter.get(
  '/ledger/position',
  handle(async (req, res) => {
    const { platformPosition } = await import('./ledger');
    res.status(200).json({ position: await platformPosition(getContext(req).prisma) });
  }),
);

/* -------------------------------------------------------------------------- */
/* Webhooks — public, raw body, signature verified                            */
/* -------------------------------------------------------------------------- */

export const webhookRouter = Router();

/**
 * `POST /api/v1/webhooks/razorpay`
 *
 * Public by necessity: the gateway has no credentials of ours. The signature is
 * the authentication, computed over the **exact bytes** — which is why the raw
 * body parser is mounted ahead of `express.json()` in `app.ts`.
 *
 * The handler does as little as possible: verify, record, acknowledge. Every
 * decision about money happens later, off the outbox.
 */
webhookRouter.post(
  '/razorpay',
  handle(async (req, res) => {
    const context = getContext(req);

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature = String(req.header('x-razorpay-signature') ?? '');

    if (raw.length === 0) {
      throw AppError.badRequest('Empty webhook body', { messageKey: 'errors.payments.webhookBad' });
    }

    if (!context.gateway.verifyWebhookSignature(raw, signature)) {
      // Deliberately terse and deliberately a 400: an unsigned caller learns
      // nothing about what we expected.
      context.logger.warn({ signaturePresent: signature.length > 0 }, 'webhook signature rejected');

      throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Signature verification failed', {
        messageKey: 'errors.payments.webhookBad',
      });
    }

    const parsed = context.gateway.parseWebhook(raw);

    /**
     * The idempotency key.
     *
     * Razorpay sends `X-Razorpay-Event-Id` per delivery. If it is missing —
     * which the fake allows a test to simulate — fall back to the entity id, so
     * a redelivery still collides rather than posting twice.
     */
    const eventId =
      req.header('x-razorpay-event-id') ??
      `${parsed.eventType}:${parsed.paymentId ?? parsed.refundId ?? parsed.orderId ?? 'unknown'}`;

    const result = await repo.recordWebhookEvent(context.prisma, {
      gateway: context.gateway.name,
      gatewayEventId: eventId,
      eventType: parsed.eventType,
      payload: JSON.parse(raw.toString('utf8')) as never,
      topic: PAYMENT_TOPICS.webhookReceived,
    });

    context.logger.info(
      { eventId, eventType: parsed.eventType, duplicate: !result.isNew },
      result.isNew ? 'webhook accepted' : 'webhook already seen; acknowledged without reprocessing',
    );

    // 200 either way. Telling a gateway "error" for something we already handled
    // only makes it retry harder.
    res.status(200).json({ received: true, duplicate: !result.isNew });
  }),
);
