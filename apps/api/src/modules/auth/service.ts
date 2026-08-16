import {
  DEFAULT_ROLE,
  type AuthSession,
  type AuthUser,
  type Locale,
  type Role,
  type UserStatus,
} from '@fixbridge/shared';
import { AppError } from '../../core/errors';
import { consumeRateLimit } from '../../core/rate-limit';
import type { AppContext } from '../../core/context';
import {
  createRefreshToken,
  createUserWithRoles,
  extractRoles,
  findRefreshTokenByHash,
  findUserById,
  findUserByPhone,
  revokeAllForDevice,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  setUserStatus,
  type UserWithRoles,
} from './repository';
import { maskPhone } from './phone';
import {
  createOtpStore,
  generateOtp,
  hashOtp,
  matchesFixedOtp,
  otpKeys,
  verifyOtpHash,
} from './otp';
import {
  classifyRefreshToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from './tokens';
import type { OtpTransport } from './transport';
import type {
  LogoutInput,
  RefreshInput,
  RequestContextInfo,
  RequestOtpInput,
  RequestOtpResult,
  VerifyOtpInput,
} from './types';

const DEVICE_INFO_MAX_LENGTH = 512;

/** Everything the auth service needs, so it never reaches for globals. */
export interface AuthDeps {
  context: AppContext;
  transport: OtpTransport;
  /** Injectable for deterministic tests. */
  now?: () => Date;
}

function nowOf(deps: AuthDeps): Date {
  return deps.now ? deps.now() : new Date();
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/** The only way a user reaches a client — phone always masked. */
export function toAuthUser(user: UserWithRoles): AuthUser {
  return {
    id: user.id,
    phone: maskPhone(user.phone),
    name: user.name,
    roles: extractRoles(user),
    status: user.status as UserStatus,
    defaultCityId: user.defaultCityId,
    preferredLanguage: user.preferredLanguage as Locale,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Changes the language every future message renders in.
 *
 * Retroactive by design: the inbox re-renders from stored template keys and
 * parameters, so switching to English translates a person's whole history rather
 * than only what happens next. See `notifications/params.ts`.
 */
export async function setPreferredLanguage(
  deps: AuthDeps,
  userId: string,
  language: Locale,
): Promise<AuthUser> {
  await deps.context.prisma.user.update({
    where: { id: userId },
    data: { preferredLanguage: language },
  });

  const user = await findUserById(deps.context.prisma, userId);

  if (!user) {
    throw AppError.unauthorized('Authenticated user no longer exists', {
      messageKey: 'errors.auth.tokenInvalid',
    });
  }

  return toAuthUser(user);
}

function assertActive(user: UserWithRoles): void {
  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_BLOCKED', `User ${user.id} is ${user.status}`, {
      messageKey: 'errors.auth.accountBlocked',
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Session issuing                                                            */
/* -------------------------------------------------------------------------- */

async function issueSession(
  deps: AuthDeps,
  user: UserWithRoles,
  deviceId: string,
  info: RequestContextInfo,
  options: { rotateFromTokenId?: string } = {},
): Promise<AuthSession> {
  const { context } = deps;
  const now = nowOf(deps);
  const roles = extractRoles(user);

  const refreshToken = generateRefreshToken();
  const tokenRecord = {
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    deviceId,
    deviceInfo: info.userAgent ? info.userAgent.slice(0, DEVICE_INFO_MAX_LENGTH) : null,
    expiresAt: refreshTokenExpiry(context.config, now),
  };

  if (options.rotateFromTokenId) {
    await rotateRefreshToken(context.prisma, options.rotateFromTokenId, tokenRecord, now);
  } else {
    await createRefreshToken(context.prisma, tokenRecord);
  }

  return {
    tokenType: 'Bearer',
    accessToken: signAccessToken(context.config, { sub: user.id, roles, deviceId }),
    expiresIn: context.config.JWT_ACCESS_TTL_SECONDS,
    refreshToken,
    refreshExpiresAt: tokenRecord.expiresAt.toISOString(),
    user: toAuthUser(user),
  };
}

/* -------------------------------------------------------------------------- */
/* OTP request                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Two independent limits, checked in order: the phone budget first (so hammering
 * one number does not also burn the shared IP budget), then the IP budget.
 */
/**
 * A short gap between resends for one phone.
 *
 * Checked before the window budgets and using `SET NX` so it is a single atomic
 * round trip: whoever sets the key wins, everyone else is told how long is left.
 * Deliberately does *not* consume budget — being 20 seconds early is impatience,
 * not abuse, and should not cost the user one of their five attempts.
 */
async function enforceResendCooldown(context: AppContext, phone: string): Promise<void> {
  const { config, redis } = context;
  if (config.OTP_RESEND_COOLDOWN_SECONDS === 0) return;

  const key = otpKeys.cooldown(phone);
  const acquired = await redis.set(key, '1', 'EX', config.OTP_RESEND_COOLDOWN_SECONDS, 'NX');

  if (acquired === 'OK') return;

  const ttl = await redis.ttl(key);

  throw AppError.tooManyRequests(
    `OTP was requested for this phone less than ${config.OTP_RESEND_COOLDOWN_SECONDS}s ago`,
    ttl > 0 ? ttl : config.OTP_RESEND_COOLDOWN_SECONDS,
    {
      messageKey: 'errors.auth.otpResendTooSoon',
      details: { scope: 'cooldown', retryAfterSeconds: ttl > 0 ? ttl : 1 },
    },
  );
}

async function enforceOtpRequestLimits(
  context: AppContext,
  phone: string,
  ip: string,
): Promise<void> {
  const { config, redis } = context;

  const perPhone = await consumeRateLimit(
    redis,
    otpKeys.ratePhone(phone),
    config.OTP_MAX_PER_PHONE,
    config.OTP_RATE_WINDOW_SECONDS,
  );

  if (!perPhone.allowed) {
    throw AppError.tooManyRequests(
      `OTP request limit reached for this phone (${perPhone.count}/${perPhone.limit})`,
      perPhone.retryAfterSeconds,
      { details: { scope: 'phone', retryAfterSeconds: perPhone.retryAfterSeconds } },
    );
  }

  const perIp = await consumeRateLimit(
    redis,
    otpKeys.rateIp(ip),
    config.OTP_MAX_PER_IP,
    config.OTP_RATE_WINDOW_SECONDS,
  );

  if (!perIp.allowed) {
    throw AppError.tooManyRequests(
      `OTP request limit reached for this IP (${perIp.count}/${perIp.limit})`,
      perIp.retryAfterSeconds,
      { details: { scope: 'ip', retryAfterSeconds: perIp.retryAfterSeconds } },
    );
  }
}

/**
 * Generates an OTP, stores only its HMAC in Redis, and hands the plaintext to the
 * transport. The OTP is never returned, never logged by the response path, and
 * never written to Postgres.
 */
export async function requestOtp(
  deps: AuthDeps,
  input: RequestOtpInput,
  info: RequestContextInfo,
): Promise<RequestOtpResult> {
  const { context, transport } = deps;
  const { phone } = input;

  await enforceResendCooldown(context, phone);
  await enforceOtpRequestLimits(context, phone, info.ip);

  const otp = generateOtp();
  const store = createOtpStore(context.redis, context.config);

  await store.save(phone, otp);
  await transport.send({ phone, otp, expiresInSeconds: context.config.OTP_TTL_SECONDS });

  context.logger.info({ phone: maskPhone(phone), transport: transport.name }, 'otp requested');

  return { phone: maskPhone(phone), expiresInSeconds: context.config.OTP_TTL_SECONDS };
}

/* -------------------------------------------------------------------------- */
/* OTP verification                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every "that did not work" outcome returns the SAME status, code and message.
 *
 * "No OTP pending" and "wrong code" must be indistinguishable to the caller,
 * otherwise verify becomes an oracle for which numbers have a live OTP. The
 * `detail` argument is developer-facing only — it reaches the logs, never the
 * response, because `messageKey` always wins in the error middleware.
 */
function otpRejection(detail: string): AppError {
  return new AppError(401, 'OTP_INVALID', detail, { messageKey: 'errors.auth.otpInvalid' });
}

async function consumeOtp(deps: AuthDeps, phone: string, otp: string): Promise<void> {
  const { context } = deps;

  // Dev/test shortcut. Structurally unreachable in production — the config
  // schema refuses to parse an environment that sets AUTH_FIXED_OTP there.
  if (matchesFixedOtp(context.config, phone, otp)) {
    context.logger.warn({ phone: maskPhone(phone) }, 'otp verified via fixed development OTP');
    await createOtpStore(context.redis, context.config).clear(phone);
    return;
  }

  const store = createOtpStore(context.redis, context.config);
  const storedHash = await store.peek(phone);

  if (storedHash === null) {
    throw otpRejection('No live OTP for this phone (never requested, or expired)');
  }

  const candidateHash = hashOtp(context.config.JWT_SECRET, phone, otp);

  if (!verifyOtpHash(storedHash, candidateHash)) {
    const attempts = await store.countAttempt(phone);

    if (attempts >= context.config.OTP_MAX_VERIFY_ATTEMPTS) {
      await store.clear(phone);

      const retryAfter = await context.redis.ttl(otpKeys.ratePhone(phone));

      context.logger.warn(
        { phone: maskPhone(phone), attempts },
        'otp invalidated after too many failed attempts',
      );

      throw AppError.tooManyRequests(
        'Too many failed OTP attempts; the code has been invalidated',
        retryAfter > 0 ? retryAfter : 1,
        { messageKey: 'errors.auth.otpAttemptsExceeded' },
      );
    }

    throw otpRejection('OTP did not match');
  }

  await store.clear(phone);
}

export interface VerifyOtpResult extends AuthSession {
  isNewUser: boolean;
}

export async function verifyOtp(
  deps: AuthDeps,
  input: VerifyOtpInput,
  info: RequestContextInfo,
): Promise<VerifyOtpResult> {
  const { context } = deps;
  const { phone, otp, deviceId } = input;

  await consumeOtp(deps, phone, otp);

  const existing = await findUserByPhone(context.prisma, phone);
  const user = existing ?? (await createUserWithRoles(context.prisma, phone, [DEFAULT_ROLE]));

  assertActive(user);

  const session = await issueSession(deps, user, deviceId, info);

  context.logger.info(
    { userId: user.id, deviceId, isNewUser: existing === null },
    'user signed in',
  );

  return { ...session, isNewUser: existing === null };
}

/* -------------------------------------------------------------------------- */
/* Refresh with rotation + reuse detection                                    */
/* -------------------------------------------------------------------------- */

const REFRESH_REJECTED = (detail: string): AppError =>
  new AppError(401, 'REFRESH_TOKEN_INVALID', detail, {
    messageKey: 'errors.auth.refreshInvalid',
    headers: { 'WWW-Authenticate': 'Bearer' },
  });

export async function refreshSession(
  deps: AuthDeps,
  input: RefreshInput,
  info: RequestContextInfo,
): Promise<AuthSession> {
  const { context } = deps;
  const now = nowOf(deps);

  const stored = await findRefreshTokenByHash(context.prisma, hashRefreshToken(input.refreshToken));
  const verdict = classifyRefreshToken(stored, input.deviceId, now);

  if (verdict.outcome === 'reuse_detected' && stored) {
    // The token was already rotated away, so this presentation is a replay:
    // treat it as a stolen token and sign the device out entirely.
    const revoked = await revokeAllForDevice(context.prisma, stored.userId, stored.deviceId, now);

    context.logger.warn(
      {
        userId: stored.userId,
        deviceId: stored.deviceId,
        tokenId: stored.id,
        revokedCount: revoked,
        ip: info.ip,
      },
      'security: revoked refresh token replayed — all tokens for this device revoked',
    );

    throw REFRESH_REJECTED('Refresh token reuse detected');
  }

  if (verdict.outcome !== 'valid' || !stored) {
    context.logger.warn({ outcome: verdict.outcome, ip: info.ip }, 'refresh rejected');
    throw REFRESH_REJECTED(`Refresh token ${verdict.outcome}`);
  }

  const user = await findUserById(context.prisma, stored.userId);

  if (!user) throw REFRESH_REJECTED('Token belongs to a user that no longer exists');
  assertActive(user);

  const session = await issueSession(deps, user, stored.deviceId, info, {
    rotateFromTokenId: stored.id,
  });

  context.logger.info({ userId: user.id, deviceId: stored.deviceId }, 'session refreshed');

  return session;
}

/* -------------------------------------------------------------------------- */
/* Logout & profile                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Idempotent by design: an unknown or already-revoked token still reports
 * success, so logout cannot be used to probe which tokens exist.
 */
export async function logout(deps: AuthDeps, input: LogoutInput): Promise<void> {
  const { context } = deps;
  const stored = await findRefreshTokenByHash(context.prisma, hashRefreshToken(input.refreshToken));

  if (!stored || stored.revokedAt !== null) return;

  await revokeRefreshToken(context.prisma, stored.id, nowOf(deps));
  context.logger.info({ userId: stored.userId, deviceId: stored.deviceId }, 'user signed out');
}

/* -------------------------------------------------------------------------- */
/* Blocking (internal — the ops endpoint that calls this arrives in Phase 11)  */
/* -------------------------------------------------------------------------- */

/**
 * Blocks a user and cuts them off immediately rather than eventually.
 *
 * Three things have to happen together, because each alone leaves a hole:
 *   1. `status = blocked`  — the durable truth; refresh and `/me` reject on it.
 *   2. denylist entry      — kills already-issued access tokens, which are
 *                            stateless and would otherwise work for up to 15 min.
 *   3. revoke refresh      — so they cannot mint a fresh pair on the way out.
 */
export async function blockUser(deps: AuthDeps, userId: string): Promise<AuthUser> {
  const { context } = deps;
  const now = nowOf(deps);

  const user = await setUserStatus(context.prisma, userId, 'blocked');
  const revoked = await revokeAllForUser(context.prisma, userId, now);
  await context.userDenylist.add(userId);

  context.logger.warn(
    { userId, revokedRefreshTokens: revoked },
    'security: user blocked — access tokens denylisted and refresh tokens revoked',
  );

  return toAuthUser(user);
}

/**
 * Restores access. The denylist entry is dropped, but every refresh token was
 * revoked by the block, so the user signs in again with an OTP — which is the
 * behaviour we want after a suspension.
 */
export async function unblockUser(deps: AuthDeps, userId: string): Promise<AuthUser> {
  const { context } = deps;

  const user = await setUserStatus(context.prisma, userId, 'active');
  await context.userDenylist.remove(userId);

  context.logger.info({ userId }, 'user unblocked');

  return toAuthUser(user);
}

export async function getCurrentUser(deps: AuthDeps, userId: string): Promise<AuthUser> {
  const user = await findUserById(deps.context.prisma, userId);

  if (!user) {
    // The token is validly signed but the account is gone.
    throw AppError.unauthorized('Authenticated user no longer exists', {
      messageKey: 'errors.auth.tokenInvalid',
    });
  }

  assertActive(user);

  return toAuthUser(user);
}

export type { Role };
