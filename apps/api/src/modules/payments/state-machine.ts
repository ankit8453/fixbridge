/**
 * The payment lifecycle — a transition table, like every other machine here.
 *
 * Shorter than the booking one, and the shape is the point: **every transition
 * out of `created` has `system` as its only actor.** No customer action and no
 * provider action moves a payment. Only the webhook handler does, and the
 * webhook handler is the only thing that knows what the gateway actually did.
 *
 * That is law #2 written as data rather than as a comment somebody can ignore.
 */

export const PAYMENT_STATUSES = [
  'created',
  'captured',
  'failed',
  'refunded',
  'partially_refunded',
] as const;

export type PaymentStatusName = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_EVENT_TYPES = [
  'captured',
  'failed',
  'refunded_partially',
  'refunded_fully',
] as const;

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

/** Nothing follows these. `failed` is not one — a customer may try again. */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatusName[] = ['refunded'];

export interface PaymentTransition {
  from: PaymentStatusName;
  event: PaymentEventType;
  to: PaymentStatusName;
}

export const PAYMENT_TRANSITIONS: readonly PaymentTransition[] = [
  { from: 'created', event: 'captured', to: 'captured' },
  { from: 'created', event: 'failed', to: 'failed' },

  // Refunds walk down from a captured payment. A partial can be followed by
  // another partial, or by the rest.
  { from: 'captured', event: 'refunded_partially', to: 'partially_refunded' },
  { from: 'captured', event: 'refunded_fully', to: 'refunded' },
  { from: 'partially_refunded', event: 'refunded_partially', to: 'partially_refunded' },
  { from: 'partially_refunded', event: 'refunded_fully', to: 'refunded' },
];

export type PaymentOutcome =
  { ok: true; status: PaymentStatusName } | { ok: false; reason: 'terminal' | 'not_allowed' };

export function applyPaymentEvent(
  from: PaymentStatusName,
  event: PaymentEventType,
): PaymentOutcome {
  if (TERMINAL_PAYMENT_STATUSES.includes(from)) return { ok: false, reason: 'terminal' };

  const rule = PAYMENT_TRANSITIONS.find((entry) => entry.from === from && entry.event === event);

  return rule ? { ok: true, status: rule.to } : { ok: false, reason: 'not_allowed' };
}

/** Statuses in which money has actually arrived. */
export function isCaptured(status: PaymentStatusName): boolean {
  return status === 'captured' || status === 'partially_refunded' || status === 'refunded';
}

/* -------------------------------------------------------------------------- */
/* Outbox topics                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What other modules subscribe to. Renaming one breaks a consumer silently.
 *
 * `webhook.received` is the internal one: the route records a delivery and
 * queues it here, and the handler does the work off the outbox. That indirection
 * is deliberate — a gateway gives you a few seconds to answer, and a handler
 * that posts ledger rows should never be inside that budget.
 */
export const PAYMENT_TOPICS = {
  webhookReceived: 'webhook.received',
  captured: 'payment.captured',
  failed: 'payment.failed',
  cashRecorded: 'payment.cash_recorded',
  cashNotReceived: 'payment.cash_not_received',
  refunded: 'payment.refunded',
  duesSettled: 'payment.dues_settled',
  payoutPaid: 'payout.paid',
} as const;
