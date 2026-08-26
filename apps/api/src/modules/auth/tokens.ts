import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@fixbridge/shared';
import type { AppConfig } from '../../core/config';

/* -------------------------------------------------------------------------- */
/* Access tokens (stateless JWT)                                              */
/* -------------------------------------------------------------------------- */

export interface AccessTokenClaims {
  sub: string;
  roles: Role[];
  deviceId: string;
  /** Present (true) only on admin-session tokens — `sub` is then an `admin_users` id. */
  staff?: boolean;
}

export type AccessTokenVerification =
  { status: 'valid'; claims: AccessTokenClaims } | { status: 'expired' } | { status: 'invalid' };

export function signAccessToken(config: AppConfig, claims: AccessTokenClaims): string {
  return jwt.sign(
    { roles: claims.roles, deviceId: claims.deviceId, ...(claims.staff ? { staff: true } : {}) },
    config.JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: claims.sub,
      expiresIn: config.JWT_ACCESS_TTL_SECONDS,
      // Config-driven, never a hardcoded brand.
      issuer: config.APP_NAME,
      /**
       * Without a unique id, two tokens minted for the same user, device and roles
       * inside the same second are byte-identical — a refresh would hand back the
       * very token it was supposed to replace. It also gives future phases
       * something to denylist an individual access token by.
       */
      jwtid: randomUUID(),
    },
  );
}

/**
 * `algorithms` is pinned so a token claiming `alg: none` (or RS256 with our
 * secret as the "public key") can never be accepted.
 *
 * Expired and invalid are distinguished because the client should silently
 * refresh on the former and force a fresh sign-in on the latter.
 */
export function verifyAccessToken(config: AppConfig, token: string): AccessTokenVerification {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: config.APP_NAME,
    });

    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      return { status: 'invalid' };
    }

    const { roles, deviceId, staff } = payload as jwt.JwtPayload & {
      roles?: unknown;
      deviceId?: unknown;
      staff?: unknown;
    };

    if (!Array.isArray(roles) || typeof deviceId !== 'string') {
      return { status: 'invalid' };
    }

    return {
      status: 'valid',
      claims: {
        sub: payload.sub,
        roles: roles as Role[],
        deviceId,
        ...(staff === true ? { staff: true } : {}),
      },
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) return { status: 'expired' };
    return { status: 'invalid' };
  }
}

/** Strips `Bearer ` from an Authorization header. Null when absent or malformed. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const match = /^Bearer +(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();

  return token && token.length > 0 ? token : null;
}

/* -------------------------------------------------------------------------- */
/* Refresh tokens (opaque, stored hashed)                                     */
/* -------------------------------------------------------------------------- */

/**
 * 256 bits of entropy. Because the token is random rather than user-chosen, a
 * plain SHA-256 at rest is enough — there is nothing to brute-force.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(config: AppConfig, now: Date): Date {
  return new Date(now.getTime() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/* -------------------------------------------------------------------------- */
/* Refresh validation (pure — the DB lookup happens in the repository)         */
/* -------------------------------------------------------------------------- */

export interface StoredRefreshToken {
  id: string;
  userId: string;
  deviceId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type RefreshVerdict =
  /** Token is good; rotate it. */
  | { outcome: 'valid' }
  /** No such token — either never issued or already pruned. */
  | { outcome: 'not_found' }
  /** Past its expiry. */
  | { outcome: 'expired' }
  /** Bound to a different device than the caller claims. */
  | { outcome: 'device_mismatch' }
  /**
   * Already rotated away. Someone is replaying a token we retired, which means
   * it leaked — every token for this (user, device) must be destroyed.
   */
  | { outcome: 'reuse_detected' };

/**
 * Decides what to do with a presented refresh token. Kept pure so every branch —
 * including the theft path — is unit-testable without a database.
 */
export function classifyRefreshToken(
  stored: StoredRefreshToken | null,
  presentedDeviceId: string,
  now: Date,
): RefreshVerdict {
  if (!stored) return { outcome: 'not_found' };
  if (stored.revokedAt !== null) return { outcome: 'reuse_detected' };
  if (stored.deviceId !== presentedDeviceId) return { outcome: 'device_mismatch' };
  if (stored.expiresAt.getTime() <= now.getTime()) return { outcome: 'expired' };

  return { outcome: 'valid' };
}
