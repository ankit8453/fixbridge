import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { hashRefreshToken } from './tokens';
import { otpKeys } from './otp';
import type { OtpMessage } from './transport';

/**
 * Full auth e2e against the real compose services. Skips with a printed reason
 * when Postgres or Redis is unreachable, matching the Phase 1 convention.
 *
 * Every phone here sits inside the fixed-OTP prefix (`+9199999`), so the suite
 * can complete the OTP handshake without scraping a code out of the logs.
 */
const PHONES = {
  happyPath: '+919999900010',
  rateLimit: '+919999900011',
  roleGuard: '+919999900012',
  rotation: '+919999900013',
  /**
   * Deliberately OUTSIDE the fixed-OTP prefix, so this one has to go through the
   * genuine article: random OTP → HMAC → Redis → constant-time compare.
   */
  realOtp: '+919876500001',
};

const FIXED_OTP = '000000';
const DEVICE = 'device-e2e-primary';

let app: Express | undefined;
let context: AppContext | undefined;
let unavailableReason: string | undefined;

/**
 * A second app wired to a transport that captures instead of logging, so the
 * real OTP path can be driven end to end without scraping stdout.
 */
let capturingApp: Express | undefined;
const sentOtps: OtpMessage[] = [];

function firstMeaningfulLine(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const line = error.message
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? error.name;
}

/** Wipes every trace of the test phones so a rerun starts from zero. */
async function resetFixtures(ctx: AppContext): Promise<void> {
  const phones = [...Object.values(PHONES), '+919999900098', '+919999900099'];

  await ctx.prisma.user.deleteMany({ where: { phone: { in: phones } } });
  await ctx.redis.del(
    ...phones.flatMap((phone) => [
      otpKeys.code(phone),
      otpKeys.attempts(phone),
      otpKeys.ratePhone(phone),
    ]),
    otpKeys.rateIp('::ffff:127.0.0.1'),
    otpKeys.rateIp('127.0.0.1'),
    otpKeys.rateIp('unknown'),
  );
}

beforeAll(async () => {
  let config: AppConfig;

  try {
    config = parseConfig();
  } catch (error) {
    unavailableReason = `environment is not configured: ${firstMeaningfulLine(error)}`;
    return;
  }

  context = createContext(config);

  try {
    await context.prisma.$queryRaw`SELECT 1`;
    await context.redis.ping();
  } catch (error) {
    unavailableReason = `dependencies unreachable: ${firstMeaningfulLine(error)}`;
    return;
  }

  app = createApp(context);

  capturingApp = createApp({
    ...context,
    otpTransport: {
      name: 'capture',
      async send(message) {
        sentOtps.push(message);
      },
    },
  });
});

beforeEach(async () => {
  sentOtps.length = 0;
  if (context && !unavailableReason) await resetFixtures(context);
});

afterAll(async () => {
  if (context && !unavailableReason) await resetFixtures(context);
  if (context) await disposeContext(context);
});

