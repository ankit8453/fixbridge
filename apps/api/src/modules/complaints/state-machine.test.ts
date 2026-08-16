import { describe, expect, it } from 'vitest';
import {
  COMPLAINABLE_BOOKING_STATUSES,
  COMPLAINT_BOOKING_EVENT,
  COMPLAINT_EVENTS,
  COMPLAINT_STATUSES,
  COMPLAINT_TRANSITIONS,
  TERMINAL_COMPLAINT_STATUSES,
  applyComplaintEvent,
} from './state-machine';
import { BOOKING_STATUSES } from '../bookings/state-machine';

describe('complaint transition table', () => {
  it('has no duplicate (from, event) pair', () => {
    const seen = new Set<string>();

    for (const rule of COMPLAINT_TRANSITIONS) {
      const key = `${rule.from}:${rule.event}`;
      expect(seen.has(key), `duplicate rule for ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('accepts exactly the combinations the table lists', () => {
    for (const from of COMPLAINT_STATUSES) {
      for (const event of COMPLAINT_EVENTS) {
        const outcome = applyComplaintEvent(from, event);

        if (TERMINAL_COMPLAINT_STATUSES.includes(from)) {
          expect(outcome).toEqual({ ok: false, reason: 'terminal' });
          continue;
        }

        const rule = COMPLAINT_TRANSITIONS.find(
          (entry) => entry.from === from && entry.event === event,
        );

        expect(outcome).toEqual(
          rule ? { ok: true, status: rule.to } : { ok: false, reason: 'not_allowed' },
        );
      }
    }
  });

  it('lets ops decide straight from open, without a bookkeeping step', () => {
    // A complaint that needs no investigation should not require one.
    expect(applyComplaintEvent('open', 'resolve')).toEqual({ ok: true, status: 'resolved' });
    expect(applyComplaintEvent('open', 'dismiss')).toEqual({ ok: true, status: 'dismissed' });
  });

  it('will not reopen a decided complaint', () => {
    for (const status of TERMINAL_COMPLAINT_STATUSES) {
      for (const event of COMPLAINT_EVENTS) {
        expect(applyComplaintEvent(status, event).ok, `${status}/${event}`).toBe(false);
      }
    }
  });

  it('reaches every status from somewhere', () => {
    const reachable = new Set<string>(['open', ...COMPLAINT_TRANSITIONS.map((rule) => rule.to)]);

    for (const status of COMPLAINT_STATUSES) {
      expect(reachable.has(status), `${status} is unreachable`).toBe(true);
    }
  });

  it('gives every status a booking-timeline event', () => {
    for (const status of COMPLAINT_STATUSES) {
      expect(COMPLAINT_BOOKING_EVENT[status]).toMatch(/^complaint_/);
    }
  });
});

describe('when a complaint may be raised', () => {
  /**
   * Before the technician is at the door, a grievance is a cancellation.
   * Calling it a complaint would put a dispute on somebody's record for a job
   * that never started — and there is no shortage of ways to lose a technician
   * without inventing one.
   */
  it('starts at ARRIVED and not before', () => {
    for (const status of ['REQUESTED', 'ACCEPTED', 'EN_ROUTE'] as const) {
      expect(COMPLAINABLE_BOOKING_STATUSES).not.toContain(status);
    }

    expect(COMPLAINABLE_BOOKING_STATUSES).toContain('ARRIVED');
  });

  it('covers every ending where somebody actually turned up', () => {
    expect(COMPLAINABLE_BOOKING_STATUSES).toContain('WORK_DONE');
    expect(COMPLAINABLE_BOOKING_STATUSES).toContain('CLOSED_QUOTE_DECLINED');
    expect(COMPLAINABLE_BOOKING_STATUSES).toContain('IN_PROGRESS');
  });

  it('excludes every ending where nobody did', () => {
    for (const status of [
      'REJECTED',
      'EXPIRED',
      'CANCELLED_BY_CUSTOMER',
      'CANCELLED_BY_PROVIDER',
    ] as const) {
      expect(COMPLAINABLE_BOOKING_STATUSES).not.toContain(status);
    }
  });

  it('names only statuses that actually exist', () => {
    for (const status of COMPLAINABLE_BOOKING_STATUSES) {
      expect(BOOKING_STATUSES as readonly string[]).toContain(status);
    }
  });
});
