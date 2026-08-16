/**
 * The payment gateway, behind an interface.
 *
 * Same discipline as the KYC adapters in Phase 4, and for the same reason: the
 * thing on the other side is a third party we do not control, cannot run in CI,
 * and will eventually want to replace. Every test in this repo runs against
 * `FakeGateway`; `RazorpayGateway` is exercised by one smoke test that is
 * skipped unless somebody has deliberately pointed the config at the real test
 * API.
 *
 * The interface is small because the surface we actually depend on is small —
 * make an order, check two signatures, ask for a refund. Everything else about
 * Razorpay is Razorpay's business.
 */

export interface GatewayOrder {
  /** The gateway's id, handed to the checkout SDK. */
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  /** Public key the client needs. Never the secret. */
  keyId: string;
}

export interface GatewayRefund {
  refundId: string;
  amountPaise: number;
  /** Some gateways settle instantly, most confirm by webhook. */
  status: 'pending' | 'processed';
}

/** What a verified webhook body told us, normalised. */
export interface GatewayWebhookEvent {
  /** Stable per delivery. The idempotency key. */
  eventId: string;
  eventType: string;
  orderId: string | null;
  paymentId: string | null;
  refundId: string | null;
  amountPaise: number | null;
  payload: unknown;
}

export interface PaymentGatewayAdapter {
  readonly name: 'fake' | 'razorpay';

  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder>;

  /**
   * HMAC over the **exact bytes** the gateway sent.
   *
   * A Buffer, not a string, and not a re-serialised object: JSON round-tripping
   * reorders keys and normalises whitespace, and the signature is over the
   * original text. This is the single most common way webhook verification is
   * quietly broken, so the type makes the mistake hard to make.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;

  /** The signature the checkout SDK hands back to the browser. */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;

  initiateRefund(input: {
    paymentId: string;
    amountPaise: number;
    notes?: Record<string, string>;
  }): Promise<GatewayRefund>;

  /** Normalises a verified body into the shape the handler works with. */
  parseWebhook(rawBody: Buffer): GatewayWebhookEvent;
}
