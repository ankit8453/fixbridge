import { describe, expect, it, vi } from 'vitest';
import { backoffSeconds, createOutboxRegistry, type DeliveredEvent } from './outbox';

describe('backoffSeconds', () => {
  it('doubles each attempt from the base', () => {
    expect(backoffSeconds(1, 5, 3600)).toBe(5);
    expect(backoffSeconds(2, 5, 3600)).toBe(10);
    expect(backoffSeconds(3, 5, 3600)).toBe(20);
    expect(backoffSeconds(4, 5, 3600)).toBe(40);
  });

  it('caps, so a long-broken consumer is retried hourly rather than never', () => {
    expect(backoffSeconds(20, 5, 3600)).toBe(3600);
    expect(backoffSeconds(100, 5, 3600)).toBe(3600);
  });

  it('treats attempt 0 and negatives as the first attempt', () => {
    // Defensive: an attempts column that somehow read 0 must not wait 2.5s.
    expect(backoffSeconds(0, 5, 3600)).toBe(5);
    expect(backoffSeconds(-3, 5, 3600)).toBe(5);
  });
});

describe('outbox registry', () => {
  const event: DeliveredEvent = {
    id: 'evt-1',
    topic: 'booking.accepted',
    aggregateType: 'booking',
    aggregateId: 'bk-1',
    payload: {},
    attempts: 0,
    createdAt: new Date('2026-03-10T00:00:00.000Z'),
  };

  it('returns an empty list for a topic nobody listens to', () => {
    const registry = createOutboxRegistry();

    // Normal, not an error: this phase emits topics Phases 9 and 10 will take up.
    expect(registry.handlersFor('booking.work_done')).toEqual([]);
    expect(registry.topics()).toEqual([]);
  });

  it('keeps every handler for a topic, in subscription order', async () => {
    const registry = createOutboxRegistry();
    const calls: string[] = [];

    registry.subscribe('booking.accepted', async () => {
      calls.push('first');
    });
    registry.subscribe('booking.accepted', async () => {
      calls.push('second');
    });

    for (const handler of registry.handlersFor('booking.accepted')) await handler(event);

    expect(calls).toEqual(['first', 'second']);
  });

  it('keeps topics separate', () => {
    const registry = createOutboxRegistry();
    const handler = vi.fn();

    registry.subscribe('booking.accepted', handler);
    registry.subscribe('booking.rejected', handler);

    expect(registry.topics().sort()).toEqual(['booking.accepted', 'booking.rejected']);
    expect(registry.handlersFor('booking.accepted')).toHaveLength(1);
  });
});
