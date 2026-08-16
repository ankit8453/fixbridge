import { IST_OFFSET_MINUTES, istDayParts, istMidnightUtc } from '../bookings/slot-plan';

/**
 * When it is rude to buzz somebody's phone.
 *
 * Pure arithmetic over IST, like everything else that touches a clock in this
 * product. India has no DST, so a fixed +05:30 offset is not an approximation.
 *
 * The rule this file exists to enforce: a `standard` message caught inside the
 * window is **held, not dropped**. Dropping it would be a silent data loss the
 * recipient can never detect; holding it costs them a few hours of not knowing
 * something that was never urgent. Anything that genuinely cannot wait is
 * `critical` and never reaches this code at all.
 */

export interface QuietHoursConfig {
  /** IST hour the window opens, e.g. 22. */
  startHour: number;
  /** IST hour it closes, e.g. 7. */
  endHour: number;
}

/**
 * Equal hours mean the feature is off.
 *
 * A window from 07:00 to 07:00 could mean "never" or "always", and "always"
 * would silently stop every standard notification in the product — the kind of
 * config mistake nobody notices for a week. It means never.
 */
export function quietHoursDisabled(quiet: QuietHoursConfig): boolean {
  return quiet.startHour === quiet.endHour;
}

/** Hour of day in IST, 0–23. */
export function istHour(instant: Date): number {
  return new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000).getUTCHours();
}

export function isQuietHour(instant: Date, quiet: QuietHoursConfig): boolean {
  if (quietHoursDisabled(quiet)) return false;

  const hour = istHour(instant);

  // The normal case wraps midnight (22 → 07), so the test is an OR, not a range.
  return quiet.startHour > quiet.endHour
    ? hour >= quiet.startHour || hour < quiet.endHour
    : hour >= quiet.startHour && hour < quiet.endHour;
}

/**
 * The next instant at which a held message may go out.
 *
 * Always the *next* window opening, never "now plus some hours": everything held
 * overnight is released together at 07:00, which is when a person picks up their
 * phone anyway.
 */
export function nextWindowOpen(instant: Date, quiet: QuietHoursConfig): Date {
  const { year, month, day } = istDayParts(instant);

  const candidate = new Date(
    istMidnightUtc(year, month, day).getTime() + quiet.endHour * 60 * 60_000,
  );

  if (candidate.getTime() > instant.getTime()) return candidate;

  return new Date(candidate.getTime() + 24 * 60 * 60_000);
}
