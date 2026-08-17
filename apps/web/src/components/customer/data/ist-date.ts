/**
 * Formatting slot instants in Asia/Kolkata — the API stores everything in
 * that zone with no DST (`docs/bookings.md`), and a customer choosing a slot
 * has to see the same day/time a Jabalpur clock would show regardless of
 * this browser's own timezone. `Intl.DateTimeFormat` with an explicit
 * `timeZone` does the conversion; no manual offset arithmetic needed (and
 * none of the DST edge cases that arithmetic would have to get right
 * elsewhere, because India has none).
 */
const IST_TZ = 'Asia/Kolkata';

/** `YYYY-MM-DD` in IST — a stable grouping key for "slots on this day". */
export function istDayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(new Date(iso));
}

/** `HH:MM`, 24-hour, in IST. */
export function istTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

const WEEKDAY_KEYS = [
  'app.dayOfWeek.0',
  'app.dayOfWeek.1',
  'app.dayOfWeek.2',
  'app.dayOfWeek.3',
  'app.dayOfWeek.4',
  'app.dayOfWeek.5',
  'app.dayOfWeek.6',
] as const;

/** The i18n key for the IST day-of-week of an instant (0 = Sunday, matching the API's `dayOfWeek`). */
export function istDayOfWeekKey(iso: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: IST_TZ, weekday: 'short' }).format(
    new Date(iso),
  );
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  return WEEKDAY_KEYS[index >= 0 ? index : 0] ?? WEEKDAY_KEYS[0];
}

/** `D MMM` in IST, for a slot-group heading. */
export function istDateLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}
