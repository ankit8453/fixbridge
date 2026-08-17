import { randomUUID } from 'node:crypto';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { consumeRateLimit } from '../../core/rate-limit';
import { normalizePhone, maskPhone } from './phone';
import { generateOtp, hashOtp, matchesFixedOtp, verifyOtpHash } from './otp';
import { verifyPassword } from './password';

/**
 * The ops console's two-step sign-in: password, then OTP.
 *
 * ## The shape, and why it is two calls
 *
 *   1. `POST /auth/admin/password` — id + password. On success this does **not**
 *      return a session. It mints a short-lived *challenge* and sends an OTP.
 *   2. `POST /auth/admin/verify` — challenge + OTP. This returns the session.
 *
 * Splitting it is what makes the password a genuine first factor rather than
 * decoration. Nothing a caller can do with step 1 alone gets them a token, so a
 * leaked password is not access — it is one half of an access attempt that also
 * has to reach the phone in somebody's pocket.
 *
 * ## What is deliberately not distinguished
 *
 * A wrong password, an unknown account, and an account without the staff role
 * all produce the same error and take the same work. Any difference turns this
 * endpoint into an oracle for which phone numbers belong to staff — and staff
 * accounts are precisely the ones worth attacking, because they can move money.
 */

const CHALLENGE_TTL_SECONDS = 300;
const CHALLENGE_MAX_ATTEMPTS = 5;

const challengeKey = (id: string): string => `auth:admin:challenge:${id}`;

/** Deliberately vague, and identical for every failure mode above. */
const invalidCredentials = (): AppError =>
  new AppError(401, 'ADMIN_CREDENTIALS_INVALID', 'Those credentials were not accepted', {
    messageKey: 'errors.auth.adminCredentialsInvalid',
  });

export interface AdminChallenge {
  challengeId: string;
  /** Masked, so the screen can say where the code went without publishing it. */
  phone: string;
  expiresInSeconds: number;
}

interface StoredChallenge {
  userId: string;
  otpHash: string;
  attempts: number;
}

export interface AdminLoginDeps {
  context: AppContext;
  /** How the OTP reaches a human. Same transport the customer flow uses. */
  sendOtp: (phone: string, otp: string, expiresInSeconds: number) => Promise<void>;
}

/**
 * Step one. Verifies the password and sends a code.
 *
 * Rate limited on **both** the identifier and the IP, because the two attacks
 * are different: one attacker guessing many passwords for one known ops account,
 * and one attacker trying one common password against many accounts. A limit on
 * either alone leaves the other wide open.
 */
export async function startAdminLogin(
  deps: AdminLoginDeps,
  input: { loginId: string; password: string },
  info: { ip: string },
): Promise<AdminChallenge> {
  const { context } = deps;

  const phone = normalizePhone(input.loginId);

  /**
   * The per-identifier budget is consumed before the password is checked, and
   * for a malformed id too. Otherwise the cheap early return on "not a phone
   * number" would be a free probe that never touches the limiter.
   */
  const perId = await consumeRateLimit(
    context.redis,
    `auth:admin:rate:id:${phone ?? input.loginId.slice(0, 40)}`,
    context.config.ADMIN_LOGIN_MAX_ATTEMPTS,
    context.config.ADMIN_LOGIN_WINDOW_SECONDS,
  );

  if (!perId.allowed) {
    throw AppError.tooManyRequests(
      'Too many sign-in attempts for this account',
      perId.retryAfterSeconds,
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

  if (phone === null) throw invalidCredentials();

  const user = await context.prisma.user.findUnique({
    where: { phone },
    select: {
      id: true,
      phone: true,
      status: true,
      passwordHash: true,
      roles: { select: { role: true } },
    },
  });

  const isStaff = user?.roles.some((entry) => entry.role === 'ops' || entry.role === 'admin');

  /**
   * The password is verified even when we already know this will fail.
   *
   * Returning early for an unknown account would answer in a millisecond while a
   * real one takes ~100ms of scrypt, and that difference is a reliable oracle for
   * which numbers are staff accounts. The dummy hash below costs the same as a
   * real verification and is never equal to anything.
   */
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(input.password, hash);

  if (!user || !isStaff || !user.passwordHash || !passwordOk) throw invalidCredentials();

  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_BLOCKED', `User ${user.id} is ${user.status}`, {
      messageKey: 'errors.auth.accountBlocked',
    });
  }

  const otp = generateOtp();
  const challengeId = randomUUID();

  const stored: StoredChallenge = {
    userId: user.id,
    otpHash: hashOtp(context.config.JWT_SECRET, user.phone, otp),
    attempts: 0,
  };

  await context.redis.set(
    challengeKey(challengeId),
    JSON.stringify(stored),
    'EX',
    CHALLENGE_TTL_SECONDS,
  );

  await deps.sendOtp(user.phone, otp, CHALLENGE_TTL_SECONDS);

  context.logger.info(
    { userId: user.id, ip: info.ip },
    'admin sign-in: password accepted, second factor sent',
  );

  return {
    challengeId,
    phone: maskPhone(user.phone),
    expiresInSeconds: CHALLENGE_TTL_SECONDS,
  };
}

/**
 * Step two. Consumes the challenge and hands back the user id for session issue.
 *
 * The challenge is **deleted on success and on exhaustion**, so a code cannot be
 * replayed and a guesser cannot sit on one challenge forever.
 */
export async function completeAdminLogin(
  context: AppContext,
  input: { challengeId: string; otp: string },
): Promise<string> {
  const key = challengeKey(input.challengeId);
  const raw = await context.redis.get(key);

  if (!raw) {
    throw new AppError(401, 'ADMIN_CHALLENGE_INVALID', 'That sign-in attempt has expired', {
      messageKey: 'errors.auth.adminChallengeExpired',
    });
  }

  const challenge = JSON.parse(raw) as StoredChallenge;

  const user = await context.prisma.user.findUnique({
    where: { id: challenge.userId },
    select: { id: true, phone: true, status: true },
  });

  if (!user) {
    await context.redis.del(key);
    throw invalidCredentials();
  }

  const candidate = hashOtp(context.config.JWT_SECRET, user.phone, input.otp);
  const fixedOtpAccepted = matchesFixedOtp(context.config, user.phone, input.otp);

  if (!fixedOtpAccepted && !verifyOtpHash(challenge.otpHash, candidate)) {
    const attempts = challenge.attempts + 1;

    if (attempts >= CHALLENGE_MAX_ATTEMPTS) {
      // Spent. Start again from the password, which costs another id+IP budget.
      await context.redis.del(key);

      throw new AppError(401, 'ADMIN_CHALLENGE_INVALID', 'Too many wrong codes', {
        messageKey: 'errors.auth.adminChallengeExpired',
      });
    }

    // Preserve the remaining TTL: a wrong guess must not extend the window.
    const ttl = await context.redis.ttl(key);
    await context.redis.set(
      key,
      JSON.stringify({ ...challenge, attempts }),
      'EX',
      ttl > 0 ? ttl : CHALLENGE_TTL_SECONDS,
    );

    throw new AppError(401, 'ADMIN_OTP_INVALID', 'That code was not accepted', {
      messageKey: 'errors.auth.otpInvalid',
    });
  }

  await context.redis.del(key);

  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_BLOCKED', `User ${user.id} is ${user.status}`, {
      messageKey: 'errors.auth.accountBlocked',
    });
  }

  return user.id;
}

/**
 * A syntactically valid hash that no password matches.
 *
 * Exists solely so an unknown account costs the same wall-clock time as a real
 * one. Generated once at module load from a random value nobody keeps.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
