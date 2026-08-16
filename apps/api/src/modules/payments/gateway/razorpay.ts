import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import type { AppLogger } from '../../../core/logger';
import { parseRazorpayWebhook } from './fake';
import type {
  GatewayOrder,
  GatewayRefund,
  GatewayWebhookEvent,
  PaymentGatewayAdapter,
} from './types';

/**
 * The real thing.
 *
 * Nothing in the test suite touches this class; one smoke test does, and only
 * when somebody has deliberately set `PAYMENT_GATEWAY=razorpay` with real test
 * keys in their own `.env`. That is the whole reason the adapter exists.
 *
 * **No key ever reaches a log line.** The constructor takes them, the SDK holds
 * them, and the error paths below log the gateway's message and nothing of ours.
 */

export interface RazorpayGatewayOptions {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  logger: AppLogger;
}

interface RazorpayOrderResponse {
  id: string;
  amount: number | string;
  currency: string;
}

interface RazorpayRefundResponse {
  id: string;
  amount: number | string;
  status: string;
}

export function createRazorpayGateway(options: RazorpayGatewayOptions): PaymentGatewayAdapter {
  const client = new Razorpay({ key_id: options.keyId, key_secret: options.keySecret });

  const sign = (secret: string, payload: string): string =>
    createHmac('sha256', secret).update(payload).digest('hex');

  const matches = (expected: string, actual: string): boolean => {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual, 'utf8');

    return a.length === b.length && timingSafeEqual(a, b);
  };

  return {
    name: 'razorpay',

    async createOrder({ amountPaise, receipt, notes }) {
      // Razorpay speaks paise natively, which is the one place this codebase and
      // a third party agree on units without conversion.
      const order = (await client.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt,
        ...(notes ? { notes } : {}),
      })) as unknown as RazorpayOrderResponse;

      const result: GatewayOrder = {
        orderId: order.id,
        amountPaise: Number(order.amount),
        currency: 'INR',
        keyId: options.keyId,
      };

      options.logger.info(
        { gateway: 'razorpay', orderId: result.orderId, amountPaise: result.amountPaise },
        'gateway order created',
      );

      return result;
    },

    verifyWebhookSignature(rawBody, signature) {
      // The exact bytes, never a re-serialised object — see the note on the
      // interface, and the raw-body middleware in `webhook-body.ts`.
      return matches(sign(options.webhookSecret, rawBody.toString('utf8')), signature);
    },

    verifyCheckoutSignature(orderId, paymentId, signature) {
      return matches(sign(options.keySecret, `${orderId}|${paymentId}`), signature);
    },

    async initiateRefund({ paymentId, amountPaise, notes }) {
      const refund = (await client.payments.refund(paymentId, {
        amount: amountPaise,
        ...(notes ? { notes } : {}),
      })) as unknown as RazorpayRefundResponse;

      return {
        refundId: refund.id,
        amountPaise: Number(refund.amount),
        status: refund.status === 'processed' ? 'processed' : 'pending',
      } satisfies GatewayRefund;
    },

    parseWebhook(rawBody): GatewayWebhookEvent {
      return parseRazorpayWebhook(rawBody);
    },
  };
}
