import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import type { AppConfig } from '../../core/config';

export const OTP_LENGTH = 6;

/* -------------------------------------------------------------------------- */
/* Redis keys                                                                 */
/* -------------------------------------------------------------------------- */

/** Brand-free, stable prefixes. OTPs live here and nowhere else — never Postgres. */
export const otpKeys = {
  code: (phone: string) => `auth:otp:code:${phone}`,
  attempts: (phone: string) => `auth:otp:attempts:${phone}`,
  ratePhone: (phone: string) => `auth:otp:rate:phone:${phone}`,
  rateIp: (ip: string) => `auth:otp:rate:ip:${ip}`,
};

/* -------------------------------------------------------------------------- */
/* Generation & hashing                                                       */
/* -------------------------------------------------------------------------- */

/** Cryptographically random, uniformly distributed, zero-padded. */
export function generateOtp(length: number = OTP_LENGTH): string {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, '0');
}

/**
 * HMAC-SHA256 rather than a bare SHA-256: a plain digest of a 6-digit code is
 * only a million-entry rainbow table, so anyone who reads Redis could reverse it.
 * The phone is mixed in as a salt and `otp:` gives domain separation from the
 * same secret's use for JWTs.
 */
export function hashOtp(secret: string, phone: string, otp: string): string {
  return createHmac('sha256', secret).update(`otp:${phone}:${otp}`).digest('hex');
}

/** Constant-time comparison — a fast reject must not leak which digit was wrong. */
export function verifyOtpHash(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');

  if (expected.length === 0 || expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

/* -------------------------------------------------------------------------- */
/* Fixed-OTP escape hatch (never reachable in production — see config.ts)      */
/* -------------------------------------------------------------------------- */

/**
 * True when the dev/test fixed OTP applies to this phone.
 *
 * The production guard is in the config schema, not here: a production process
 * cannot even start with `AUTH_FIXED_OTP` set, so this can never return true there.
 */
export function isFixedOtpCandidate(config: AppConfig, phone: string): boolean {
  return (
    config.AUTH_FIXED_OTP !== undefined &&
    config.NODE_ENV !== 'production' &&
    phone.startsWith(config.AUTH_FIXED_OTP_PHONE_PREFIX)
  );
}

export function matchesFixedOtp(config: AppConfig, phone: string, otp: string): boolean {
  return isFixedOtpCandidate(config, phone) && otp === config.AUTH_FIXED_OTP;
}

/* -------------------------------------------------------------------------- */
/* Redis-backed store                                                         */
/* -------------------------------------------------------------------------- */

export interface OtpStore {
  save(phone: string, otp: string): Promise<void>;
  /** Returns the stored hash, or null when there is no live OTP. */
  peek(phone: string): Promise<string | null>;
  /** Increments and returns the attempt count for the current OTP. */
  countAttempt(phone: string): Promise<number>;
  clear(phone: string): Promise<void>;
}

export function createOtpStore(redis: Redis, config: AppConfig): OtpStore {
  return {
    async save(phone, otp) {
      const hash = hashOtp(config.JWT_SECRET, phone, otp);

      // A fresh OTP resets the attempt counter for that phone.
      await redis
        .multi()
        .set(otpKeys.code(phone), hash, 'EX', config.OTP_TTL_SECONDS)
        .del(otpKeys.attempts(phone))
        .exec();
    },

    async peek(phone) {
      return redis.get(otpKeys.code(phone));
    },

    async countAttempt(phone) {
      const key = otpKeys.attempts(phone);
      const attempts = await redis.incr(key);

      if (attempts === 1) {
        await redis.expire(key, config.OTP_TTL_SECONDS);
      }

      return attempts;
    },

    async clear(phone) {
      await redis.del(otpKeys.code(phone), otpKeys.attempts(phone));
    },
  };
}
