import type { AppContext } from '../../core/context';
import type { DeliveredEvent, OutboxRegistry } from '../../core/outbox';
import { completeRefund } from './refunds';
import * as repo from './repository';
import { capturePayment, failPayment, PaymentAmountMismatchError } from './service';
import { PAYMENT_TOPICS } from './state-machine';

/**
 * ## Law #2
 *
 * > The gateway webhook is the only source of payment truth.
 *
 * A browser callback can be forged, replayed, or — far more often — simply never
 * arrive, because the customer locked their phone the moment the UPI app said
 * "success". The webhook is server-to-server, signed, and retried until we
 * acknowledge it. So the webhook records; everything else at most *displays*.
 *
 * ## Why processing is asynchronous
 *
 * The route verifies the signature, writes a `webhook_events` row and answers
 * `200` — that is all. The actual work happens off the outbox, because a gateway
 * gives you a few seconds before it calls the delivery failed and retries, and a
 * handler that posts ledger rows inside that budget is a handler that will one
 * day cause a duplicate delivery storm at exactly the wrong moment.
 *
 * ## Idempotency
 *
 * `webhook_events.gateway_event_id` is UNIQUE, and that one constraint is the
 * whole mechanism. A duplicate delivery loses the insert, no outbox row is
 * written, and nothing runs a second time. The handlers below are *also*
 * idempotent — capture ignores a payment that is no longer `created`, refund
 * completion ignores one already `processed` — because at-least-once delivery
 * from our own outbox means they will be called twice eventually.
 */

/** Event types we act on. Anything else is recorded and acknowledged. */
export const HANDLED_EVENT_TYPES = [
  'payment.captured',
  'payment.failed',
  'refund.processed',
  'refund.failed',
] as const;

export interface WebhookProcessResult {
  status: 'processed' | 'ignored' | 'parked';
  reason?: string;
}

/**
 * Applies one recorded delivery.
 *
 * Errors are **parked, not thrown onward**: a webhook we cannot apply is an ops
 * problem, and retrying it forever against a gateway that will keep saying the
 * same thing achieves nothing. The row keeps its `processing_error` and stays
 * unprocessed so Phase 11 can list it.
 */
export async function processWebhookEvent(
  context: AppContext,
  webhookEventId: string,
): Promise<WebhookProcessResult> {
  const event = await repo.findWebhookEvent(context.prisma, webhookEventId);

  if (!event) return { status: 'ignored', reason: 'no such webhook event' };

  if (event.processedAt) {
    // Our own outbox delivered it twice. That is the deal, and this is the
    // no-op that makes it survivable.
    return { status: 'ignored', reason: 'already processed' };
  }

  const parsed = context.gateway.parseWebhook(Buffer.from(JSON.stringify(event.payload), 'utf8'));

  try {
    switch (event.eventType) {
      case 'payment.captured': {
        const payment = parsed.orderId
          ? await repo.findPaymentByOrderId(context.prisma, parsed.orderId)
          : null;

        if (!payment) {
          return park(context, webhookEventId, `no payment for order ${parsed.orderId}`);
        }

        await capturePayment(
          { context },
          {
            paymentId: payment.id,
            gatewayPaymentId: parsed.paymentId ?? '',
            amountPaise: parsed.amountPaise ?? -1,
          },
        );

        break;
      }

      case 'payment.failed': {
        const payment = parsed.orderId
          ? await repo.findPaymentByOrderId(context.prisma, parsed.orderId)
          : null;

        if (payment) await failPayment({ context }, payment.id);
        break;
      }

      case 'refund.processed': {
        if (!parsed.refundId) {
          return park(context, webhookEventId, 'refund event carried no refund id');
        }

        await completeRefund({ context }, parsed.refundId);
        break;
      }

      case 'refund.failed': {
        if (parsed.refundId) {
          const refund = await repo.findRefundByGatewayId(context.prisma, parsed.refundId);

          if (refund && refund.status === 'created') {
            await context.prisma.refund.update({
              where: { id: refund.id },
              data: { status: 'failed' },
            });
          }
        }
        break;
      }

      default:
        // Razorpay sends a great deal we do not care about. Recording and
        // acknowledging is correct; parking would fill an ops queue with noise.
        await repo.markWebhookProcessed(context.prisma, webhookEventId, null);
        return { status: 'ignored', reason: `unhandled event type ${event.eventType}` };
    }

    await repo.markWebhookProcessed(context.prisma, webhookEventId, null);
    return { status: 'processed' };
  } catch (error) {
    /**
     * An amount that does not match the frozen payable is the one failure worth
     * naming separately. It means the gateway and our books disagree about what
     * a customer owed — which is either a bug or something worse — and the only
     * safe response is to post nothing and put it in front of a person.
     */
    const reason =
      error instanceof PaymentAmountMismatchError
        ? `amount mismatch: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);

    return park(context, webhookEventId, reason);
  }
}

async function park(
  context: AppContext,
  webhookEventId: string,
  reason: string,
): Promise<WebhookProcessResult> {
  await repo.markWebhookProcessed(context.prisma, webhookEventId, reason);

  context.logger.error({ webhookEventId, reason }, 'webhook parked: money was NOT moved');

  return { status: 'parked', reason };
}

/**
 * Wires the handler onto the outbox.
 *
 * Registered at boot next to the acceptance-rate projector. The topic is
 * internal — nothing outside this module publishes it — but it rides the same
 * machinery so it gets the same retries, backoff and parking for free.
 */
export function registerWebhookProcessor(registry: OutboxRegistry, context: AppContext): void {
  const handler = async (event: DeliveredEvent): Promise<void> => {
    const result = await processWebhookEvent(context, event.aggregateId);

    context.logger.debug(
      { webhookEventId: event.aggregateId, ...result },
      'webhook event processed',
    );
  };

  registry.subscribe(PAYMENT_TOPICS.webhookReceived, handler);
}
