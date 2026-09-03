import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../core/config';
import type { AppLogger } from '../../../core/logger';
import { createFakeGateway, parseRazorpayWebhook } from './fake';
import { createPaymentGateway } from './index';

const OPTIONS = {
  keyId: 'rzp_test_example',
  keySecret: 'example-key-secret',
  webhookSecret: 'example-webhook-secret',
};

const gateway = () => createFakeGateway(OPTIONS);

describe('fake gateway — signatures are real', () => {
  /**
   * The fake exists so CI never touches the internet, not so verification is
   * skipped. If these signatures were rubber stamps, every webhook test in the
   * repo would be testing nothing at all.
   */
  it('computes a webhook signature the same way Razorpay does', () => {
    const body = Buffer.from('{"event":"payment.captured"}', 'utf8');
    const expected = createHmac('sha256', OPTIONS.webhookSecret)
      .update(body.toString('utf8'))
      .digest('hex');

    expect(gateway().verifyWebhookSignature(body, expected)).toBe(true);
  });

  it('rejects a body that has been altered by one byte', () => {
    const adapter = gateway();
    const { raw, signature } = adapter.webhookBody('payment.captured', {
      id: 'pay_1',
      amount: 100,
    });

    const tampered = Buffer.from(raw.toString('utf8').replace('100', '900'), 'utf8');

    expect(adapter.verifyWebhookSignature(raw, signature)).toBe(true);
    expect(adapter.verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  it('rejects an empty, short or wrong signature without throwing', () => {
    const adapter = gateway();
    const { raw, signature } = adapter.webhookBody('payment.captured', { id: 'pay_1' });

    // Length mismatch must be a `false`, not a timingSafeEqual crash.
    expect(adapter.verifyWebhookSignature(raw, '')).toBe(false);
    expect(adapter.verifyWebhookSignature(raw, 'abc')).toBe(false);
    expect(adapter.verifyWebhookSignature(raw, 'f'.repeat(signature.length))).toBe(false);
  });

  it('verifies a checkout signature over `order|payment`', () => {
    const adapter = gateway();
    const expected = createHmac('sha256', OPTIONS.keySecret).update('order_x|pay_y').digest('hex');

    expect(adapter.verifyCheckoutSignature('order_x', 'pay_y', expected)).toBe(true);
    // The order matters: swapping the two must fail.
    expect(adapter.verifyCheckoutSignature('pay_y', 'order_x', expected)).toBe(false);
  });

  it('does not accept a webhook signature as a checkout signature', () => {
    // Different secrets, different constructions. Mixing them up is a real bug
    // and it must not silently pass.
    const adapter = gateway();
    const webhookStyle = createHmac('sha256', OPTIONS.webhookSecret)
      .update('order_x|pay_y')
      .digest('hex');

    expect(adapter.verifyCheckoutSignature('order_x', 'pay_y', webhookStyle)).toBe(false);
  });
});

describe('fake gateway — orders and refunds', () => {
  it('issues deterministic ids and remembers what it issued', async () => {
    const adapter = gateway();

    const first = await adapter.createOrder({ amountPaise: 22_900, receipt: 'bk_1' });
    const second = await adapter.createOrder({ amountPaise: 5_000, receipt: 'bk_2' });

    expect(first.orderId).not.toBe(second.orderId);
    expect(first.amountPaise).toBe(22_900);
    expect(first.currency).toBe('INR');
    expect(first.keyId).toBe(OPTIONS.keyId);
    expect(adapter.orders().size).toBe(2);
  });

  it('captures an order it knows and refuses one it does not', async () => {
    const adapter = gateway();
    const order = await adapter.createOrder({ amountPaise: 1_000, receipt: 'bk_1' });

    expect(adapter.captureOrder(order.orderId).amountPaise).toBe(1_000);
    expect(() => adapter.captureOrder('order_nope')).toThrow(/no order/);
  });

  it('records refunds so a test can assert the adapter was actually called', async () => {
    const adapter = gateway();
    const refund = await adapter.initiateRefund({ paymentId: 'pay_1', amountPaise: 500 });

    expect(refund.amountPaise).toBe(500);
    expect(refund.status).toBe('pending');
    expect(adapter.refunds().get(refund.refundId)?.paymentId).toBe('pay_1');
  });
});

describe('parseRazorpayWebhook', () => {
  it('flattens a payment event', () => {
    const raw = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 22_900 } } },
      }),
      'utf8',
    );

    expect(parseRazorpayWebhook(raw)).toMatchObject({
      eventType: 'payment.captured',
      paymentId: 'pay_1',
      orderId: 'order_1',
      amountPaise: 22_900,
      refundId: null,
    });
  });

  it('reads a refund event the other way round', () => {
    // On a refund event, `id` is the refund and `payment_id` is what it refunds.
    const raw = Buffer.from(
      JSON.stringify({
        event: 'refund.processed',
        payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 5_000 } } },
      }),
      'utf8',
    );

    expect(parseRazorpayWebhook(raw)).toMatchObject({
      eventType: 'refund.processed',
      refundId: 'rfnd_1',
      paymentId: 'pay_1',
      amountPaise: 5_000,
    });
  });

  it('survives a body with nothing useful in it', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'order.paid' }), 'utf8');

    expect(parseRazorpayWebhook(raw)).toMatchObject({
      eventType: 'order.paid',
      paymentId: null,
      orderId: null,
      amountPaise: null,
    });
  });

  it('round-trips through the fake body builder', () => {
    const adapter = gateway();
    const { raw } = adapter.webhookBody('payment.captured', {
      id: 'pay_9',
      order_id: 'order_9',
      amount: 12_345,
    });

    expect(adapter.parseWebhook(raw)).toMatchObject({
      eventType: 'payment.captured',
      paymentId: 'pay_9',
      orderId: 'order_9',
      amountPaise: 12_345,
    });
  });
});

describe('createPaymentGateway — an unbuilt gateway must not become the fake', () => {
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as AppLogger;

  const config = (gateway: string): AppConfig =>
    ({ PAYMENT_GATEWAY: gateway, RAZORPAY_KEY_ID: undefined }) as unknown as AppConfig;

  it('refuses a gateway that is configured but has no adapter', () => {
    /**
     * `paytm` is a valid `PAYMENT_GATEWAY` value — the enum and the config
     * landed before the adapter — and the production guard only refuses the
     * literal string `fake`. So it passed every check and fell through to the
     * last branch, which returned an in-memory fake that reports every payment
     * as captured. In production that marks bills paid that nobody paid.
     */
    expect(() => createPaymentGateway(config('paytm'), logger)).toThrow(/has no adapter/);
  });

  it('still builds the fake when the fake is what was asked for', () => {
    expect(createPaymentGateway(config('fake'), logger).name).toBe('fake');
  });
});
