import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { parseConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import type { MailMessage, Mailer } from '../../core/mailer';
import { otpKeys } from './otp';
import { hashPassword } from './password';
import { createTeamRelayOtpTransport } from './relay';
import type { OtpTransport } from './transport';

/**
 * Pilot sign-in: the code waits for a team member to send it on WhatsApp.
 */
const PHONE = '+919999907601';
const DEVICE = 'device-relay';
const STAFF_EMAIL = 'relay-test@fixbridge.test';
const STAFF_PASSWORD = 'correct horse battery staple';

let app: Express | undefined;
let context: AppContext | undefined;
let originalTransport: OtpTransport | undefined;
let unavailableReason: string | undefined;
const sent: MailMessage[] = [];

const fakeMailer: Mailer = {
  name: 'fake',
  async send(message) {
    sent.push(message);
  },
};

async function resetFixtures(ctx: AppContext): Promise<void> {
  await ctx.prisma.user.deleteMany({ where: { phone: PHONE } });
  const relayKeys = await ctx.redis.keys('auth:relay:*');
  await ctx.redis.del(
    ...relayKeys,
    otpKeys.code(PHONE),
    otpKeys.attempts(PHONE),
    otpKeys.ratePhone(PHONE),
    otpKeys.rateIp('::ffff:127.0.0.1'),
    otpKeys.rateIp('127.0.0.1'),
    `auth:admin:rate:email:${STAFF_EMAIL}`,
    'auth:admin:rate:ip:::ffff:127.0.0.1',
    'auth:admin:rate:ip:127.0.0.1',
  );
  // Resend cooldown keys are per phone; clear whatever shape they take.
  const cooldown = await ctx.redis.keys(`*${PHONE}*`);
  if (cooldown.length > 0) await ctx.redis.del(...cooldown);
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

  // Created once and kept: audit rows are append-only, so a staff account that
  // has marked a code as sent can never be deleted again.
  await context.prisma.adminUser.upsert({
    where: { email: STAFF_EMAIL },
    update: { status: 'active' },
    create: {
      email: STAFF_EMAIL,
      passwordHash: await hashPassword(STAFF_PASSWORD),
      name: 'Relay Tester',
      role: 'subadmin',
    },
  });

  originalTransport = context.otpTransport;
  context.otpTransport = createTeamRelayOtpTransport({
    redis: context.redis,
    ttlSeconds: context.config.OTP_TTL_SECONDS,
    mailer: fakeMailer,
    alertEmails: ['team@fixbridge.test'],
    consoleUrl: 'https://www.fixbridge.me/admin/sign-in-requests',
    logger: context.logger,
  });
  app = createApp(context);
});

beforeEach(async () => {
  sent.length = 0;
  if (!context || unavailableReason) return;
  await resetFixtures(context);
});

afterAll(async () => {
  if (context && !unavailableReason) {
    await resetFixtures(context);
    if (originalTransport) context.otpTransport = originalTransport;
  }
  if (context) await disposeContext(context);
});

async function staffToken(server: Express): Promise<string> {
  const response = await request(server)
    .post('/api/v1/auth/admin/login')
    .send({ email: STAFF_EMAIL, password: STAFF_PASSWORD, deviceId: 'device-relay-staff' })
    .expect(200);
  return (response.body as { accessToken: string }).accessToken;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface RelayView {
  id: string;
  phone: string;
  otp: string;
  sentAt: string | null;
  sentBy: string | null;
  whatsappUrl: string;
}

async function pending(server: Express, token: string): Promise<RelayView[]> {
  const response = await request(server)
    .get('/api/v1/admin/otp-relay')
    .set(auth(token))
    .expect(200);
  return (response.body as { requests: RelayView[] }).requests;
}

describe('team relay sign-in', () => {
  it('tells the app the team will send it, and puts the code in front of staff', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    const asked = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: PHONE })
      .expect(200);
    expect(asked.body.delivery).toBe('team_relay');

    const token = await staffToken(app);
    const [waiting, ...rest] = await pending(app, token);

    expect(rest).toHaveLength(0);
    expect(waiting).toMatchObject({ phone: PHONE, sentAt: null, sentBy: null });
    expect(waiting?.otp).toMatch(/^\d{6}$/);
    expect(waiting?.whatsappUrl).toContain(`https://wa.me/${PHONE.slice(1)}?text=`);
  });

  it('emails the team an alert with the code and a WhatsApp link', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONE }).expect(200);

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const [waiting] = await pending(app, await staffToken(app));
    expect(sent[0]?.to).toEqual(['team@fixbridge.test']);
    expect(sent[0]?.subject).toContain('Sign-in code for');
    expect(sent[0]?.text).toContain(`Code: ${waiting?.otp}`);
    expect(sent[0]?.text).toContain('https://wa.me/');
  });

  it('records who sent it, in the request and in the audit log', async (ctx) => {
    if (unavailableReason || !app || !context) return ctx.skip();

    await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONE }).expect(200);
    const token = await staffToken(app);
    const [waiting] = await pending(app, token);

    const marked = await request(app)
      .post(`/api/v1/admin/otp-relay/${waiting?.id}/sent`)
      .set(auth(token))
      .expect(200);

    expect(marked.body.request).toMatchObject({ sentBy: 'Relay Tester' });
    expect(marked.body.request.sentAt).toEqual(expect.any(String));

    const log = await context.prisma.auditLog.findFirst({
      where: { action: 'otp_relay.sent', targetId: waiting?.id },
    });
    expect(log).not.toBeNull();
    // The code itself never reaches the audit log.
    expect(JSON.stringify(log?.payload)).not.toContain(waiting?.otp);
  });

  it('answers 404 for a request that has gone', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();
    const token = await staffToken(app);

    await request(app)
      .post('/api/v1/admin/otp-relay/00000000-0000-4000-8000-000000000000/sent')
      .set(auth(token))
      .expect(404);
  });

  it('takes the code off the page once the person has signed in', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONE }).expect(200);
    const token = await staffToken(app);
    const [waiting] = await pending(app, token);

    // Signing in with the code the team sent.
    await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: PHONE, otp: waiting?.otp, deviceId: DEVICE })
      .expect(200);

    expect(await pending(app, token)).toEqual([]);
  });

  it('is for staff only', async (ctx) => {
    if (unavailableReason || !app) return ctx.skip();

    await request(app).get('/api/v1/admin/otp-relay').expect(401);

    await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONE }).expect(200);
    const [waiting] = await pending(app, await staffToken(app));
    const signedIn = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: PHONE, otp: waiting?.otp, deviceId: DEVICE })
      .expect(200);

    await request(app)
      .get('/api/v1/admin/otp-relay')
      .set(auth((signedIn.body as { accessToken: string }).accessToken))
      .expect(403);
  });
});
