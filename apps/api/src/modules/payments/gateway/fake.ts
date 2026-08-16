import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  GatewayOrder,
  GatewayRefund,
  GatewayWebhookEvent,
  PaymentGatewayAdapter,
} from './types';

/**
 * A gateway that behaves like Razorpay without being on the internet.
 *
 * Every test in the repo runs against this, which is the point: CI must never
 * depend on a third party's staging environment being up, and a money test that
 * is sometimes red for reasons outside the repo is a test people learn to
 * ignore.
 *
 * It is a **real** implementation of the contract, not a set of stubs. The
 * signatures are genuine HMAC-SHA256 over the exact bytes, computed the same way
 * Razorpay computes them, so the verification code under test is the same code
 * that runs in production. A fake that always returns `true` would test nothing.
 *
 * Ids are deterministic per counter so a test can assert on them, and the
 * webhook helper emits bodies in Razorpay's shape so the parser is exercised
 * too.
 */

export interface FakeGatewayOptions {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export interface FakeCapturedPayment {
  orderId: string;
  paymentId: string;
  amountPaise: number;
}

export interface FakeGateway extends PaymentGatewayAdapter {
  readonly name: 'fake';
  /** Every order this gateway has issued, by id. */
  orders(): Map<string, GatewayOrder>;
  /** Pretends the customer paid, and returns what the webhook body would be. */
  captureOrder(orderId: string, options?: { paymentId?: string }): FakeCapturedPayment;
  /** A signed webhook body, exactly as the gateway would deliver it. */
  webhookBody(
    eventType: string,
    entity: Record<string, unknown>,
    options?: { eventId?: string },
  ): { raw: Buffer; signature: string; eventId: string };
  /** Every refund asked for, so a test can assert the adapter was called. */
  refunds(): Map<string, GatewayRefund & { paymentId: string }>;
  reset(): void;
}

export function createFakeGateway(options: FakeGatewayOptions): FakeGateway {
  const issued = new Map<string, GatewayOrder>();
  const refundsIssued = new Map<string, GatewayRefund & { paymentId: string }>();
  let counter = 0;

  const next = (prefix: string): string => {
    counter += 1;
    return `${prefix}_fake${String(counter).padStart(10, '0')}`;
  };

  const sign = (secret: string, payload: string): string =>
    createHmac('sha256', secret).update(payload).digest('hex');

  /** Constant time, because a signature check that leaks timing is not a check. */
  const matches = (expected: string, actual: string): boolean => {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual, 'utf8');

    return a.length === b.length && timingSafeEqual(a, b);
  };

  return {
    name: 'fake',

    createOrder({ amountPaise }) {
      const order: GatewayOrder = {
        orderId: next('order'),
        amountPaise,
        currency: 'INR',
        keyId: options.keyId,
      };

      issued.set(order.orderId, order);
      return Promise.resolve(order);
    },

    verifyWebhookSignature(rawBody, signature) {
      return matches(sign(options.webhookSecret, rawBody.toString('utf8')), signature);
    },

    verifyCheckoutSignature(orderId, paymentId, signature) {
      // Razorpay's documented construction: `order_id|payment_id` under the key
      // secret. Reproduced exactly so the production code path is what runs.
      return matches(sign(options.keySecret, `${orderId}|${paymentId}`), signature);
    },

    initiateRefund({ paymentId, amountPaise }) {
      const refund = {
        refundId: next('rfnd'),
        amountPaise,
        status: 'pending' as const,
        paymentId,
      };

      refundsIssued.set(refund.refundId, refund);
      return Promise.resolve({
        refundId: refund.refundId,
        amountPaise,
        status: refund.status,
      });
    },

    parseWebhook(rawBody) {
      return parseRazorpayWebhook(rawBody);
    },

    orders: () => issued,
    refunds: () => refundsIssued,

    captureOrder(orderId, captureOptions) {
      const order = issued.get(orderId);
      if (!order) throw new Error(`fake gateway has no order ${orderId}`);

      return {
        orderId,
        paymentId: captureOptions?.paymentId ?? next('pay'),
        amountPaise: order.amountPaise,
      };
    },

    webhookBody(eventType, entity, bodyOptions) {
      const eventId = bodyOptions?.eventId ?? next('evt');

      // Razorpay's envelope shape, so `parseRazorpayWebhook` is under test too.
      const body = {
        entity: 'event',
        event: eventType,
        contains: [eventType.split('.')[0]],
        payload: { [eventType.split('.')[0] as string]: { entity } },
        created_at: 0,
      };

      const raw = Buffer.from(JSON.stringify(body), 'utf8');

      return {
        raw,
        signature: sign(options.webhookSecret, raw.toString('utf8')),
        eventId,
      };
    },

    /**
     * Forgets what it issued, but **keeps counting**.
     *
     * The counter deliberately does not reset. A gateway order id identifies one
     * attempt at one bill forever, and the database has a unique index saying
     * so; restarting the counter between tests would hand the same id to two
     * different payments and make the webhook lookup ambiguous — which is
     * exactly the production bug the unique index exists to prevent, so a fake
     * that reproduced it would be lying about the world.
     */
    reset() {
      issued.clear();
      refundsIssued.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

interface RazorpayEnvelope {
  event?: string;
  payload?: Record<string, { entity?: Record<string, unknown> }>;
}

/**
 * Razorpay's webhook body, flattened.
 *
 * Shared by both adapters because the wire format is the same — the fake's whole
 * purpose is to be indistinguishable at this boundary.
 *
 * **The event id comes from the `X-Razorpay-Event-Id` header, not the body**, so
 * it is supplied by the caller rather than found here; this returns everything
 * else and leaves `eventId` empty for the route to fill.
 */
export function parseRazorpayWebhook(rawBody: Buffer): GatewayWebhookEvent {
  const body = JSON.parse(rawBody.toString('utf8')) as RazorpayEnvelope;
  const eventType = body.event ?? 'unknown';

  const entities = Object.values(body.payload ?? {}).map((part) => part.entity ?? {});
  const entity = entities[0] ?? {};

  const read = (key: string): string | null => {
    const value = entity[key];
    return typeof value === 'string' ? value : null;
  };

  const amount = entity.amount;

  return {
    eventId: '',
    eventType,
    orderId: read('order_id'),
    // A `payment.*` event's own id is the payment id; a `refund.*` event carries
    // the payment it refunds in `payment_id`.
    paymentId: eventType.startsWith('payment.') ? read('id') : read('payment_id'),
    refundId: eventType.startsWith('refund.') ? read('id') : null,
    amountPaise: typeof amount === 'number' ? amount : null,
    payload: body,
  };
}
