import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { registerOutboxSubscribers } from '../../core/background';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { createOutboxDispatcher } from '../../core/outbox';
import { purgeBookingData } from '../bookings/repository';
import { generateSlotsForProvider } from '../bookings/slots-service';
import { asFakeGateway, type FakeGateway } from './gateway';
import * as ledger from './ledger';

/**
 * The Phase 8 carry-over: `COLLECT_FEE_AT_BOOKING`, actually switched on.
 *
 * Phase 8 built the upfront-fee flow and its auto-refund consumer but never ran
 * them together, because turning the flag on would have changed every other
 * booking in that suite. So it got its own file, with its own context built from
 * a config that has the flag set — which is the only honest way to prove a flag
 * is safe to flip: run the thing.
 *
 * What it proves: a customer pays the visit fee at booking, the money lands in
 * the ledger, they cancel before anybody visits, and the fee comes back **without
 * anybody asking** — because a fee taken for a visit that never happened must
 * not need a support ticket to reverse.
 */

const FIXED_OTP = '000000';
const PHONES = {
  technician: '+919999910001',
  customer: '+919999910010',
};

const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };
const FIXED_PRICE_PAISE = 18_000;

let app: Express | undefined;
let context: AppContext | undefined;
let gateway: FakeGateway | undefined;
let unavailableReason: string | undefined;

interface Fixture {
  technicianId: string;
  customerId: string;
  addressId: string;
  categoryId: number;
  priceCardId: string;
}

let fixture: Fixture | undefined;

function firstMeaningfulLine(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  return (
    error.message
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? error.name
  );
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * The fourth group must start 8, 9, a or b — that nibble is the RFC 4122
 * variant, and Zod's `.uuid()` checks it. `c000` looks fine and is rejected.
 * Distinct from the other suites' prefixes so fixtures cannot collide.
 */
const fixtureUuid = (suffix: string): string =>
  ['00000000', '0000', '4000', '8f00', suffix.padStart(12, '0')].join('-');

async function signIn(server: Express, phone: string, deviceId = 'device-upfront') {
  await request(server).post('/api/v1/auth/otp/request').send({ phone });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; user: { id: string } };
}

async function clearFixtureData(ctx: AppContext, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const bookingIds = (
    await ctx.prisma.booking.findMany({
      where: { OR: [{ customerId: { in: userIds } }, { providerId: { in: userIds } }] },
      select: { id: true },
    })
  ).map((booking) => booking.id);

  const paymentIds = (
    await ctx.prisma.payment.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { id: true },
    })
  ).map((payment) => payment.id);

  await ctx.prisma.$executeRawUnsafe('TRUNCATE ledger_entries, ledger_journals CASCADE');

  if (paymentIds.length > 0) {
    await ctx.prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await ctx.prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }

  await ctx.prisma.webhookEvent.deleteMany({});
  await ctx.prisma.$executeRawUnsafe('DELETE FROM accounts');
  await purgeBookingData(ctx.prisma, userIds);

  if (bookingIds.length > 0) {
    await ctx.prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: bookingIds } } });
  }

  const keys = await ctx.redis.keys('booking:*');
  if (keys.length > 0) await ctx.redis.del(...keys);
}

