/**
 * Timestamps as ops read them.
 *
 * Relative on the surface ("3h ago") because the only question on a queue screen
 * is "how long has this person been waiting". The absolute value always follows
 * in a `title` attribute — the moment a dispute starts, "3h ago" is worthless and
 * the exact instant is the whole answer.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const delta = now.getTime() - then;
  const future = delta < 0;
  const magnitude = Math.abs(delta);

  const say = (text: string): string => (future ? `in ${text}` : `${text} ago`);

  if (magnitude < MINUTE) return 'just now';
  if (magnitude < HOUR) return say(`${Math.floor(magnitude / MINUTE)}m`);
  if (magnitude < DAY) return say(`${Math.floor(magnitude / HOUR)}h`);
  if (magnitude < 30 * DAY) return say(`${Math.floor(magnitude / DAY)}d`);

  return absoluteTime(iso);
}

/** The full instant, in IST — the timezone every one of these events happened in. */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return '—';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

/** Turns a `<input type="date">` value into the ISO instant the API's filters want. */
export function dateInputToIso(value: string, edge: 'start' | 'end'): string | undefined {
  if (!value) return undefined;

  const date = new Date(`${value}T${edge === 'start' ? '00:00:00' : '23:59:59'}.000+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
