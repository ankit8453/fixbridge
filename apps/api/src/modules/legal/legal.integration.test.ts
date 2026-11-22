import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { parseConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { otpKeys } from '../auth/otp';
import { CURRENT_LEGAL_VERSIONS } from './versions';

/**
 * Terms acceptance: what every app checks right after sign-in.
 */
const FIXED_OTP = '000000';
const PHONE = '+919999907501';
const DEVICE = 'device-legal';

let app: Express | undefined;
let context: AppContext | undefined;
let unavailableReason: string | undefined;

async function resetFixtures(ctx: AppContext): Promise<void> {
  await ctx.prisma.user.deleteMany({ where: { phone: PHONE } });
  await ctx.redis.del(
    otpKeys.code(PHONE),
    otpKeys.attempts(PHONE),
    otpKeys.ratePhone(PHONE),
    otpKeys.rateIp('::ffff:127.0.0.1'),
    otpKeys.rateIp('127.0.0.1'),
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
  if (context && !unavailableReason) await resetFixtures(context);
});

afterAll(async () => {
  if (context && !unavailableReason) await resetFixtures(context);
  if (context) await disposeContext(context);
});

async function signIn(server: Express): Promise<string> {
  await request(server).post('/api/v1/auth/otp/request').send({ phone: PHONE });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone: PHONE, otp: FIXED_OTP, deviceId: DEVICE });

  expect(response.status).toBe(200);
  return (response.body as { accessToken: string }).accessToken;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('legal acceptance', () => {
  it('starts with nothing accepted, and reports the current versions', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();
    const token = await signIn(app);

    const response = await request(app).get('/api/v1/legal/me').set(auth(token)).expect(200);

    expect(response.body).toEqual({
      customerTerms: {
        currentVersion: CURRENT_LEGAL_VERSIONS.customer_terms,
        acceptedVersion: null,
        acceptedAt: null,
        accepted: false,
      },
      partnerTerms: {
        currentVersion: CURRENT_LEGAL_VERSIONS.partner_terms,
        acceptedVersion: null,
        acceptedAt: null,
        accepted: false,
      },
    });
  });

  it('records an acceptance with when and from where, and keeps the first one', async (ctx) => {
    if (unavailableReason || !app || !context) return ctx.skip();
    const token = await signIn(app);
    const version = CURRENT_LEGAL_VERSIONS.customer_terms;

    const first = await request(app)
      .post('/api/v1/legal/accept')
      .set(auth(token))
      .set('User-Agent', 'legal-test-agent')
      .send({ document: 'customer_terms', version })
      .expect(200);

    expect(first.body.customerTerms).toMatchObject({ accepted: true, acceptedVersion: version });
    // Accepting customer terms says nothing about the partner agreement.
    expect(first.body.partnerTerms.accepted).toBe(false);

    // Accepting again does not move the original timestamp.
    const again = await request(app)
      .post('/api/v1/legal/accept')
      .set(auth(token))
      .send({ document: 'customer_terms', version })
      .expect(200);
    expect(again.body.customerTerms.acceptedAt).toBe(first.body.customerTerms.acceptedAt);

    const rows = await context.prisma.legalAcceptance.findMany({
      where: { user: { phone: PHONE } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      document: 'customer_terms',
      version,
      userAgent: 'legal-test-agent',
    });
    expect(rows[0]?.ip).toEqual(expect.any(String));
  });

  it('refuses a version that is no longer current', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();
    const token = await signIn(app);

    const response = await request(app)
      .post('/api/v1/legal/accept')
      .set(auth(token))
      .send({ document: 'partner_terms', version: '2000-01-01' })
      .expect(409);

    expect(response.body.error.code).toBe('LEGAL_VERSION_OUTDATED');
  });

  it('treats an older acceptance as not accepted, but still reports it', async (ctx) => {
    if (unavailableReason || !app || !context) return ctx.skip();
    const token = await signIn(app);
    const user = await context.prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });

    await context.prisma.legalAcceptance.create({
      data: { userId: user.id, document: 'partner_terms', version: '2000-01-01' },
    });

    const response = await request(app).get('/api/v1/legal/me').set(auth(token)).expect(200);

    expect(response.body.partnerTerms).toMatchObject({
      accepted: false,
      acceptedVersion: '2000-01-01',
      currentVersion: CURRENT_LEGAL_VERSIONS.partner_terms,
    });
  });

  it('needs a signed-in user', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    await request(app).get('/api/v1/legal/me').expect(401);
    await request(app)
      .post('/api/v1/legal/accept')
      .send({ document: 'customer_terms', version: CURRENT_LEGAL_VERSIONS.customer_terms })
      .expect(401);
  });
});
