import { describe, expect, it } from 'vitest';
import { planDelivery } from './service';
import {
  isQuietHour,
  istHour,
  nextWindowOpen,
  quietHoursDisabled,
  type QuietHoursConfig,
} from './quiet-hours';

/**
 * Quiet hours, with an injected clock and no database.
 *
 * Every instant below is written as UTC with its IST equivalent in the name,
 * because that is the only way to read a timezone test six months later.
 */

const NIGHT: QuietHoursConfig = { startHour: 22, endHour: 7 };

/** IST is UTC+05:30, fixed all year. */
const ist = (day: number, hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 7, day, hour, minute - 330));

describe('isQuietHour', () => {
  it('is quiet from 22:00 to 06:59 IST', () => {
    expect(isQuietHour(ist(16, 21, 59), NIGHT)).toBe(false);
    expect(isQuietHour(ist(16, 22, 0), NIGHT)).toBe(true);
    expect(isQuietHour(ist(16, 23, 30), NIGHT)).toBe(true);
    expect(isQuietHour(ist(17, 0, 30), NIGHT)).toBe(true);
    expect(isQuietHour(ist(17, 6, 59), NIGHT)).toBe(true);
    expect(isQuietHour(ist(17, 7, 0), NIGHT)).toBe(false);
    expect(isQuietHour(ist(17, 15, 0), NIGHT)).toBe(false);
  });

  /** A window that does not wrap midnight, for whoever configures one. */
  it('handles a daytime window that does not wrap', () => {
    const siesta: QuietHoursConfig = { startHour: 13, endHour: 16 };

    expect(isQuietHour(ist(16, 12, 59), siesta)).toBe(false);
    expect(isQuietHour(ist(16, 13, 0), siesta)).toBe(true);
    expect(isQuietHour(ist(16, 15, 59), siesta)).toBe(true);
    expect(isQuietHour(ist(16, 16, 0), siesta)).toBe(false);
  });

  /**
   * Equal hours mean off, not "always".
   *
   * "Always" would silently stop every standard notification in the product —
   * exactly the kind of config mistake nobody notices for a week.
   */
  it('treats equal hours as the feature being off', () => {
    const off: QuietHoursConfig = { startHour: 7, endHour: 7 };

    expect(quietHoursDisabled(off)).toBe(true);
    expect(isQuietHour(ist(17, 3, 0), off)).toBe(false);
    expect(isQuietHour(ist(17, 12, 0), off)).toBe(false);
  });

  it('reads the IST hour, not the UTC one', () => {
    // 20:00 UTC is 01:30 IST the next day — the case a naive check gets wrong.
    expect(istHour(new Date('2026-08-16T20:00:00.000Z'))).toBe(1);
  });
});

describe('nextWindowOpen', () => {
  it('releases at 07:00 IST the same morning for something held after midnight', () => {
    expect(nextWindowOpen(ist(17, 2, 15), NIGHT).toISOString()).toBe(ist(17, 7, 0).toISOString());
  });

  /** Held at 23:00 on the 16th, released at 07:00 on the **17th**. */
  it('rolls to the next morning for something held before midnight', () => {
    expect(nextWindowOpen(ist(16, 23, 0), NIGHT).toISOString()).toBe(ist(17, 7, 0).toISOString());
  });

  it('never returns an instant in the past', () => {
    for (const hour of [0, 6, 7, 12, 21, 22, 23]) {
      const at = ist(16, hour, 30);
      expect(nextWindowOpen(at, NIGHT).getTime()).toBeGreaterThan(at.getTime());
    }
  });
});

describe('planDelivery', () => {
  const quiet = NIGHT;

  /**
   * The inbox never waits.
   *
   * Writing the row *is* the delivery, and it buzzes nothing — holding it back
   * would only mean somebody who opens the app at 2am sees an empty list about a
   * booking that was cancelled an hour ago.
   */
  it('delivers in-app immediately, even at 3am', () => {
    const plan = planDelivery('in_app', 'standard', ist(17, 3, 0), quiet, 'in_app');

    expect(plan.status).toBe('sent');
    expect(plan.scheduledFor).toBeNull();
  });

  it('sends a critical message at 23:00 without hesitating', () => {
    const plan = planDelivery('sms', 'critical', ist(16, 23, 0), quiet, 'fake');

    expect(plan.status).toBe('queued');
    expect(plan.scheduledFor).toBeNull();
  });

  /** Held, never dropped — and the row records exactly when it will go out. */
  it('holds a standard message at 23:00 until 07:00', () => {
    const plan = planDelivery('whatsapp', 'standard', ist(16, 23, 0), quiet, 'fake');

    expect(plan.status).toBe('suppressed_quiet_hours');
    expect(plan.scheduledFor?.toISOString()).toBe(ist(17, 7, 0).toISOString());
  });

  it('sends a standard message at 10:00 straight away', () => {
    const plan = planDelivery('whatsapp', 'standard', ist(16, 10, 0), quiet, 'fake');

    expect(plan.status).toBe('queued');
    expect(plan.scheduledFor).toBeNull();
  });
});
