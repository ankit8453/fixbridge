import type { AppConfig } from '../../../core/config';
import type { AppLogger } from '../../../core/logger';
import { createFakeGateway, type FakeGateway } from './fake';
import { createRazorpayGateway } from './razorpay';
import type { PaymentGatewayAdapter } from './types';

export * from './types';
export { createFakeGateway } from './fake';
export type { FakeGateway } from './fake';

/**
 * Picks the gateway from config.
 *
 * `fake` is the default so a fresh clone works with no keys and no network; the
 * config schema refuses `fake` in production, so the convenient default cannot
 * become a live one by accident.
 */
export function createPaymentGateway(config: AppConfig, logger: AppLogger): PaymentGatewayAdapter {
  if (config.PAYMENT_GATEWAY === 'razorpay') {
    return createRazorpayGateway({
      // The schema guarantees these are present for this branch.
      keyId: config.RAZORPAY_KEY_ID as string,
      keySecret: config.RAZORPAY_KEY_SECRET as string,
      webhookSecret: config.RAZORPAY_WEBHOOK_SECRET as string,
      logger,
    });
  }

  logger.info({ gateway: 'fake' }, 'payment gateway: using the in-memory fake');

  return createFakeGateway({
    // Placeholders, not secrets: the fake signs with them and nothing else does.
    // Falling back keeps a keyless clone working.
    keyId: config.RAZORPAY_KEY_ID ?? 'rzp_test_fake_key',
    keySecret: config.RAZORPAY_KEY_SECRET ?? 'fake-key-secret',
    webhookSecret: config.RAZORPAY_WEBHOOK_SECRET ?? 'fake-webhook-secret',
  });
}

/** Narrows the adapter to the fake, for tests that need to drive it. */
export function asFakeGateway(adapter: PaymentGatewayAdapter): FakeGateway {
  if (adapter.name !== 'fake') {
    throw new Error(`expected the fake gateway, got "${adapter.name}"`);
  }

  return adapter as FakeGateway;
}
