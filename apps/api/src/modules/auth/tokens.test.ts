import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../core/config';
import {
  classifyRefreshToken,
  extractBearerToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
  type StoredRefreshToken,
} from './tokens';

const SECRET = 'token-test-secret-value-at-least-32-characters';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    APP_NAME: 'fixbridge',
    JWT_SECRET: SECRET,
    JWT_ACCESS_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_DAYS: 30,
    ...overrides,
  } as AppConfig;
}

const CLAIMS = { sub: 'user-1', roles: ['customer' as const], deviceId: 'device-abc-123' };

describe('access tokens', () => {
  it('round-trips claims', () => {
    const result = verifyAccessToken(config(), signAccessToken(config(), CLAIMS));

    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    expect(result.claims).toEqual(CLAIMS);
  });

  it('carries multiple roles', () => {
    const claims = { ...CLAIMS, roles: ['customer' as const, 'technician' as const] };
    const result = verifyAccessToken(config(), signAccessToken(config(), claims));

    expect(result.status === 'valid' && result.claims.roles).toEqual(['customer', 'technician']);
  });

  it('signs with HS256 and sets the configured issuer', () => {
    const decoded = jwt.decode(signAccessToken(config(), CLAIMS), { complete: true });

    expect(decoded?.header.alg).toBe('HS256');
    expect((decoded?.payload as jwt.JwtPayload).iss).toBe('fixbridge');
  });

  it('gives every token a unique jti, so identical claims never collide', () => {
    // Same user, device, roles and second: without a jti these would be the
    // same string, and a refresh would return the token it just replaced.
    const tokens = Array.from({ length: 20 }, () => signAccessToken(config(), CLAIMS));

    expect(new Set(tokens).size).toBe(tokens.length);

    const ids = tokens.map((token) => (jwt.decode(token) as jwt.JwtPayload).jti);
    expect(new Set(ids).size).toBe(tokens.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('takes the issuer from APP_NAME rather than a hardcoded brand', () => {
    const decoded = jwt.decode(signAccessToken(config({ APP_NAME: 'renamed-app' }), CLAIMS), {
      complete: true,
    });

    expect((decoded?.payload as jwt.JwtPayload).iss).toBe('renamed-app');
  });

  it('reports an expired token distinctly from an invalid one', () => {
    const expired = jwt.sign({ roles: ['customer'], deviceId: 'device-abc-123' }, SECRET, {
      algorithm: 'HS256',
      subject: 'user-1',
      issuer: 'fixbridge',
      expiresIn: -60,
    });

    expect(verifyAccessToken(config(), expired).status).toBe('expired');
  });

  it('rejects a token signed with a different secret', () => {
    const foreign = signAccessToken(
      config({ JWT_SECRET: 'another-secret-at-least-32-chars-x' }),
      CLAIMS,
    );

    expect(verifyAccessToken(config(), foreign).status).toBe('invalid');
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = signAccessToken(config(), CLAIMS).split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'user-2', roles: ['admin'], deviceId: 'device-abc-123' }),
    ).toString('base64url');

    expect(verifyAccessToken(config(), `${header}.${forged}.${signature}`).status).toBe('invalid');
  });

  it('rejects an unsigned "alg: none" token', () => {
    const none = jwt.sign({ roles: ['admin'], deviceId: 'd' }, '', {
      algorithm: 'none',
      subject: 'user-1',
      issuer: 'fixbridge',
    });

    expect(verifyAccessToken(config(), none).status).toBe('invalid');
  });

  it('rejects a token issued for a different issuer', () => {
    const other = signAccessToken(config({ APP_NAME: 'someone-else' }), CLAIMS);

    expect(verifyAccessToken(config(), other).status).toBe('invalid');
  });

  it('rejects a well-signed token that is missing required claims', () => {
    const incomplete = jwt.sign({ roles: ['customer'] }, SECRET, {
      algorithm: 'HS256',
      subject: 'user-1',
      issuer: 'fixbridge',
    });

    expect(verifyAccessToken(config(), incomplete).status).toBe('invalid');
  });

  it('rejects junk', () => {
    expect(verifyAccessToken(config(), 'not-a-token').status).toBe('invalid');
    expect(verifyAccessToken(config(), '').status).toBe('invalid');
  });
});

describe('extractBearerToken', () => {
  it('pulls the token out of a well-formed header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme and tolerates extra spaces', () => {
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('  Bearer   abc  ')).toBe('abc');
  });

  it('returns null for anything else', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearerToken('abc.def.ghi')).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('generates high-entropy, url-safe, non-repeating values', () => {
    const tokens = Array.from({ length: 200 }, () => generateRefreshToken());

    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('hashes deterministically to 64 hex characters, never echoing the token', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it('hashes different tokens differently', () => {
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(
      hashRefreshToken(generateRefreshToken()),
    );
  });

  it('computes expiry from the configured TTL', () => {
    const now = new Date('2026-08-15T10:00:00.000Z');

    expect(refreshTokenExpiry(config({ REFRESH_TOKEN_TTL_DAYS: 30 }), now).toISOString()).toBe(
      '2026-09-14T10:00:00.000Z',
    );
    expect(refreshTokenExpiry(config({ REFRESH_TOKEN_TTL_DAYS: 1 }), now).toISOString()).toBe(
      '2026-08-16T10:00:00.000Z',
    );
  });
});

describe('classifyRefreshToken', () => {
  const now = new Date('2026-08-15T10:00:00.000Z');

  const stored = (overrides: Partial<StoredRefreshToken> = {}): StoredRefreshToken => ({
    id: 'token-1',
    userId: 'user-1',
    deviceId: 'device-abc-123',
    expiresAt: new Date('2026-09-14T10:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  });

  it('accepts a live token on the right device', () => {
    expect(classifyRefreshToken(stored(), 'device-abc-123', now)).toEqual({ outcome: 'valid' });
  });

  it('reports an unknown token', () => {
    expect(classifyRefreshToken(null, 'device-abc-123', now)).toEqual({ outcome: 'not_found' });
  });

  it('treats a revoked token as reuse — this is the theft signal', () => {
    const revoked = stored({ revokedAt: new Date('2026-08-15T09:00:00.000Z') });

    expect(classifyRefreshToken(revoked, 'device-abc-123', now)).toEqual({
      outcome: 'reuse_detected',
    });
  });

  it('checks reuse before the device, so a stolen token cannot dodge detection', () => {
    const revoked = stored({ revokedAt: new Date('2026-08-15T09:00:00.000Z') });

    expect(classifyRefreshToken(revoked, 'some-other-device', now)).toEqual({
      outcome: 'reuse_detected',
    });
  });

  it('rejects a token presented from a different device', () => {
    expect(classifyRefreshToken(stored(), 'device-xyz-999', now)).toEqual({
      outcome: 'device_mismatch',
    });
  });

  it('rejects an expired token', () => {
    const old = stored({ expiresAt: new Date('2026-08-15T09:59:59.000Z') });

    expect(classifyRefreshToken(old, 'device-abc-123', now)).toEqual({ outcome: 'expired' });
  });

  it('treats the exact expiry instant as expired', () => {
    const boundary = stored({ expiresAt: new Date(now) });

    expect(classifyRefreshToken(boundary, 'device-abc-123', now)).toEqual({ outcome: 'expired' });
  });
});
