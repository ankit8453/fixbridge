import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { parseConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { hashPassword } from './password';

/**
 * Staff sessions through the shared `/auth/refresh` and `/auth/logout`.
 *
 * The console signs in at `/auth/admin/login` and then renews like every other
 * surface, at `/auth/refresh`. That endpoint only ever read the customer token
 * table, so a console session died with its first access token — fifteen
 * minutes — and logging out never revoked the staff token.
 */
const EMAIL = 'session-test@fixbridge.test';
const PASSWORD = 'correct horse battery staple';
const DEVICE = 'device-staff-session';

let app: Express | undefined;
let context: AppContext | undefined;
let unavailableReason: string | undefined;

async function resetFixtures(ctx: AppContext): Promise<void> {
  await ctx.prisma.adminUser.deleteMany({ where: { email: EMAIL } });
  await ctx.redis.del(
    `auth:admin:rate:email:${EMAIL}`,
    'auth:admin:rate:ip:::ffff:127.0.0.1',
    'auth:admin:rate:ip:127.0.0.1',
  );
}

beforeAll(async () => {
  try {
    context = createContext(parseConfig());
    await context.prisma.$queryRaw`SELECT 1`;
    await context.redis.ping();
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message.split('\n')[0] : 'unavailable';
    return;
  }

  app = createApp(context);
});

beforeEach(async () => {
  if (!context || unavailableReason) return;
  await resetFixtures(context);
  await context.prisma.adminUser.create({
    data: {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Session Test',
      role: 'subadmin',
    },
  });
});

afterAll(async () => {
  if (context && !unavailableReason) await resetFixtures(context);
  if (context) await disposeContext(context);
});

async function staffLogin(server: Express, deviceId = DEVICE) {
  const response = await request(server)
    .post('/api/v1/auth/admin/login')
    .send({ email: EMAIL, password: PASSWORD, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; refreshToken: string };
}

describe('staff sessions', () => {
  it('renews a console session at /auth/refresh, keeping staff roles', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    const login = await staffLogin(app);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken, deviceId: DEVICE });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).not.toBe(login.refreshToken);
    expect(refreshed.body.user.roles).toEqual(['ops']);

    // The new access token works on an ops route.
    await request(app)
      .get('/api/v1/admin/summary')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(200);
  });

  it('treats a replayed staff refresh token as stolen', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    const login = await staffLogin(app);
    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken, deviceId: DEVICE })
      .expect(200);

    // Spent token offered again: refused, and the device's live token dies too.
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken, deviceId: DEVICE })
      .expect(401);

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken, deviceId: DEVICE })
      .expect(401);
  });

  it('refuses a staff token presented from another device', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    const login = await staffLogin(app);

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken, deviceId: 'some-other-device' })
      .expect(401);
  });

  it('rejects staff and customer tokens identically', async (ctx) => {
    if (unavailableReason || !app || !context) return ctx.skip();

    const login = await staffLogin(app);
    await context.prisma.adminRefreshToken.updateMany({
      where: { admin: { email: EMAIL } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const staff = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken, deviceId: DEVICE });

    const unknown = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'x'.repeat(login.refreshToken.length), deviceId: DEVICE });

    expect(staff.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(staff.body.error.code).toBe(unknown.body.error.code);
    expect(staff.body.error.message).toBe(unknown.body.error.message);
  });

  it('revokes the staff token on /auth/logout', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    const login = await staffLogin(app);

    await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: login.refreshToken })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken, deviceId: DEVICE })
      .expect(401);
  });
});
