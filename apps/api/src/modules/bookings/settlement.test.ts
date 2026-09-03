import { describe, expect, it } from 'vitest';
import { toSettlementView } from './service';

/**
 * The state both apps draw their payment buttons from.
 *
 * It exists because there was nothing like it: the booking response carried no
 * payment information at all, so after a technician recorded cash the
 * customer's screen went on offering "Pay now" indefinitely. These cases are
 * the ones the two screens disagreed about.
 */

const captured = (method: 'cash' | 'online') => ({
  method,
  status: 'captured',
  capturedAt: new Date('2026-09-03T10:00:00.000Z'),
});

const open = (method: 'cash' | 'online') => ({
  method,
  status: 'created',
  capturedAt: null,
});

describe('toSettlementView', () => {
  it('says nothing is due before a bill is frozen', () => {
    expect(toSettlementView('IN_PROGRESS', null, [])).toMatchObject({ state: 'nothing_due' });
  });

  it('says nothing is due on an ending that owed nothing', () => {
    // A cancelled visit with no fee. Offering to collect zero is worse than
    // showing nothing.
    expect(toSettlementView('WORK_DONE', 0, [])).toMatchObject({ state: 'nothing_due' });
  });

  it('waits for the customer to choose once a bill exists', () => {
    // The technician's confirm button must not appear in this state — that was
    // the race: both sides offered a payment action at the same moment.
    expect(toSettlementView('WORK_DONE', 50000, [])).toMatchObject({
      state: 'awaiting_choice',
      method: null,
    });
  });

  it('distinguishes a chosen cash payment from an open online order', () => {
    expect(toSettlementView('WORK_DONE', 50000, [open('cash')])).toMatchObject({
      state: 'cash_chosen',
      method: 'cash',
    });
    expect(toSettlementView('WORK_DONE', 50000, [open('online')])).toMatchObject({
      state: 'online_pending',
      method: 'online',
    });
  });

  it('reports paid for either rail, with when', () => {
    for (const method of ['cash', 'online'] as const) {
      const view = toSettlementView('WORK_DONE', 50000, [captured(method)]);
      expect(view.state).toBe('paid');
      expect(view.method).toBe(method);
      expect(view.paidAt).toBe('2026-09-03T10:00:00.000Z');
    }
  });

  it('reports paid even when an abandoned attempt sits alongside', () => {
    /**
     * The exact shape after a customer chooses cash, changes their mind, and
     * pays online. The abandoned row stays as history and must not outvote the
     * captured one — otherwise the customer is asked to pay a second time.
     */
    const view = toSettlementView('WORK_DONE', 50000, [
      captured('online'),
      { method: 'cash', status: 'failed', capturedAt: null },
    ]);

    expect(view.state).toBe('paid');
    expect(view.method).toBe('online');
  });

  it('ignores a failed attempt and asks again', () => {
    // A withdrawn cash choice frees the slot: the customer must be offered the
    // choice again rather than left with a bill they cannot settle.
    expect(
      toSettlementView('WORK_DONE', 50000, [{ method: 'cash', status: 'failed', capturedAt: null }]),
    ).toMatchObject({ state: 'awaiting_choice' });
  });

  it('still reports paid after a refund', () => {
    // Money did move. A refunded booking is not an unpaid one, and offering to
    // collect it again would take the money twice.
    expect(
      toSettlementView('WORK_DONE', 50000, [
        { method: 'online', status: 'refunded', capturedAt: new Date('2026-09-03T10:00:00.000Z') },
      ]),
    ).toMatchObject({ state: 'paid' });
  });
});