async function purgeFixture(ctx: AppContext): Promise<void> {
  const users = await ctx.prisma.user.findMany({
    where: { phone: { in: Object.values(PHONES) } },
    select: { id: true },
  });

  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;

  await clearFixtureData(ctx, ids);
  await ctx.prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  let config: AppConfig;

  try {
    // The whole point of this file: a context whose config has the flag on.
    config = parseConfig({ ...process.env, COLLECT_FEE_AT_BOOKING: 'true' });
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
  gateway = asFakeGateway(context.gateway);
  registerOutboxSubscribers(context);

  const city = await context.prisma.city.findFirst({ where: { isActive: true } });
  const category = await context.prisma.category.findFirst({
    where: { isActive: true, parentId: { not: null } },
    orderBy: { id: 'asc' },
  });

  if (!city || !category) {
    unavailableReason = 'the database has no seeded city or category; run `npm run seed`';
    return;
  }

  await purgeFixture(context);

  const session = await signIn(app, PHONES.technician, 'device-upfront-tech');
  const technicianId = session.user.id;

  await context.prisma.userRole.upsert({
    where: { userId_role: { userId: technicianId, role: 'technician' } },
    update: {},
    create: { userId: technicianId, role: 'technician' },
  });

  await context.prisma.providerProfile.upsert({
    where: { userId: technicianId },
    update: { isListed: true, completenessScore: 100, cityId: city.id, serviceRadiusKm: 10 },
    create: {
      userId: technicianId,
      displayName: 'Upfront Fee Technician',
      yearsExperience: 6,
      cityId: city.id,
      serviceRadiusKm: 10,
      completenessScore: 100,
      isListed: true,
    },
  });

  await context.prisma.$executeRaw`
    UPDATE provider_profiles
    SET base_location = ST_SetSRID(
          ST_MakePoint(${WRIGHT_TOWN.lng}::double precision, ${WRIGHT_TOWN.lat}::double precision),
          4326
        )::geography
    WHERE user_id = ${technicianId}::uuid
  `;

  await context.prisma.providerVerificationSummary.upsert({
    where: { providerId: technicianId },
    update: { badge: 'VERIFIED', levelsPassed: [0, 1] },
    create: {
      providerId: technicianId,
      badge: 'VERIFIED',
      levelsPassed: [0, 1],
      badgeSince: new Date(),
    },
  });

  await context.prisma.providerSkill.upsert({
    where: { providerId_categoryId: { providerId: technicianId, categoryId: category.id } },
    update: {},
    create: { providerId: technicianId, categoryId: category.id },
  });

  const priceCardId = fixtureUuid('c01');

  await context.prisma.providerPriceCard.upsert({
    where: { id: priceCardId },
    update: { amountPaise: FIXED_PRICE_PAISE, isActive: true },
    create: {
      id: priceCardId,
      providerId: technicianId,
      categoryId: category.id,
      title: 'Flat rate visit',
      priceType: 'fixed',
      amountPaise: FIXED_PRICE_PAISE,
    },
  });

  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    const id = fixtureUuid(`d0${dayOfWeek}`);

    await context.prisma.providerAvailabilityTemplate.upsert({
      where: { id },
      update: { isActive: true },
      create: {
        id,
        providerId: technicianId,
        dayOfWeek,
        startMinute: 0,
        endMinute: 24 * 60,
        isActive: true,
      },
    });
  }

  const customer = await signIn(app, PHONES.customer, 'device-upfront-cust');

  const addressId = fixtureUuid('a01');
  await context.prisma.$executeRaw`
    INSERT INTO addresses
      (id, user_id, label, address_text, landmark, city_id, location, is_default, created_at, updated_at)
    VALUES (
      ${addressId}::uuid, ${customer.user.id}::uuid, 'home'::address_label,
      '11, Upfront Street, Wright Town', 'By the chowk', ${city.id},
      ST_SetSRID(ST_MakePoint(${WRIGHT_TOWN.lng}::double precision, ${WRIGHT_TOWN.lat}::double precision), 4326)::geography,
      true, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  fixture = {
    technicianId,
    customerId: customer.user.id,
    addressId,
    categoryId: category.id,
    priceCardId,
  };
}, 120_000);

beforeEach(async () => {
  if (!context || !fixture || unavailableReason) return;

  gateway?.reset();
  await clearFixtureData(context, [fixture.technicianId, fixture.customerId]);
  await generateSlotsForProvider(context, fixture.technicianId);
});

afterAll(async () => {
  if (context && !unavailableReason) await purgeFixture(context);
  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] upfront-fee tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

async function drainOutbox(): Promise<void> {
  const ctx = context as AppContext;

  const dispatcher = createOutboxDispatcher({
    prisma: ctx.prisma,
    redis: ctx.redis,
    config: ctx.config,
    logger: ctx.logger,
    registry: ctx.outbox,
    now: () => new Date(Date.now() + 5_000),
  });

  await ctx.redis.del('outbox:dispatcher:lock');

  for (let pass = 0; pass < 20; pass += 1) {
    const result = await dispatcher.runOnce();
    if (result.claimed === 0) return;
  }
}

function deliverWebhook(eventType: string, entity: Record<string, unknown>) {
  const fake = gateway as FakeGateway;
  const { raw, signature, eventId } = fake.webhookBody(eventType, entity);

  return request(app as Express)
    .post('/api/v1/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', signature)
    .set('X-Razorpay-Event-Id', eventId)
    .send(raw.toString('utf8'));
}

describe('COLLECT_FEE_AT_BOOKING, switched on', () => {
  it('has the flag actually on', () => {
    if (unavailableReason) {
      console.warn(SKIP(unavailableReason));
      expect(unavailableReason).toBeTruthy();
      return;
    }

    // Otherwise every assertion below would pass for the wrong reason.
    expect(context?.config.COLLECT_FEE_AT_BOOKING).toBe(true);
    expect(fixture).toBeDefined();
  });

  it('takes the visit fee at booking, and returns it when nobody visits', async () => {
    if (unavailableReason || !context || !fixture || !app || !gateway) return;

    /* 1. Book. */
    const slot = await context.prisma.slot.findFirst({
      where: {
        providerId: fixture.technicianId,
        status: 'open',
        startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
      },
      orderBy: { startsAt: 'asc' },
    });

    const customer = await signIn(app, PHONES.customer, 'device-upfront-cust');

    // Asserted, not optional-chained into the request: a missing slot would
    // otherwise surface as an opaque validation error about `slotId`.
    expect(slot, 'fixture technician has no open slot').toBeTruthy();

    const created = await request(app)
      .post('/api/v1/bookings')
      .set(auth(customer.accessToken))
      .send({
        slotId: slot?.id,
        categoryId: fixture.categoryId,
        addressId: fixture.addressId,
        priceCardId: fixture.priceCardId,
      });

    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const bookingId = created.body.booking.id as string;
    const visitFeePaise = created.body.booking.visitFeePaise as number;

    expect(visitFeePaise).toBeGreaterThan(0);

    /* 2. Pay the visit fee up front — the purpose the flag unlocks. */
    const started = await request(app)
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set(auth(customer.accessToken))
      .send({ purpose: 'visit_fee_upfront' })
      .expect(201);

    expect(started.body.payment.purpose).toBe('visit_fee_upfront');
    expect(started.body.amountPaise).toBe(visitFeePaise);

    const orderId = started.body.orderId as string;
    const captured = gateway.captureOrder(orderId);

    /* 3. The webhook captures it, and the money lands in the ledger. */
    await deliverWebhook('payment.captured', {
      id: captured.paymentId,
      order_id: orderId,
      amount: visitFeePaise,
    }).expect(200);

    await drainOutbox();

    const afterCapture = await context.prisma.payment.findUnique({
      where: { id: started.body.payment.id },
    });
    expect(afterCapture?.status).toBe('captured');

    const held = await ledger.platformPosition(context.prisma);
    expect(held.gatewayCashPaise).toBe(visitFeePaise);

    /* 4. The customer cancels. Nobody ever visited. */
    await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set(auth(customer.accessToken))
      .send({ reason: 'changed_mind' })
      .expect(200);

    /**
     * 5. The auto-refund consumer fires off the cancellation event.
     *
     * Nobody asked for this. A fee taken for a visit that never happened has to
     * come back on its own, or the flag is not safe to turn on — a customer who
     * has to open a support ticket to get ₹49 back simply does not come back.
     */
    await drainOutbox();

    const refunds = await context.prisma.refund.findMany({
      where: { paymentId: started.body.payment.id },
    });

    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.amountPaise).toBe(visitFeePaise);
    expect(refunds[0]?.reason).toMatch(/before the visit/i);

    /* 6. The gateway confirms, and the ledger reverses. */
    await deliverWebhook('refund.processed', {
      id: refunds[0]?.gatewayRefundId,
      payment_id: captured.paymentId,
      amount: visitFeePaise,
    }).expect(200);

    await drainOutbox();

    const settled = await context.prisma.payment.findUnique({
      where: { id: started.body.payment.id },
    });
    expect(settled?.status).toBe('refunded');

    // Everything is back where it started: we hold nothing and owe nothing.
    const position = await ledger.platformPosition(context.prisma);
    expect(position.gatewayCashPaise).toBe(0);
    expect(position.revenuePaise).toBe(0);
    expect(position.owedToProvidersPaise).toBe(0);

    // And the books balanced at every step.
    for (const journal of await ledger.auditJournals(context.prisma)) {
      expect(journal.debits).toBe(journal.credits);
    }
  }, 90_000);

  it('does not refund an upfront fee when the technician actually came', async () => {
    if (unavailableReason || !context || !fixture || !app || !gateway) return;

    const slot = await context.prisma.slot.findFirst({
      where: {
        providerId: fixture.technicianId,
        status: 'open',
        startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
      },
      orderBy: { startsAt: 'asc' },
    });

    const customer = await signIn(app, PHONES.customer, 'device-upfront-kept');
    const technician = await signIn(app, PHONES.technician, 'device-upfront-tech');

    // Asserted, not optional-chained into the request: a missing slot would
    // otherwise surface as an opaque validation error about `slotId`.
    expect(slot, 'fixture technician has no open slot').toBeTruthy();

    const created = await request(app)
      .post('/api/v1/bookings')
      .set(auth(customer.accessToken))
      .send({
        slotId: slot?.id,
        categoryId: fixture.categoryId,
        addressId: fixture.addressId,
        priceCardId: fixture.priceCardId,
      });

    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const bookingId = created.body.booking.id as string;

    const started = await request(app)
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set(auth(customer.accessToken))
      .send({ purpose: 'visit_fee_upfront' })
      .expect(201);

    const captured = gateway.captureOrder(started.body.orderId as string);

    await deliverWebhook('payment.captured', {
      id: captured.paymentId,
      order_id: started.body.orderId,
      amount: started.body.amountPaise,
    }).expect(200);

    await drainOutbox();

    // The technician accepts and turns up. The visit fee was earned.
    await request(app)
      .post(`/api/v1/bookings/${bookingId}/accept`)
      .set(auth(technician.accessToken))
      .expect(200);

    const startOtp = await context.redis.get(`booking:otp:plain:start:${bookingId}`);
    await request(app)
      .post(`/api/v1/bookings/${bookingId}/start`)
      .set(auth(technician.accessToken))
      .send({ otp: startOtp ?? '0000' })
      .expect(200);

    await drainOutbox();

    const refunds = await context.prisma.refund.count({
      where: { paymentId: started.body.payment.id },
    });

    expect(refunds).toBe(0);
  }, 90_000);

  it('refuses an upfront payment when the flag is off', async () => {
    if (unavailableReason || !context || !fixture) return;

    /**
     * The other half of the flag, checked against a context that does *not*
     * have it — otherwise "the flow works with it on" would say nothing about
     * whether it is genuinely off for the pilot.
     */
    const offConfig = parseConfig({ ...process.env, COLLECT_FEE_AT_BOOKING: 'false' });
    const offContext = createContext(offConfig);
    const offApp = createApp(offContext);

    try {
      const slot = await context.prisma.slot.findFirst({
        where: {
          providerId: fixture.technicianId,
          status: 'open',
          startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
        },
        orderBy: { startsAt: 'asc' },
      });

      const customer = await signIn(offApp, PHONES.customer, 'device-flag-off');

      const created = await request(offApp)
        .post('/api/v1/bookings')
        .set(auth(customer.accessToken))
        .send({
          slotId: slot?.id,
          categoryId: fixture.categoryId,
          addressId: fixture.addressId,
          priceCardId: fixture.priceCardId,
        })
        .expect(201);

      const response = await request(offApp)
        .post(`/api/v1/bookings/${created.body.booking.id}/payments`)
        .set(auth(customer.accessToken))
        .send({ purpose: 'visit_fee_upfront' });

      expect(response.status).toBe(400);
    } finally {
      await disposeContext(offContext);
    }
  }, 60_000);
});
