/**
 * Client-side mirror of `apps/api/src/modules/providers/availability.ts`.
 *
 * Same reasoning as `quote-math.ts`: no shared runtime package between the
 * two deployables, so the exact overlap rule is duplicated here rather than
 * re-derived, so the editor can refuse a clashing window at the tap of "add"
 * instead of after a round trip to be told the same thing by
 * `409 AVAILABILITY_OVERLAP`. The server re-checks regardless — a database
 * exclusion constraint backs this up, same as `slot-plan.ts`'s booking
 * overlap rule.
 */

export const MINUTES_IN_DAY = 1440;

export interface AvailabilityWindow {
  /** 0 = Sunday … 6 = Saturday, matching `Date#getDay`. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/** `"18:00"` → 1080. `null` for anything that is not a real 24-hour time. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  return hours * 60 + minutes;
}

/** 1080 → `"18:00"`. */
export function formatTimeOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Half-open intervals: a window ending at 18:00 and one starting at 18:00
 * are adjacent, not overlapping — a mistri who works 9–13 then 13–17 typed
 * two normal shifts, not a mistake.
 */
export function windowsOverlap(a: AvailabilityWindow, b: AvailabilityWindow): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export type AvailabilityProblem =
  | { kind: 'invalid_day' }
  | { kind: 'out_of_range' }
  | { kind: 'end_before_start' }
  | { kind: 'overlap'; conflictsWith: AvailabilityWindow };

/**
 * Validates one candidate window against the windows already active for that
 * technician. `existing` must contain only active windows — an inactive one
 * is not a real commitment and must not block a new one.
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
    return { kind: 'invalid_day' };
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
    return { kind: 'out_of_range' };
  }

  if (endMinute <= startMinute) {
    return { kind: 'end_before_start' };
  }

  const conflict = existing.find((window) => windowsOverlap(candidate, window));
  if (conflict) return { kind: 'overlap', conflictsWith: conflict };

  return null;
}
