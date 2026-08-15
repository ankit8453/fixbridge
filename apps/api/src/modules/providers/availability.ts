/**
 * Weekly availability windows, stored as minutes from midnight.
 *
 * Pure helpers — no database — so the overlap rules can be unit-tested exhaustively.
 */

export const MINUTES_IN_DAY = 1440;

export interface AvailabilityWindow {
  /** 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/** `"18:00"` → 1080. Returns null for anything that is not a real time of day. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return hours * 60 + minutes;
}

/** 1080 → `"18:00"`. 1440 renders as `"24:00"`, the exclusive end of a day. */
export function formatTimeOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Half-open intervals: a window ending at 18:00 and one starting at 18:00 are
 * adjacent, not overlapping. Back-to-back shifts are a normal thing to enter.
 */
export function windowsOverlap(a: AvailabilityWindow, b: AvailabilityWindow): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export type AvailabilityProblem =
  | { kind: 'invalid_day'; dayOfWeek: number }
  | { kind: 'out_of_range'; startMinute: number; endMinute: number }
  /** v1 has no overnight windows — "22:00–02:00" must be two rows on two days. */
  | { kind: 'end_before_start'; startMinute: number; endMinute: number }
  | { kind: 'overlap'; conflictsWith: AvailabilityWindow };

/**
 * Validates one candidate window against the windows already stored for that
 * technician. `existing` should contain only active windows — an inactive
 * window is not a real commitment and must not block a new one.
 */
export function validateWindow(
  candidate: AvailabilityWindow,
  existing: readonly AvailabilityWindow[],
): AvailabilityProblem | null {
  if (
    !Number.isInteger(candidate.dayOfWeek) ||
    candidate.dayOfWeek < 0 ||
    candidate.dayOfWeek > 6
  ) {
    return { kind: 'invalid_day', dayOfWeek: candidate.dayOfWeek };
  }

  const { startMinute, endMinute } = candidate;

  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    startMinute >= MINUTES_IN_DAY ||
    endMinute < 1 ||
    endMinute > MINUTES_IN_DAY
  ) {
    return { kind: 'out_of_range', startMinute, endMinute };
  }

  if (endMinute <= startMinute) {
    return { kind: 'end_before_start', startMinute, endMinute };
  }

  const conflict = existing.find((window) => windowsOverlap(candidate, window));
  if (conflict) return { kind: 'overlap', conflictsWith: conflict };

  return null;
}

/** Total committed minutes per week — a cheap signal of part-time vs full-time supply. */
export function weeklyMinutes(windows: readonly AvailabilityWindow[]): number {
  return windows.reduce((total, window) => total + (window.endMinute - window.startMinute), 0);
}
