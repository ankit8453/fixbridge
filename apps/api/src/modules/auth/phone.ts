/**
 * Phone number handling. India-first: the canonical stored form is always E.164
 * `+91XXXXXXXXXX`, whatever the user typed.
 *
 * Deliberately hand-rolled rather than pulling in libphonenumber — we accept
 * exactly one country today, and a 1 MB metadata dependency for that is not a
 * trade worth making. Revisit when a second country is real.
 */

const INDIA_CALLING_CODE = '91';

/** Indian mobile numbers are 10 digits and start with 6, 7, 8 or 9. */
const NATIONAL_MOBILE = /^[6-9]\d{9}$/;

/** Anything a human might type between digits. */
const SEPARATORS = /[\s().\-‐-―]/g;

/**
 * Normalise user input to E.164, or `null` if it is not a valid Indian mobile.
 *
 * Accepts: `9876543210`, `098765 43210`, `+91 98765-43210`, `919876543210`,
 * `0091 9876543210`.
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim().replace(SEPARATORS, '');
  if (value.length === 0) return null;

  // International prefixes: `+91…` and `0091…` both mean the same thing.
  if (value.startsWith('+')) {
    value = value.slice(1);
  } else if (value.startsWith('00')) {
    value = value.slice(2);
  }

  if (!/^\d+$/.test(value)) return null;

  // Country code present.
  if (value.length === 12 && value.startsWith(INDIA_CALLING_CODE)) {
    value = value.slice(INDIA_CALLING_CODE.length);
  }

  // Domestic trunk prefix, e.g. 09876543210.
  if (value.length === 11 && value.startsWith('0')) {
    value = value.slice(1);
  }

  if (!NATIONAL_MOBILE.test(value)) return null;

  return `+${INDIA_CALLING_CODE}${value}`;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/**
 * Mask an E.164 number for display: `+919876543210` → `+9198765*****`.
 * The full number never leaves the server in an API response.
 */
export function maskPhone(e164: string): string {
  const prefix = `+${INDIA_CALLING_CODE}`;

  if (!e164.startsWith(prefix)) {
    // Unknown shape — reveal nothing rather than guess where to cut.
    return '*'.repeat(Math.max(4, e164.length));
  }

  const national = e164.slice(prefix.length);
  const visible = national.slice(0, 5);

  return `${prefix}${visible}${'*'.repeat(Math.max(0, national.length - visible.length))}`;
}
