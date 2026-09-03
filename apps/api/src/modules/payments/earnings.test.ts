import { describe, expect, it } from 'vitest';
import { startOfMonthIst, startOfWeekIst } from './earnings';

/**
 * The week and month boundaries decide which side of "this week" a job falls
 * on, and getting them wrong is invisible until a technician says their Sunday
 * evening job vanished. India is UTC+5:30 with no daylight saving, so the
 * offset is exact and the arithmetic is worth pinning down.
 */

/** Reads an instant back as an IST wall clock, which is what these assert on. */
function ist(date: Date): string {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().replace('.000Z', '');
}

describe('startOfWeekIst', () => {
  it('starts the week on Monday, not Sunday', () => {
    // Thursday 3 September 2026, 18:30 IST.
    const week = startOfWeekIst(new Date('2026-09-03T13:00:00.000Z'));
    expect(ist(week)).toBe('2026-08-31T00:00:00');
  });

  it('treats Sunday as the last day of the week, not the first', () => {
    /**
     * The classic off-by-one. `getUTCDay` calls Sunday 0, so naive arithmetic
     * makes Sunday the start of a *new* week — and every job a technician did
     * on Sunday evening jumps forward into next week's total, disappearing
     * from the number they are looking at.
     */
    // Sunday 6 September 2026, 21:00 IST.
    const week = startOfWeekIst(new Date('2026-09-06T15:30:00.000Z'));
    expect(ist(week)).toBe('2026-08-31T00:00:00');
  });

  it('rolls over at midnight IST, not at midnight UTC', () => {
    /**
     * A UTC boundary rolls at 05:30 IST. Without the offset, a job finished at
     * 01:00 on Monday morning counts in the week that just ended, and one
     * finished at 23:00 on Sunday counts in the week that has not started.
     */
    // Monday 7 September, 00:30 IST — half an hour into the new week.
    const justAfter = startOfWeekIst(new Date('2026-09-06T19:00:00.000Z'));
    expect(ist(justAfter)).toBe('2026-09-07T00:00:00');

    // Sunday 6 September, 23:30 IST — half an hour before it.
    const justBefore = startOfWeekIst(new Date('2026-09-06T18:00:00.000Z'));
    expect(ist(justBefore)).toBe('2026-08-31T00:00:00');
  });

  it('handles a week that straddles a month end', () => {
    // Tuesday 1 September 2026 — the week began in August.
    const week = startOfWeekIst(new Date('2026-09-01T10:00:00.000Z'));
    expect(ist(week)).toBe('2026-08-31T00:00:00');
  });
});

describe('startOfMonthIst', () => {
  it('starts at midnight IST on the first', () => {
    const month = startOfMonthIst(new Date('2026-09-03T13:00:00.000Z'));
    expect(ist(month)).toBe('2026-09-01T00:00:00');
  });

  it('does not slip into the previous month in the small hours', () => {
    // 1 September, 02:00 IST. In UTC this is still 31 August.
    const month = startOfMonthIst(new Date('2026-08-31T20:30:00.000Z'));
    expect(ist(month)).toBe('2026-09-01T00:00:00');
  });

  it('handles January, where the previous month is another year', () => {
    const month = startOfMonthIst(new Date('2027-01-15T10:00:00.000Z'));
    expect(ist(month)).toBe('2027-01-01T00:00:00');
  });
});
