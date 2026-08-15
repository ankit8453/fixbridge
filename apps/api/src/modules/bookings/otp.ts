import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import type { AppConfig } from '../../core/config';

/**
 * The physical handshake.
 *
 * Two codes per booking, and they prove different things:
 *
 *   **start** — the technician is actually standing there. The customer reads it
 *   out; only someone at the door can hear it.
 *   **end**   — the customer signs off that the work is done. Without it, "he
 *   said it was finished" is one person's word.
 *
 * Four digits rather than six: these are spoken aloud, in person, often over the
 * noise of a job. The threat model is different from a login OTP — an attacker
 * would have to be physically present — and the attempt limit does the work that
 * length does elsewhere.
 *
 * Stored in Redis only, hashed, exactly like auth OTPs. Never in Postgres.
 */

export type BookingOtpKind = 'start' | 'end';

export const bookingOtpKeys = {
  code: (bookingId: string, kind: BookingOtpKind) => `booking:otp:${kind}:${bookingId}`,
  attempts: (bookingId: string, kind: BookingOtpKind) =>
    `booking:otp:attempts:${kind}:${bookingId}`,
  locked: (bookingId: string) => `booking:otp:locked:${bookingId}`,
};

export function generateBookingOtp(length: number): string {
  return String(randomInt(0, 10 ** length)).padStart(length, '0');
}

/**
 * HMAC salted by booking id and kind.
 *
 * A four-digit code is 10,000 possibilities — a bare digest would be a trivial
 * lookup table for anyone who could read Redis. The kind is mixed in so a start
 * code can never satisfy an end check.
 */
export function hashBookingOtp(
  secret: string,
  bookingId: string,
  kind: BookingOtpKind,
  otp: string,
): string {
  return createHmac('sha256', secret)
    .update(`booking-otp:${kind}:${bookingId}:${otp}`)
    .digest('hex');
}

export function verifyBookingOtpHash(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');

  if (expected.length === 0 || expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

export type BookingOtpCheck =
  | { outcome: 'ok' }
  | { outcome: 'missing' }
  | { outcome: 'wrong'; attempts: number; remaining: number }
  | { outcome: 'locked'; attempts: number };

export interface BookingOtpStore {
  /** Mints both codes at acceptance and returns them in the clear, once. */
  issue(bookingId: string, ttlSeconds: number): Promise<{ start: string; end: string }>;
  /** Reads a live code — for showing the customer their own booking's code. */
  peek(bookingId: string, kind: BookingOtpKind): Promise<string | null>;
  check(bookingId: string, kind: BookingOtpKind, otp: string): Promise<BookingOtpCheck>;
  isLocked(bookingId: string): Promise<boolean>;
  clear(bookingId: string): Promise<void>;
}

/**
 * Codes are kept in the clear *as well as* hashed, under a separate key.
 *
 * That is a deliberate departure from the auth OTP, where the plaintext never
 * exists server-side. Here the customer must be *shown* their start code inside
 * the app — there is nobody to send it to, and the whole mechanism depends on
 * them being able to read it out. The hash still guards verification so a
 * timing or comparison bug cannot leak it, and both keys die with the booking.
 */
export function createBookingOtpStore(redis: Redis, config: AppConfig): BookingOtpStore {
  const plainKey = (bookingId: string, kind: BookingOtpKind): string =>
    `booking:otp:plain:${kind}:${bookingId}`;

  return {
    async issue(bookingId, ttlSeconds) {
      const start = generateBookingOtp(config.BOOKING_OTP_LENGTH);
      const end = generateBookingOtp(config.BOOKING_OTP_LENGTH);

      await redis
        .multi()
        .set(
          bookingOtpKeys.code(bookingId, 'start'),
          hashBookingOtp(config.JWT_SECRET, bookingId, 'start', start),
          'EX',
          ttlSeconds,
        )
        .set(
          bookingOtpKeys.code(bookingId, 'end'),
          hashBookingOtp(config.JWT_SECRET, bookingId, 'end', end),
          'EX',
          ttlSeconds,
        )
        .set(plainKey(bookingId, 'start'), start, 'EX', ttlSeconds)
        .set(plainKey(bookingId, 'end'), end, 'EX', ttlSeconds)
        .del(bookingOtpKeys.attempts(bookingId, 'start'))
        .del(bookingOtpKeys.attempts(bookingId, 'end'))
        .del(bookingOtpKeys.locked(bookingId))
        .exec();

      return { start, end };
    },

    async peek(bookingId, kind) {
      return redis.get(plainKey(bookingId, kind));
    },

    async isLocked(bookingId) {
      return (await redis.exists(bookingOtpKeys.locked(bookingId))) === 1;
    },

    async check(bookingId, kind, otp) {
      if (await this.isLocked(bookingId)) {
        const attempts = Number((await redis.get(bookingOtpKeys.attempts(bookingId, kind))) ?? 0);
        return { outcome: 'locked', attempts };
      }

      const stored = await redis.get(bookingOtpKeys.code(bookingId, kind));
      if (stored === null) return { outcome: 'missing' };

      const candidate = hashBookingOtp(config.JWT_SECRET, bookingId, kind, otp);
      if (verifyBookingOtpHash(stored, candidate)) return { outcome: 'ok' };

      const key = bookingOtpKeys.attempts(bookingId, kind);
      const attempts = await redis.incr(key);
      if (attempts === 1) await redis.expire(key, 24 * 60 * 60);

      if (attempts >= config.BOOKING_OTP_MAX_ATTEMPTS) {
        /**
         * Locked, not reset.
         *
         * A login OTP can simply be re-requested. A handshake cannot: the point
         * is that a specific person is at a specific door, so quietly issuing a
         * new code would defeat it. Ops unlock it, which also means somebody
         * looks at why five attempts failed.
         */
        await redis.set(bookingOtpKeys.locked(bookingId), kind, 'EX', 7 * 24 * 60 * 60);
        return { outcome: 'locked', attempts };
      }

      return {
        outcome: 'wrong',
        attempts,
        remaining: Math.max(0, config.BOOKING_OTP_MAX_ATTEMPTS - attempts),
      };
    },

    async clear(bookingId) {
      await redis.del(
        bookingOtpKeys.code(bookingId, 'start'),
        bookingOtpKeys.code(bookingId, 'end'),
        bookingOtpKeys.attempts(bookingId, 'start'),
        bookingOtpKeys.attempts(bookingId, 'end'),
        bookingOtpKeys.locked(bookingId),
        plainKey(bookingId, 'start'),
        plainKey(bookingId, 'end'),
      );
    },
  };
}
