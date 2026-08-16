/**
 * The only money formatter in this application.
 *
 * One function, deliberately. Two formatters drift, and the day they disagree is
 * the day an ops user reads ₹1,250 on one screen and ₹1,250.00 on another for
 * the same payout and has to decide which one to trust. Nothing else in `src/`
 * may call `toLocaleString` on an amount — everything goes through here.
 *
 * The API speaks paise as integers everywhere (see the root README), so this
 * takes paise and nothing else. There is no rupee-in overload on purpose: a
 * float of rupees is the bug this convention exists to prevent.
 */
export function formatPaise(paise: number): string {
  if (!Number.isFinite(paise)) return '—';

  const negative = paise < 0;
  const absolute = Math.abs(Math.round(paise));
  const rupees = Math.floor(absolute / 100);
  const remainder = absolute % 100;

  // Indian digit grouping (1,25,000 not 125,000). Ops read these numbers aloud
  // to technicians over the phone; western grouping is read wrong.
  const whole = rupees.toLocaleString('en-IN');

  // Paise are shown only when there are any. A payout of exactly ₹1,250 reads as
  // a round number because it is one — trailing `.00` everywhere is noise on a
  // screen that is mostly a table of amounts.
  const body = remainder === 0 ? whole : `${whole}.${String(remainder).padStart(2, '0')}`;

  return `${negative ? '-' : ''}₹${body}`;
}

/** Parses a rupee amount typed by a human into paise. Returns null if it is not one. */
export function parseRupeesToPaise(input: string): number | null {
  const trimmed = input.trim().replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  // Rounded through a string split rather than `* 100` — 19.99 * 100 is
  // 1998.9999999999998 in IEEE 754, and this value becomes a ledger row.
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
