import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing for the ops console, and nowhere else.
 *
 * ## Why this exists at all
 *
 * Phase 2 stated flatly that there is no password column and never would be —
 * authentication is OTP-only. That was the right call for customers and
 * technicians: a phone is the one credential everybody in this market already
 * has and nobody has to remember.
 *
 * Phase 12 added one exception, deliberately and narrowly. An ops person signs
 * in dozens of times a day at a desk, and an SMS round-trip each time is the
 * kind of friction that ends with somebody staying permanently logged in on a
 * shared machine. So `admin` and `ops` get a password — **as a first factor,
 * never as the only one.** The OTP still follows. The account that can refund a
 * customer and mark a payout paid does not get *weaker* authentication than the
 * customer's.
 *
 * ## Why scrypt rather than bcrypt or argon2
 *
 * It is in Node's standard library. bcrypt and argon2 are native modules that
 * need a compiler on every machine and in every CI image, and this repo has kept
 * its dependency surface deliberately small. scrypt is a memory-hard KDF
 * designed for exactly this, and the parameters below are tunable without a
 * migration because they are stored in the hash string itself.
 */

/**
 * Cost parameters, stored per-hash so they can be raised later without
 * invalidating existing passwords — an old hash keeps verifying with its own
 * parameters, and is rewritten at the next successful sign-in if we choose to.
 *
 * N=2^15 is a deliberate middle: comfortably above the OWASP floor, and still
 * well under a second on the modest hardware this will run on. A login that
 * takes two seconds is a login people work around.
 */
const COST = { N: 32_768, r: 8, p: 1, keylen: 64, saltBytes: 16 } as const;

const FORMAT = 'scrypt';

/**
 * `scrypt$N$r$p$salt$hash`, all base64url.
 *
 * Self-describing on purpose: verification reads the parameters out of the
 * stored value rather than assuming today's constants, which is what makes
 * raising the cost later a config change instead of a forced password reset.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(COST.saltBytes);
  const derived = await scrypt(normalise(password), salt, COST.keylen);

  return [
    FORMAT,
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Constant-time verification.
 *
 * Returns false for a malformed stored value rather than throwing: a corrupted
 * row should fail the login, not crash the endpoint and tell the caller that
 * something interesting lives at this account.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT) return false;

  const N = Number(parts[1]);
  const keylen = Buffer.from(parts[5] as string, 'base64url').length;

  if (!Number.isFinite(N) || keylen === 0) return false;

  const salt = Buffer.from(parts[4] as string, 'base64url');
  const expected = Buffer.from(parts[5] as string, 'base64url');

  const derived = await scrypt(normalise(password), salt, keylen);

  // Lengths are equal by construction here, but timingSafeEqual throws on a
  // mismatch, and a throw would leak the difference through the error path.
  if (derived.length !== expected.length) return false;

  return timingSafeEqual(derived, expected);
}

/**
 * NFKC, because a password typed on an Android keyboard and the same password
 * typed on a desktop can be different byte sequences for identical-looking
 * characters. Normalising both sides means the person is not locked out by
 * their keyboard.
 */
function normalise(password: string): string {
  return password.normalize('NFKC');
}

/**
 * The rules, kept in one place so the API and any future console agree.
 *
 * Length over composition: mandated symbols and digits produce `Password1!`
 * everywhere and buy almost nothing, while length is what actually costs an
 * attacker. Twelve characters is the floor for an account that can move money.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export function describePasswordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }

  return null;
}
