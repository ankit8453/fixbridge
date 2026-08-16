import { describe, expect, it } from 'vitest';
import {
  BILLABLE_BOOKING_STATUSES,
  BOOKING_EVENT_TYPES,
  BOOKING_STATUSES,
  BOOKING_TOPICS,
  NON_TRANSITIONING_EVENTS,
  TERMINAL_BOOKING_STATUSES,
  TRANSITIONS,
  applyBookingEvent,
  isBillableBooking,
  isTerminalBooking,
  projectBookingStatus,
  topicFor,
  type BookingActor,
  type BookingEventType,
  type BookingStatus,
} from './state-machine';

const ACTORS: BookingActor[] = ['customer', 'provider', 'system', 'ops'];

describe('booking transition table', () => {
  it('has no duplicate (from, event) pair', () => {
    const seen = new Set<string>();

    for (const rule of TRANSITIONS) {
      const key = `${rule.from}:${rule.event}`;
      expect(seen.has(key), `duplicate rule for ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('never starts a rule from a terminal status', () => {
    for (const rule of TRANSITIONS) {
      expect(isTerminalBooking(rule.from), `${rule.from} is terminal`).toBe(false);
    }
  });

  it('gives every event type an outbox topic', () => {
    for (const event of BOOKING_EVENT_TYPES) {
      expect(topicFor(event)).toBe(BOOKING_TOPICS[event]);
      // Quote events publish under `quotation.*` so a pricing subscriber does
      // not have to sift booking events to find them.
      expect(topicFor(event)).toMatch(/^(booking|quotation)\.[a-z_]+$/);
    }
  });

  it('publishes quote events under quotation, and everything else under booking', () => {
    for (const event of BOOKING_EVENT_TYPES) {
      const expected = event.startsWith('quote_') ? 'quotation.' : 'booking.';
      expect(topicFor(event).startsWith(expected), `${event} → ${topicFor(event)}`).toBe(true);
    }
  });

  it('gives every terminal status a pricing rule, billable or not', () => {
    // A future terminal status that is neither must not slip through: it would
    // reach `computePayable` and throw at the worst possible moment.
    for (const status of TERMINAL_BOOKING_STATUSES) {
      expect(typeof isBillableBooking(status)).toBe('boolean');
    }

    expect(BILLABLE_BOOKING_STATUSES.every((status) => isTerminalBooking(status))).toBe(true);
    expect(isBillableBooking('WORK_DONE')).toBe(true);
    expect(isBillableBooking('CLOSED_QUOTE_DECLINED')).toBe(true);
    // Nothing was done and nobody turned up.
    expect(isBillableBooking('EXPIRED')).toBe(false);
    expect(isBillableBooking('REJECTED')).toBe(false);
    expect(isBillableBooking('CANCELLED_BY_CUSTOMER')).toBe(false);
  });

  it('reaches every non-initial status from somewhere', () => {
    const reachable = new Set<BookingStatus>(['REQUESTED', ...TRANSITIONS.map((rule) => rule.to)]);

    for (const status of BOOKING_STATUSES) {
      expect(reachable.has(status), `${status} is unreachable`).toBe(true);
    }
  });

  /**
   * The rule the whole flow leans on. Once a technician is at the door, a
   * cancellation would erase a visit that actually happened.
   */
  it('allows no cancellation from ARRIVED onwards', () => {
    for (const status of ['ARRIVED', 'IN_PROGRESS'] as BookingStatus[]) {
      for (const event of [
        'cancelled_by_customer',
        'cancelled_by_provider',
      ] as BookingEventType[]) {
        for (const actor of ACTORS) {
          expect(applyBookingEvent(status, event, actor).ok, `${status}/${event}/${actor}`).toBe(
            false,
          );
        }
      }
    }
  });

  it('never lets ops move a booking', () => {
    for (const status of BOOKING_STATUSES) {
      for (const event of BOOKING_EVENT_TYPES) {
        if (NON_TRANSITIONING_EVENTS.includes(event)) continue;

        expect(applyBookingEvent(status, event, 'ops').ok, `${status}/${event}`).toBe(false);
      }
    }
  });
});

describe('applyBookingEvent', () => {
  /**
   * Exhaustive: every status × event × actor. The table says yes to exactly the
   * combinations it lists, and the enumeration is what proves it — a spot check
   * would let a stray extra rule through unnoticed.
   */
  it('accepts exactly the combinations the table lists', () => {
    for (const from of BOOKING_STATUSES) {
      for (const event of BOOKING_EVENT_TYPES) {
        for (const actor of ACTORS) {
          const outcome = applyBookingEvent(from, event, actor);

          if (isTerminalBooking(from)) {
            expect(outcome).toEqual({ ok: false, reason: 'terminal' });
            continue;
          }

          if (event === 'requested') {
            expect(outcome).toEqual({ ok: false, reason: 'not_allowed' });
            continue;
          }

          if (NON_TRANSITIONING_EVENTS.includes(event)) {
            expect(outcome).toEqual({ ok: true, status: from });
            continue;
          }

          const rule = TRANSITIONS.find((entry) => entry.from === from && entry.event === event);

          if (!rule) {
            expect(outcome).toEqual({ ok: false, reason: 'not_allowed' });
          } else if (rule.actors.includes(actor)) {
            expect(outcome).toEqual({ ok: true, status: rule.to });
          } else {
            expect(outcome).toEqual({ ok: false, reason: 'wrong_actor' });
          }
        }
      }
    }
  });

  it('separates "not allowed here" from "not allowed by you"', () => {
    // A provider may accept; a customer may not. Same event, different reason.
    expect(applyBookingEvent('REQUESTED', 'accepted', 'customer')).toEqual({
      ok: false,
      reason: 'wrong_actor',
    });

    // Nobody may mark work done straight from REQUESTED.
    expect(applyBookingEvent('REQUESTED', 'work_done', 'provider')).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });

  it('lets a price be argued over without the booking moving', () => {
    // Quote, reject, quote again, approve — the job stays IN_PROGRESS the whole
    // time. Pricing is a negotiation, not a state change.
    for (const event of [
      'quote_sent',
      'quote_withdrawn',
      'quote_approved',
      'quote_rejected',
    ] as const) {
      expect(applyBookingEvent('IN_PROGRESS', event, 'provider')).toEqual({
        ok: true,
        status: 'IN_PROGRESS',
      });
    }
  });

  it('lets only the customer end the job over a price', () => {
    expect(applyBookingEvent('IN_PROGRESS', 'work_declined', 'customer')).toEqual({
      ok: true,
      status: 'CLOSED_QUOTE_DECLINED',
    });

    // A technician who does not like how the conversation is going cancels;
    // they do not get to record the customer as having declined.
    expect(applyBookingEvent('IN_PROGRESS', 'work_declined', 'provider')).toEqual({
      ok: false,
      reason: 'wrong_actor',
    });
  });

  it('does not let a customer decline before the technician has started', () => {
    // Before IN_PROGRESS there is no price to have heard. That is a cancellation.
    for (const status of ['REQUESTED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'] as BookingStatus[]) {
      expect(applyBookingEvent(status, 'work_declined', 'customer').ok).toBe(false);
    }
  });

  it('records a failed handshake without moving the booking', () => {
    expect(applyBookingEvent('ARRIVED', 'otp_failed', 'provider')).toEqual({
      ok: true,
      status: 'ARRIVED',
    });
    expect(applyBookingEvent('ACCEPTED', 'otp_locked', 'system')).toEqual({
      ok: true,
      status: 'ACCEPTED',
    });
  });

  it('refuses everything once a booking has ended', () => {
    for (const status of TERMINAL_BOOKING_STATUSES) {
      expect(applyBookingEvent(status, 'accepted', 'provider').ok).toBe(false);
      // Even the non-transitioning ones: there is nothing left to annotate.
      expect(applyBookingEvent(status, 'otp_failed', 'provider').ok).toBe(false);
    }
  });
});

describe('projectBookingStatus', () => {
  const event = (eventType: BookingEventType, actorType: BookingActor) => ({
    eventType,
    actorType,
  });

  it('folds a full happy path to WORK_DONE', () => {
    expect(
      projectBookingStatus([
        event('requested', 'customer'),
        event('accepted', 'provider'),
        event('en_route', 'provider'),
        event('arrived', 'provider'),
        event('work_started', 'provider'),
        event('work_done', 'provider'),
      ]),
    ).toBe('WORK_DONE');
  });

  it('ignores evidence events when folding', () => {
    expect(
      projectBookingStatus([
        event('requested', 'customer'),
        event('accepted', 'provider'),
        event('arrived', 'provider'),
        event('otp_failed', 'provider'),
        event('otp_failed', 'provider'),
        event('work_started', 'provider'),
      ]),
    ).toBe('IN_PROGRESS');
  });

  it('allows arrival without an en-route ping', () => {
    // Technicians forget to tap "on my way". That is not a broken booking.
    expect(
      projectBookingStatus([
        event('requested', 'customer'),
        event('accepted', 'provider'),
        event('arrived', 'provider'),
      ]),
    ).toBe('ARRIVED');
  });

  it('throws on an empty log', () => {
    expect(() => projectBookingStatus([])).toThrow(/must have its requested event/);
  });

  it('throws when the log does not open with requested', () => {
    expect(() => projectBookingStatus([event('accepted', 'provider')])).toThrow(
      /first event is accepted/,
    );
  });

  /**
   * The loud failure that matters: if anything ever writes around the state
   * machine, the projector must refuse rather than report a plausible status
   * nobody can account for.
   */
  it('throws on a log that could not have happened', () => {
    expect(() =>
      projectBookingStatus([
        event('requested', 'customer'),
        event('accepted', 'provider'),
        event('work_done', 'provider'),
      ]),
    ).toThrow(/work_done by provider is not valid from ACCEPTED/);
  });

  it('throws on an event appended after a terminal one', () => {
    expect(() =>
      projectBookingStatus([
        event('requested', 'customer'),
        event('rejected', 'provider'),
        event('accepted', 'provider'),
      ]),
    ).toThrow(/\(terminal\)/);
  });

  it('is a pure fold — replaying the same log twice gives the same answer', () => {
    const log = [
      event('requested', 'customer'),
      event('accepted', 'provider'),
      event('cancelled_by_customer', 'customer'),
    ];

    expect(projectBookingStatus(log)).toBe(projectBookingStatus(log));
    expect(projectBookingStatus(log)).toBe('CANCELLED_BY_CUSTOMER');
  });
});