const SKIP_BANNER = (reason: string) =>
  `[skipped] auth integration tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

/** Signs a phone in end to end and hands back the session payload. */
async function signIn(server: Express, phone: string, deviceId = DEVICE) {
  await request(server).post('/api/v1/auth/otp/request').send({ phone }).expect(200);

  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body;
}

describe('auth e2e', () => {
  describe('OTP request', () => {
    it('accepts a phone and never returns the OTP', async (ctx) => {
      if (!app) {
        console.warn(SKIP_BANNER(unavailableReason ?? 'unknown'));
        ctx.skip();
        return;
      }

      const response = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.happyPath });

      expect(response.status).toBe(200);
      expect(response.body.phone).toBe('+9199999*****');
      expect(response.body.expiresInSeconds).toBeGreaterThan(0);

      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/\botp\b\s*[:=]\s*"?\d{6}/i);
      expect(body).not.toContain(PHONES.happyPath);
    });

    it('normalises a phone typed without the country code', async (ctx) => {
      if (!app) return ctx.skip();

      const response = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: '99999 00010' });

      expect(response.status).toBe(200);
      expect(response.body.phone).toBe('+9199999*****');
    });

    it('rejects an invalid phone with a field-level 400', async (ctx) => {
      if (!app) return ctx.skip();

      const response = await request(app).post('/api/v1/auth/otp/request').send({ phone: '12345' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect((response.body.error.details as { field: string }[])[0]?.field).toBe('phone');
    });

    it('never writes the OTP to Postgres', async (ctx) => {
      if (!app || !context) return ctx.skip();

      await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONES.happyPath });

      // Nothing in the schema can hold an OTP: prove no table gained one.
      const tables = await context.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ILIKE '%otp%'
      `;

      expect(tables).toHaveLength(0);
    });
  });

  describe('OTP verification', () => {
    it('creates the account on first sign-in and issues a session', async (ctx) => {
      if (!app) return ctx.skip();

      const session = await signIn(app, PHONES.happyPath);

      expect(session.isNewUser).toBe(true);
      expect(session.tokenType).toBe('Bearer');
      expect(session.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session.expiresIn).toBe(900);
      expect(session.user.roles).toEqual(['customer']);
      expect(session.user.status).toBe('active');
      expect(session.user.phone).toBe('+9199999*****');
    });

    it('reuses the account on a second sign-in', async (ctx) => {
      if (!app) return ctx.skip();

      const first = await signIn(app, PHONES.happyPath);
      const second = await signIn(app, PHONES.happyPath);

      expect(second.isNewUser).toBe(false);
      expect(second.user.id).toBe(first.user.id);
    });

    it('gives an indistinguishable rejection whether or not an OTP is pending', async (ctx) => {
      if (!app) return ctx.skip();

      // A live OTP exists for this phone; the submitted code is simply wrong.
      await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONES.happyPath });
      const wrongCode = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.happyPath, otp: '111111', deviceId: DEVICE });

      // No OTP was ever requested for this one.
      const noPendingOtp = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: '+919999900099', otp: '111111', deviceId: DEVICE });

      // Anything that differs here is an oracle for "does this number have a
      // live OTP", so status, code and message must all match exactly.
      expect(wrongCode.status).toBe(401);
      expect(noPendingOtp.status).toBe(401);
      expect(wrongCode.body.error.code).toBe(noPendingOtp.body.error.code);
      expect(wrongCode.body.error.message).toBe(noPendingOtp.body.error.message);
      expect(wrongCode.body.error.details).toEqual(noPendingOtp.body.error.details);
    });

    it('does not leak account existence between a known and unknown phone', async (ctx) => {
      if (!app) return ctx.skip();

      // Sign in once so this phone definitely has an account…
      await signIn(app, PHONES.happyPath);

      const existingAccount = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.happyPath, otp: '111111', deviceId: DEVICE });

      // …versus a number that has never been seen.
      const noAccount = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: '+919999900098', otp: '111111', deviceId: DEVICE });

      expect(existingAccount.status).toBe(noAccount.status);
      expect(existingAccount.body.error.code).toBe(noAccount.body.error.code);
      expect(existingAccount.body.error.message).toBe(noAccount.body.error.message);
    });

    it('invalidates the OTP after too many wrong attempts', async (ctx) => {
      if (!app) return ctx.skip();

      await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONES.rotation });

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await request(app)
          .post('/api/v1/auth/otp/verify')
          .send({ phone: PHONES.rotation, otp: '111111', deviceId: DEVICE });
        statuses.push(response.status);
      }

      // First four are plain rejections; the fifth trips the attempt limit.
      expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
      expect(statuses[4]).toBe(429);
    });

    it('requires a device id', async (ctx) => {
      if (!app) return ctx.skip();

      const response = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.happyPath, otp: FIXED_OTP });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  /**
   * The fixed OTP is a shortcut and would happily mask a broken real path, so
   * this group uses a phone outside the fixed prefix and the OTP the transport
   * was actually handed.
   */
  describe('the genuine OTP path (no fixed-OTP shortcut)', () => {
    it('hands a real 6-digit OTP to the transport and accepts it back', async (ctx) => {
      if (!capturingApp) return ctx.skip();

      await request(capturingApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.realOtp })
        .expect(200);

      expect(sentOtps).toHaveLength(1);
      const sent = sentOtps[0];
      expect(sent?.phone).toBe(PHONES.realOtp);
      expect(sent?.otp).toMatch(/^\d{6}$/);
      expect(sent?.otp).not.toBe(FIXED_OTP);

      const verified = await request(capturingApp)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.realOtp, otp: sent?.otp, deviceId: DEVICE });

      expect(verified.status).toBe(200);
      expect(verified.body.isNewUser).toBe(true);
      expect(verified.body.accessToken).toBeTruthy();
    });

    it('rejects the fixed OTP for a phone outside the test prefix', async (ctx) => {
      if (!capturingApp) return ctx.skip();

      await request(capturingApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.realOtp })
        .expect(200);

      const response = await request(capturingApp)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.realOtp, otp: FIXED_OTP, deviceId: DEVICE });

      expect(response.status).toBe(401);
    });

    it('stores only an unrecoverable hash in Redis, never the OTP', async (ctx) => {
      if (!capturingApp || !context) return ctx.skip();

      await request(capturingApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.realOtp })
        .expect(200);

      const stored = await context.redis.get(otpKeys.code(PHONES.realOtp));
      const sentOtp = sentOtps[0]?.otp ?? '';

      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      expect(stored).not.toContain(sentOtp);
    });

    it('expires the OTP key with a TTL rather than leaving it to linger', async (ctx) => {
      if (!capturingApp || !context) return ctx.skip();

      await request(capturingApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.realOtp })
        .expect(200);

      const ttl = await context.redis.ttl(otpKeys.code(PHONES.realOtp));

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
    });

    it('consumes the OTP — the same code cannot be replayed', async (ctx) => {
      if (!capturingApp) return ctx.skip();

      await request(capturingApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.realOtp })
        .expect(200);

      const otp = sentOtps[0]?.otp;

      await request(capturingApp)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.realOtp, otp, deviceId: DEVICE })
        .expect(200);

      const replay = await request(capturingApp)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.realOtp, otp, deviceId: DEVICE });

      expect(replay.status).toBe(401);
    });

    it('issues a different OTP on every request', async (ctx) => {
      if (!capturingApp) return ctx.skip();

      for (let i = 0; i < 3; i += 1) {
        await request(capturingApp)
          .post('/api/v1/auth/otp/request')
          .send({ phone: PHONES.realOtp })
          .expect(200);
      }

      expect(sentOtps).toHaveLength(3);
      // Three random 6-digit codes colliding is a 1-in-a-million event; if this
      // ever flakes, look at generateOtp before blaming the test.
      expect(new Set(sentOtps.map((m) => m.otp)).size).toBeGreaterThan(1);
    });

    it('a newly requested OTP resets the failed-attempt counter', async (ctx) => {
      if (!capturingApp || !context) return ctx.skip();

      await request(capturingApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.realOtp })
        .expect(200);

      for (let i = 0; i < 3; i += 1) {
        await request(capturingApp)
          .post('/api/v1/auth/otp/verify')
          .send({ phone: PHONES.realOtp, otp: '111111', deviceId: DEVICE })
          .expect(401);
      }

      await request(capturingApp)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.realOtp })
        .expect(200);

      expect(await context.redis.get(otpKeys.attempts(PHONES.realOtp))).toBeNull();

      // The fresh code still works, i.e. the earlier failures did not burn it.
      const latest = sentOtps[sentOtps.length - 1]?.otp;
      await request(capturingApp)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.realOtp, otp: latest, deviceId: DEVICE })
        .expect(200);
    });
  });

  describe('protected routes', () => {
    it('returns the current user with a masked phone', async (ctx) => {
      if (!app) return ctx.skip();

      const session = await signIn(app, PHONES.happyPath);
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(session.user.id);
      expect(response.body.user.phone).toBe('+9199999*****');
      expect(response.body.deviceId).toBe(DEVICE);
      expect(JSON.stringify(response.body)).not.toContain(PHONES.happyPath);
    });

    it('rejects a missing token', async (ctx) => {
      if (!app) return ctx.skip();

      const response = await request(app).get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
      expect(response.headers['www-authenticate']).toBe('Bearer');
    });

    it('distinguishes an invalid token from an expired one', async (ctx) => {
      if (!app) return ctx.skip();

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not.a.token');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('localises the auth error message', async (ctx) => {
      if (!app) return ctx.skip();

      const response = await request(app).get('/api/v1/auth/me').set('Accept-Language', 'en');

      expect(response.body.error.message).toBe('Please sign in to continue.');
    });
  });

  describe('role guard', () => {
    it('rejects a customer from an admin-only route with 403', async (ctx) => {
      if (!app) return ctx.skip();

      const session = await signIn(app, PHONES.roleGuard);
      const response = await request(app)
        .get('/api/v1/auth/admin-only')
        .set('Authorization', `Bearer ${session.accessToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.details).toEqual({ requiredRoles: ['admin'] });
    });

    it('admits the same user once the admin role is granted', async (ctx) => {
      if (!app || !context) return ctx.skip();

      const first = await signIn(app, PHONES.roleGuard);

      await context.prisma.userRole.create({
        data: { userId: first.user.id, role: 'admin' },
      });

      // Roles are baked into the access token, so a new token is required.
      const elevated = await signIn(app, PHONES.roleGuard);
      expect(elevated.user.roles).toEqual(expect.arrayContaining(['customer', 'admin']));

      const response = await request(app)
        .get('/api/v1/auth/admin-only')
        .set('Authorization', `Bearer ${elevated.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });
  });

  describe('refresh rotation and reuse detection', () => {
    it('issues a new pair and retires the old refresh token', async (ctx) => {
      if (!app) return ctx.skip();

      const session = await signIn(app, PHONES.rotation);

      const refreshed = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken, deviceId: DEVICE });

      expect(refreshed.status).toBe(200);
      expect(refreshed.body.refreshToken).not.toBe(session.refreshToken);
      expect(refreshed.body.accessToken).toBeTruthy();
      // Both tokens must actually change. Sign-in and refresh land in the same
      // second here, so this only holds because each JWT carries its own jti.
      expect(refreshed.body.accessToken).not.toBe(session.accessToken);

      // The new access token works.
      const me = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
      expect(me.status).toBe(200);
    });

    it('records the rotation chain in the database', async (ctx) => {
      if (!app || !context) return ctx.skip();

      const session = await signIn(app, PHONES.rotation);
      const refreshed = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken, deviceId: DEVICE });

      const previous = await context.prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(session.refreshToken) },
      });
      const next = await context.prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(refreshed.body.refreshToken) },
      });

      expect(previous?.revokedAt).not.toBeNull();
      expect(previous?.replacedByTokenId).toBe(next?.id);
      expect(next?.revokedAt).toBeNull();
    });

    it('rejects the old refresh token after rotation', async (ctx) => {
      if (!app) return ctx.skip();

      const session = await signIn(app, PHONES.rotation);
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken, deviceId: DEVICE })
        .expect(200);

      const replay = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken, deviceId: DEVICE });

      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('replaying a retired token revokes every token for that device', async (ctx) => {
      if (!app || !context) return ctx.skip();

      const session = await signIn(app, PHONES.rotation);
      const refreshed = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken, deviceId: DEVICE })
        .expect(200);

      // Replay the retired token — this is the theft signal.
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken, deviceId: DEVICE })
        .expect(401);

      // The token that was still live must now be dead too.
      const live = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refreshed.body.refreshToken, deviceId: DEVICE });

      expect(live.status).toBe(401);

      const remaining = await context.prisma.refreshToken.count({
        where: { userId: session.user.id, deviceId: DEVICE, revokedAt: null },
      });
      expect(remaining).toBe(0);
    });

    it('rejects a refresh token presented from a different device', async (ctx) => {
      if (!app) return ctx.skip();

      const session = await signIn(app, PHONES.rotation);
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken, deviceId: 'device-somewhere-else' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('rejects an unknown refresh token', async (ctx) => {
      if (!app) return ctx.skip();

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'a'.repeat(43), deviceId: DEVICE });

      expect(response.status).toBe(401);
    });
  });

  describe('logout', () => {
    it('revokes the presented token and is idempotent', async (ctx) => {
      if (!app) return ctx.skip();

      const session = await signIn(app, PHONES.happyPath);

      await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(200);

      // Second call still succeeds — logout must not probe token existence.
      await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(200);

      const afterLogout = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken, deviceId: DEVICE });

      expect(afterLogout.status).toBe(401);
    });
  });

  describe('rate limiting', () => {
    it('blocks the 4th OTP request for a phone within the window', async (ctx) => {
      if (!app) return ctx.skip();

      for (let i = 0; i < 3; i += 1) {
        await request(app)
          .post('/api/v1/auth/otp/request')
          .send({ phone: PHONES.rateLimit })
          .expect(200);
      }

      const blocked = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.rateLimit })
        .set('Accept-Language', 'en');

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(blocked.body.error.message).toBe(
        'Too many attempts. Please wait a little and try again.',
      );
    });

    it('sets a usable Retry-After header', async (ctx) => {
      if (!app) return ctx.skip();

      for (let i = 0; i < 3; i += 1) {
        await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONES.rateLimit });
      }

      const blocked = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.rateLimit });

      const retryAfter = Number(blocked.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(900);
    });

    it('counts the normalised phone, not the typed string', async (ctx) => {
      if (!app) return ctx.skip();

      // Same number, four different spellings — the limit must still bite.
      const spellings = ['9999900011', '+919999900011', '09999900011', '99999-00011'];
      const statuses: number[] = [];

      for (const phone of spellings) {
        const response = await request(app).post('/api/v1/auth/otp/request').send({ phone });
        statuses.push(response.status);
      }

      expect(statuses).toEqual([200, 200, 200, 429]);
    });
  });
});
