/**
 * The only money formatter in this app — same contract as
 * apps/api/src/modules/search/service.ts `formatPaise`, kept in step
 * deliberately. Money is an integer number of paise everywhere in this
 * system (see the root README); a float of rupees anywhere is the bug this
 * convention exists to prevent, so there is no rupees-in overload here on
 * purpose.
 */
export function formatPaise(paise: number): string {
  if (!Number.isFinite(paise)) return '—';

  const negative = paise < 0;
  const absolute = Math.abs(Math.round(paise));
  const rupees = Math.floor(absolute / 100);
  const remainder = absolute % 100;

  // Indian digit grouping (1,25,000 not 125,000) — the audience reads and
  // says these numbers in that grouping, not the western one.
  const whole = rupees.toLocaleString('en-IN');

  // Paise are shown only when there are any, so a round amount reads as one.
  const body = remainder === 0 ? whole : `${whole}.${String(remainder).padStart(2, '0')}`;

  return `${negative ? '-' : ''}₹${body}`;
}

/** Parses a rupee amount typed by a human (a form field) into paise, or null if invalid. */
export function parseRupeesToPaise(input: string): number | null {
  const trimmed = input.trim().replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  // Split-string rounding, not `* 100` — 19.99 * 100 is 1998.9999999999998 in
  // IEEE 754, and this value can become a quotation line item.
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
