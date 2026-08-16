import { describe, expect, it } from 'vitest';
import {
  PAYMENT_EVENT_TYPES,
  PAYMENT_STATUSES,
  PAYMENT_TOPICS,
  PAYMENT_TRANSITIONS,
  TERMINAL_PAYMENT_STATUSES,
  applyPaymentEvent,
  isCaptured,
} from './state-machine';

describe('payment transition table', () => {
  it('has no duplicate (from, event) pair', () => {
    const seen = new Set<string>();

    for (const rule of PAYMENT_TRANSITIONS) {
      const key = `${rule.from}:${rule.event}`;
      expect(seen.has(key), `duplicate rule for ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('accepts exactly the combinations the table lists', () => {
    for (const from of PAYMENT_STATUSES) {
      for (const event of PAYMENT_EVENT_TYPES) {
        const outcome = applyPaymentEvent(from, event);

        if (TERMINAL_PAYMENT_STATUSES.includes(from)) {
          expect(outcome).toEqual({ ok: false, reason: 'terminal' });
          continue;
        }

        const rule = PAYMENT_TRANSITIONS.find(
          (entry) => entry.from === from && entry.event === event,
        );

        expect(outcome).toEqual(
          rule ? { ok: true, status: rule.to } : { ok: false, reason: 'not_allowed' },
        );
      }
    }
  });

  it('lets a failed payment be retried, and a fully refunded one be nothing', () => {
    // `failed` is not terminal: a customer whose UPI dropped may try again, and
    // the partial unique index excludes `failed` so they can.
    expect(TERMINAL_PAYMENT_STATUSES).not.toContain('failed');
    expect(TERMINAL_PAYMENT_STATUSES).toContain('refunded');

    expect(applyPaymentEvent('refunded', 'refunded_partially').ok).toBe(false);
  });

  it('walks a partial refund to a full one', () => {
    expect(applyPaymentEvent('captured', 'refunded_partially')).toEqual({
      ok: true,
      status: 'partially_refunded',
    });
    expect(applyPaymentEvent('partially_refunded', 'refunded_partially')).toEqual({
      ok: true,
      status: 'partially_refunded',
    });
    expect(applyPaymentEvent('partially_refunded', 'refunded_fully')).toEqual({
      ok: true,
      status: 'refunded',
    });
  });

  it('cannot capture anything that is not awaiting money', () => {
    for (const from of PAYMENT_STATUSES) {
      if (from === 'created') continue;
      expect(applyPaymentEvent(from, 'captured').ok, from).toBe(false);
    }
  });

  it('knows which statuses mean money actually arrived', () => {
    expect(isCaptured('created')).toBe(false);
    expect(isCaptured('failed')).toBe(false);
    // A refunded payment was still captured — the money came in and went back.
    expect(isCaptured('captured')).toBe(true);
    expect(isCaptured('partially_refunded')).toBe(true);
    expect(isCaptured('refunded')).toBe(true);
  });
});

describe('outbox topics', () => {
  it('names every topic under a stable prefix', () => {
    for (const topic of Object.values(PAYMENT_TOPICS)) {
      expect(topic).toMatch(/^(payment|payout|webhook)\.[a-z_]+$/);
    }
  });

  it('keeps the internal webhook topic separate from the public ones', () => {
    // `webhook.received` is ours; nothing outside this module publishes it.
    expect(PAYMENT_TOPICS.webhookReceived).toBe('webhook.received');
    expect(PAYMENT_TOPICS.captured).toBe('payment.captured');
  });
});
