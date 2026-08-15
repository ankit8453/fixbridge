import { describe, expect, it } from 'vitest';
import {
  formatTimeOfDay,
  parseTimeOfDay,
  validateWindow,
  weeklyMinutes,
  windowsOverlap,
  type AvailabilityWindow,
} from './availability';

const window = (dayOfWeek: number, start: string, end: string): AvailabilityWindow => ({
  dayOfWeek,
  startMinute: parseTimeOfDay(start) as number,
  endMinute: parseTimeOfDay(end) as number,
});

describe('parseTimeOfDay', () => {
  it('parses valid 24-hour times', () => {
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('09:30')).toBe(570);
    expect(parseTimeOfDay('18:00')).toBe(1080);
    expect(parseTimeOfDay('23:59')).toBe(1439);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseTimeOfDay('  07:15 ')).toBe(435);
  });

  it('rejects out-of-range values', () => {
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('23:60')).toBeNull();
    expect(parseTimeOfDay('-1:00')).toBeNull();
  });

  it('rejects sloppy formats', () => {
    expect(parseTimeOfDay('9:30')).toBeNull();
    expect(parseTimeOfDay('0930')).toBeNull();
    expect(parseTimeOfDay('09:30:00')).toBeNull();
    expect(parseTimeOfDay('6pm')).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
  });
});

describe('formatTimeOfDay', () => {
  it('round-trips with parseTimeOfDay', () => {
    for (const time of ['00:00', '07:05', '12:30', '18:00', '23:59']) {
      expect(formatTimeOfDay(parseTimeOfDay(time) as number)).toBe(time);
    }
  });

  it('renders the exclusive end of a day as 24:00', () => {
    expect(formatTimeOfDay(1440)).toBe('24:00');
  });
});

describe('windowsOverlap', () => {
  it('ignores windows on different days', () => {
    expect(windowsOverlap(window(1, '09:00', '17:00'), window(2, '09:00', '17:00'))).toBe(false);
  });

  it('detects a partial overlap', () => {
    expect(windowsOverlap(window(1, '09:00', '13:00'), window(1, '12:00', '17:00'))).toBe(true);
  });

  it('detects full containment either way round', () => {
    expect(windowsOverlap(window(1, '09:00', '18:00'), window(1, '11:00', '12:00'))).toBe(true);
    expect(windowsOverlap(window(1, '11:00', '12:00'), window(1, '09:00', '18:00'))).toBe(true);
  });

  it('detects identical windows', () => {
    expect(windowsOverlap(window(3, '09:00', '17:00'), window(3, '09:00', '17:00'))).toBe(true);
  });

  it('treats back-to-back shifts as adjacent, not overlapping', () => {
    // Half-open intervals: 09:00–13:00 then 13:00–17:00 is a normal split shift.
    expect(windowsOverlap(window(1, '09:00', '13:00'), window(1, '13:00', '17:00'))).toBe(false);
  });
});

describe('validateWindow', () => {
  const existing = [window(1, '09:00', '13:00'), window(1, '16:00', '20:00')];

  it('accepts a window in a free slot', () => {
    expect(validateWindow(window(1, '13:00', '16:00'), existing)).toBeNull();
  });

  it('accepts the same hours on a different day', () => {
    expect(validateWindow(window(2, '09:00', '13:00'), existing)).toBeNull();
  });

  it('accepts any window when nothing exists yet', () => {
    expect(validateWindow(window(0, '09:00', '18:00'), [])).toBeNull();
  });

  it('rejects an overlap and reports what it clashed with', () => {
    const problem = validateWindow(window(1, '12:00', '17:00'), existing);

    expect(problem?.kind).toBe('overlap');
    if (problem?.kind !== 'overlap') return;
    expect(problem.conflictsWith).toEqual(window(1, '09:00', '13:00'));
  });

  it('rejects an end at or before the start — no overnight windows in v1', () => {
    expect(validateWindow(window(1, '22:00', '02:00'), [])).toEqual({
      kind: 'end_before_start',
      startMinute: 1320,
      endMinute: 120,
    });
    expect(validateWindow(window(1, '09:00', '09:00'), [])?.kind).toBe('end_before_start');
  });

  it('rejects an invalid weekday', () => {
    expect(validateWindow({ dayOfWeek: 7, startMinute: 540, endMinute: 600 }, [])?.kind).toBe(
      'invalid_day',
    );
    expect(validateWindow({ dayOfWeek: -1, startMinute: 540, endMinute: 600 }, [])?.kind).toBe(
      'invalid_day',
    );
    expect(validateWindow({ dayOfWeek: 1.5, startMinute: 540, endMinute: 600 }, [])?.kind).toBe(
      'invalid_day',
    );
  });

  it('rejects minutes outside a day', () => {
    expect(validateWindow({ dayOfWeek: 1, startMinute: -1, endMinute: 600 }, [])?.kind).toBe(
      'out_of_range',
    );
    expect(validateWindow({ dayOfWeek: 1, startMinute: 540, endMinute: 1441 }, [])?.kind).toBe(
      'out_of_range',
    );
    expect(validateWindow({ dayOfWeek: 1, startMinute: 1440, endMinute: 1440 }, [])?.kind).toBe(
      'out_of_range',
    );
  });

  it('accepts a window ending exactly at midnight', () => {
    expect(validateWindow({ dayOfWeek: 1, startMinute: 1320, endMinute: 1440 }, [])).toBeNull();
  });

  it('checks the day before anything else', () => {
    expect(validateWindow({ dayOfWeek: 9, startMinute: 900, endMinute: 100 }, [])?.kind).toBe(
      'invalid_day',
    );
  });
});

describe('weeklyMinutes', () => {
  it('sums window durations', () => {
    expect(weeklyMinutes([window(1, '09:00', '13:00'), window(2, '09:00', '11:00')])).toBe(360);
  });

  it('is zero for no windows', () => {
    expect(weeklyMinutes([])).toBe(0);
  });

  it('separates a part-timer from a full-timer', () => {
    const partTime = [1, 2, 3, 4, 5].map((day) => window(day, '18:00', '22:00'));
    const fullTime = [1, 2, 3, 4, 5, 6].map((day) => window(day, '09:00', '19:00'));

    expect(weeklyMinutes(partTime)).toBe(1200);
    expect(weeklyMinutes(fullTime)).toBe(3600);
  });
});
