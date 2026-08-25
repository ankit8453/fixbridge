import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { consumeRateLimit } from '../../core/rate-limit';
import { verifyPassword } from './password';

/**
 * Staff sign-in: email + password, one call, no OTP.
 *
 * ## Why one factor, stated plainly
 *
 * This is a deliberate product decision, not an oversight. Staff have no phone
 * on file (see the `AdminUser` model — they are not `users` rows), and no email
 * transport is wired up, so there is no second channel to send a code over. The
 * owner chose email + password knowing this.
 *
 * Because the password is the only factor, everything around it has to carry
 * more weight than it would in a two-step flow:
 *
 *   - **scrypt** hashing with per-hash cost parameters (`password.ts`), so a
 *     stolen database is not a list of passwords.
 *   - **Two rate limits**, per email and per IP, both consumed *before* the
 *     password is checked. The two attacks are different — one attacker
 *     guessing many passwords for one known account, and one attacker trying
 *     one common password against many accounts. A limit on either alone leaves
 *     the other wide open.
 *   - **No oracle.** A wrong password, an unknown email and a disabled account
 *     produce the identical error and take the same work. Any observable
 *     difference would turn this endpoint into a way to enumerate staff
 *     accounts, which are precisely the ones worth attacking.
 *   - **An audit row for every mutating action** taken once inside.
 *
 * ## There is no endpoint that creates one of these accounts
 *
 * The single admin is bootstrapped by `prisma/bootstrap-admin.ts` from
 * environment variables. Sub-admins are created from inside the dashboard by
 * that admin. Neither path is reachable from an unauthenticated request.
 */

/** Deliberately vague, and identical for every failure mode. */
const invalidCredentials = (): AppError =>
  new AppError(401, 'ADMIN_CREDENTIALS_INVALID', 'Those credentials were not accepted', {
    messageKey: 'errors.auth.adminCredentialsInvalid',
  });

/**
 * A real scrypt hash of a value nothing will ever submit.
 *
 * Verified against when no account matches, so an unknown email costs the same
 * ~100ms of key derivation as a real one. Returning early instead would answer
 * in under a millisecond and make the response time a reliable oracle for which
 * emails are staff accounts.
 *
 * It has to be a *well-formed* hash or `verifyPassword` would reject it on
 * shape alone and skip the work that makes the timing match.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$0000000000000000000000000000000000000000000000000000000000000000$' +
  '0000000000000000000000000000000000000000000000000000000000000000';

export interface AdminIdentity {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'subadmin';
}

/**
 * Normalises an email the same way the database's unique index does.
 *
 * The index is on `LOWER(email)`, so `Admin@x.com` and `admin@x.com` are one
 * account there. Lower-casing here keeps the lookup agreeing with it — without
 * this, a sign-in typed with different capitalisation would miss a row that the
 * database considers the same account.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Verifies email + password and returns who signed in.
 *
 * Returns the identity rather than a session: issuing tokens is the route's
 * job, and keeping it out of here means this function can be tested without a
 * JWT secret or a device id.
 */
export async function adminLogin(
  context: AppContext,
  input: { email: string; password: string },
  info: { ip: string },
): Promise<AdminIdentity> {
  const email = normalizeEmail(input.email);

  /**
   * Consumed before the lookup, and for a malformed email too — otherwise a
   * cheap early return on "that is not an email" would be a free probe that
   * never touches the limiter.
   */
  const perEmail = await consumeRateLimit(
    context.redis,
    `auth:admin:rate:email:${email.slice(0, 80)}`,
    context.config.ADMIN_LOGIN_MAX_ATTEMPTS,
    context.config.ADMIN_LOGIN_WINDOW_SECONDS,
  );

  if (!perEmail.allowed) {
    throw AppError.tooManyRequests(
      'Too many sign-in attempts for this account',
      perEmail.retryAfterSeconds,
      { messageKey: 'errors.auth.adminTooManyAttempts' },
    );
  }

  const perIp = await consumeRateLimit(
    context.redis,
    `auth:admin:rate:ip:${info.ip}`,
    context.config.ADMIN_LOGIN_MAX_PER_IP,
    context.config.ADMIN_LOGIN_WINDOW_SECONDS,
  );

  if (!perIp.allowed) {
    throw AppError.tooManyRequests(
      'Too many sign-in attempts from this address',
      perIp.retryAfterSeconds,
      { messageKey: 'errors.auth.adminTooManyAttempts' },
    );
  }

  const admin = await context.prisma.adminUser.findFirst({
    where: { email },
    select: { id: true, email: true, name: true, role: true, status: true, passwordHash: true },
  });

  // Always verify, even when we already know this will fail — see DUMMY_HASH.
  const passwordOk = await verifyPassword(input.password, admin?.passwordHash ?? DUMMY_HASH);

  /**
   * One error for all four cases: no such email, wrong password, disabled
   * account, and a row somehow missing its hash. A disabled account that
   * answered differently would confirm the address belongs to real staff.
   */
  if (!admin || !passwordOk || admin.status !== 'active') {
    context.logger.warn({ email, ip: info.ip }, 'admin sign-in rejected');
    throw invalidCredentials();
  }

  /**
   * Best-effort, and deliberately not awaited into the failure path: a slow or
   * failing write here must not stop somebody signing in. It is an operational
   * signal — spotting a dormant account, or reviewing an incident — not part of
   * the authentication decision.
   */
  await context.prisma.adminUser
    .update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })
    .catch((error: unknown) => {
      context.logger.warn({ err: error, adminId: admin.id }, 'could not stamp lastLoginAt');
    });

  context.logger.info({ adminId: admin.id, role: admin.role, ip: info.ip }, 'admin signed in');

  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
}
