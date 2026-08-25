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
import { asFakeGateway, type FakeGateway } from '../payments/gateway';
import * as ledger from '../payments/ledger';

/**
 * Phase C against real Postgres, Redis and the fake gateway.
 *
 * Three properties this file exists to prove, and they are the three the whole
 * feature rests on:
 *
 *   1. **The technician is paid on the pre-discount amount.** A coupon reduces
 *      what the customer pays and nothing else. This is asserted straight off
 *      the ledger, not off an API response, because the ledger is what a payout
 *      is computed from.
 *   2. **The journal balances**, with the platform's own expense account
 *      carrying the difference. The deferred constraint trigger would refuse it
 *      otherwise, so a capture that commits at all is already most of the proof —
 *      the assertions here name the numbers.
 *   3. **Cash refuses the coupon, server-side.** Not hidden in a screen: the
 *      redemption is dropped and the technician's dues are computed on the full
 *      price, because on cash a discount would come out of their pocket.
 */

const FIXED_OTP = '000000';
const PHONES = {
  technician: '+919999907001',
  customer: '+919999907010',
};

const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };

/** ₹500 flat rate, so a percentage of it is a round number of paise. */
const FIXED_PRICE_PAISE = 50_000;

let app: Express | undefined;
let context: AppContext | undefined;
let gateway: FakeGateway | undefined;
let unavailableReason: string | undefined;

interface Fixture {
  technicianId: string;
  customerId: string;
  adminId: string;
  addressId: string;
  cityId: number;
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

/** Own prefix, so these fixtures cannot collide with another suite's. */
const fixtureUuid = (suffix: string): string =>
  ['00000000', '0000', '4000', '8c00', suffix.padStart(12, '0')].join('-');

async function signIn(server: Express, phone: string, deviceId: string) {
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

  // Redemptions first: `coupon_id` is ON DELETE RESTRICT, so a coupon cannot be
  // removed while one points at it — which is the behaviour the schema wants.
  await ctx.prisma.couponRedemption.deleteMany({ where: { bookingId: { in: bookingIds } } });

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
  if (ids.length > 0) {
    await clearFixtureData(ctx, ids);
    await ctx.prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  await ctx.prisma.coupon.deleteMany({ where: { code: { startsWith: 'PHASEC' } } });
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
  gateway = asFakeGateway(context.gateway);
  registerOutboxSubscribers(context);

  const city = await context.prisma.city.findFirst({ where: { isActive: true } });
  const category = await context.prisma.category.findFirst({
    where: { isActive: true, parentId: { not: null } },
    orderBy: { id: 'asc' },
  });
  const admin = await context.prisma.adminUser.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!city || !category || !admin) {
    unavailableReason =
      'the database has no seeded city, category or admin user; run `npm run seed`';
    return;
  }

  await purgeFixture(context);

  const session = await signIn(app, PHONES.technician, 'device-coupon-tech');
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
      displayName: 'Coupon Technician',
      yearsExperience: 5,
      cityId: city.id,
      serviceRadiusKm: 10,
      completenessScore: 100,
      isListed: true,
    },
  });

  await context.prisma.providerProfile.update({
    where: { userId: technicianId },
    data: { baseLat: WRIGHT_TOWN.lat, baseLng: WRIGHT_TOWN.lng },
  });

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

  const customer = await signIn(app, PHONES.customer, 'device-coupon-cust');

  const addressId = fixtureUuid('a01');
  await context.prisma.address.upsert({
    where: { id: addressId },
    update: {},
    create: {
      id: addressId,
      userId: customer.user.id,
      label: 'home',
      addressText: '7, Coupon Lane, Wright Town',
      landmark: 'Near the market',
      cityId: city.id,
      lat: WRIGHT_TOWN.lat,
      lng: WRIGHT_TOWN.lng,
      isDefault: true,
    },
  });

  fixture = {
    technicianId,
    customerId: customer.user.id,
    adminId: admin.id,
    addressId,
    cityId: city.id,
    categoryId: category.id,
    priceCardId,
  };
}, 120_000);

beforeEach(async () => {
  if (!context || !fixture || unavailableReason) return;

  gateway?.reset();
  await clearFixtureData(context, [fixture.technicianId, fixture.customerId]);
  await context.prisma.coupon.deleteMany({ where: { code: { startsWith: 'PHASEC' } } });
  await generateSlotsForProvider(context, fixture.technicianId);
});

afterAll(async () => {
  if (context && !unavailableReason) await purgeFixture(context);
  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] coupon tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

/** A coupon straight into the database, so the tests do not depend on the console. */
async function seedCoupon(overrides: Record<string, unknown> = {}) {
  const ctx = context as AppContext;
  const fix = fixture as Fixture;

  return ctx.prisma.coupon.create({
    data: {
      code: 'PHASEC20',
      description: 'Phase C test campaign',
      discountType: 'percent',
      value: 20,
      maxDiscountPaise: 20_000,
      minOrderPaise: 0,
      validFrom: new Date(Date.now() - 60 * 60 * 1000),
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      perCustomerLimit: 1,
      createdByAdminId: fix.adminId,
      ...overrides,
    },
  });
}

/** Books a job and drives it to WORK_DONE, which is where a payable exists. */
async function bookAndComplete() {
  const ctx = context as AppContext;
  const server = app as Express;
  const fix = fixture as Fixture;

  const slot = await ctx.prisma.slot.findFirst({
    where: {
      providerId: fix.technicianId,
      status: 'open',
      startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
    },
    orderBy: { startsAt: 'asc' },
  });

  if (!slot) throw new Error('fixture technician has no open slot');

  const customer = await signIn(server, PHONES.customer, 'device-coupon-cust');
  const technician = await signIn(server, PHONES.technician, 'device-coupon-tech');

  const created = await request(server)
    .post('/api/v1/bookings')
    .set(auth(customer.accessToken))
    .send({
      slotId: slot.id,
      categoryId: fix.categoryId,
      addressId: fix.addressId,
      priceCardId: fix.priceCardId,
    });

  expect(created.status, JSON.stringify(created.body)).toBe(201);

  const bookingId = created.body.booking.id as string;

  await request(server)
    .post(`/api/v1/bookings/${bookingId}/accept`)
    .set(auth(technician.accessToken))
    .expect(200);

  const startOtp = await ctx.redis.get(`booking:otp:plain:start:${bookingId}`);
  await request(server)
    .post(`/api/v1/bookings/${bookingId}/start`)
    .set(auth(technician.accessToken))
    .send({ otp: startOtp ?? '0000' })
    .expect(200);

  const endOtp = await ctx.redis.get(`booking:otp:plain:end:${bookingId}`);
  const done = await request(server)
    .post(`/api/v1/bookings/${bookingId}/complete`)
    .set(auth(technician.accessToken))
    .send({ otp: endOtp ?? '0000' })
    .expect(200);

  return {
    bookingId,
    payablePaise: done.body.booking.payablePaise as number,
    customer,
    technician,
  };
}

/**
 * Runs the outbox to completion.
 *
 * A webhook is only *recorded* by the HTTP request; it is **processed** by an
 * outbox subscriber, which is what actually captures the payment and posts the
 * journal. Without this the payment sits at `created` and the ledger is empty —
 * which is exactly what the at-least-once design intends, and exactly why a
 * test that asserts on the ledger has to drain first.
 */
async function drainOutbox(): Promise<void> {
  const ctx = context as AppContext;

  const dispatcher = createOutboxDispatcher({
    prisma: ctx.prisma,
    redis: ctx.redis,
    config: ctx.config,
    logger: ctx.logger,
    registry: ctx.outbox,
    // Ahead of the clock, so an event whose first attempt is scheduled a moment
    // out is still claimable in this pass.
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

describe('Phase C — coupons', () => {
  it('has its fixtures', () => {
    if (unavailableReason) {
      console.warn(SKIP(unavailableReason));
      expect(unavailableReason).toBeTruthy();
      return;
    }

    expect(fixture).toBeDefined();
  });

  describe('applying', () => {
    it('takes the discount off what the customer owes, and nothing else', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon();
      const job = await bookAndComplete();

      const applied = await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'phasec20', paymentMethod: 'online' })
        .expect(200);

      // 20% of the payable, under the ₹200 cap.
      const expected = Math.floor((job.payablePaise * 20) / 100);

      expect(applied.body.coupon.discountPaise).toBe(expected);
      expect(applied.body.coupon.payablePaise).toBe(job.payablePaise - expected);
      // The number the technician is paid on is unchanged and stated.
      expect(applied.body.coupon.originalPayablePaise).toBe(job.payablePaise);
    });

    it('accepts a lowercase code, because a poster is uppercase', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon();
      const job = await bookAndComplete();

      await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: '  phasec20 ', paymentMethod: 'online' })
        .expect(200);
    });

    it('refuses a second coupon on the same booking', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon();
      await seedCoupon({ code: 'PHASECOTHER', perCustomerLimit: 5 });
      const job = await bookAndComplete();

      await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' })
        .expect(200);

      // One coupon per booking, enforced by a unique index rather than a check
      // this service has to remember.
      const second = await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'PHASECOTHER', paymentMethod: 'online' });

      expect(second.status).toBe(409);
      expect(second.body.error?.code ?? second.body.code).toBe('COUPON_ALREADY_APPLIED');
    });

    /**
     * The rule the product owner made non-negotiable, checked at the API rather
     * than only in the pure function's unit tests.
     */
    it('refuses a coupon when the customer says they will pay cash', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon();
      const job = await bookAndComplete();

      const refused = await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'cash' });

      expect(refused.status).toBe(422);
      expect(refused.body.error?.details?.reason ?? refused.body.details?.reason).toBe(
        'cash_not_eligible',
      );

      // And nothing was written.
      const redemption = await context.prisma.couponRedemption.findUnique({
        where: { bookingId: job.bookingId },
      });
      expect(redemption).toBeNull();
    });

    it('refuses a paused coupon', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon({ status: 'paused' });
      const job = await bookAndComplete();

      await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' })
        .expect(422);
    });

    it('refuses a bill below the coupon’s minimum', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon({ minOrderPaise: 10_00_000 });
      const job = await bookAndComplete();

      const refused = await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' });

      expect(refused.status).toBe(422);
      expect(refused.body.error?.details?.reason ?? refused.body.details?.reason).toBe(
        'below_min_order',
      );
    });

    it('lets the customer remove it again', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon();
      const job = await bookAndComplete();

      await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' })
        .expect(200);

      await request(app)
        .delete(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .expect(200);

      // Removing it returns the redemption to the campaign's budget.
      const remaining = await context.prisma.couponRedemption.count();
      expect(remaining).toBe(0);
    });
  });

  describe('the ledger', () => {
    /**
     * The single most important test in this phase.
     *
     * The technician's payable must be identical with and without a coupon,
     * because the platform funds the discount out of its own commission. This
     * is read from the ledger — the thing a payout is actually computed from —
     * rather than from an API response that could be right for the wrong reason.
     */
    it('pays the technician on the pre-discount amount and books the discount as platform expense', async () => {
      if (unavailableReason || !context || !fixture || !app || !gateway) return;

      await seedCoupon();
      const job = await bookAndComplete();

      const applied = await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' })
        .expect(200);

      const discountPaise = applied.body.coupon.discountPaise as number;
      const chargedPaise = job.payablePaise - discountPaise;

      expect(discountPaise).toBeGreaterThan(0);

      /* The gateway order is for the discounted amount — that is what is paid. */
      const started = await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/payments`)
        .set(auth(job.customer.accessToken))
        .send({})
        .expect(201);

      expect(started.body.amountPaise).toBe(chargedPaise);

      const orderId = started.body.orderId as string;
      const captured = gateway.captureOrder(orderId);

      await deliverWebhook('payment.captured', {
        id: captured.paymentId,
        order_id: orderId,
        amount: chargedPaise,
      }).expect(200);

      // The webhook is only recorded synchronously; the capture happens in the
      // outbox subscriber.
      await drainOutbox();

      const payment = await context.prisma.payment.findUnique({
        where: { id: started.body.payment.id },
      });

      expect(payment?.status).toBe('captured');
      // The row keeps the gross, so every downstream split is on the full price.
      expect(payment?.amountPaise).toBe(job.payablePaise);
      expect(payment?.discountPaise).toBe(discountPaise);

      const commissionBps = payment?.commissionBpsSnapshot ?? 0;
      const commissionPaise = Math.floor((job.payablePaise * commissionBps) / 10_000);
      const providerPaise = job.payablePaise - commissionPaise;

      /* 1. The technician is owed the full, pre-discount share. */
      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.payablePaise).toBe(providerPaise);

      /* 2. Only the discounted cash actually arrived, and the platform funded
            the rest — booked as its own expense. */
      const position = await ledger.platformPosition(context.prisma);
      expect(position.gatewayCashPaise).toBe(chargedPaise);
      expect(position.revenuePaise).toBe(commissionPaise);

      const discountsFunded = await context.prisma.$queryRaw<{ balance_paise: bigint }[]>`
        SELECT coalesce(sum(balance_paise), 0)::BIGINT AS balance_paise
        FROM account_balances WHERE account_type = 'marketing_discount'
      `;
      expect(Number(discountsFunded[0]?.balance_paise ?? 0)).toBe(discountPaise);

      /* 3. The journal balances — the deferred trigger would have refused the
            commit otherwise, and this states the numbers it checked. */
      const journals = await ledger.auditJournals(context.prisma);
      for (const journal of journals) {
        expect(journal.debits, `journal ${journal.journalId} must balance`).toBe(journal.credits);
      }

      const capture = journals.find((entry) => entry.journalType === 'payment_captured');
      expect(capture?.debits).toBe(job.payablePaise);
    });
  });

  describe('cash', () => {
    /**
     * The server-side half of the online-only rule.
     *
     * A customer can apply a coupon and *then* have the technician record cash.
     * The coupon has to drop off, and the technician's dues have to be computed
     * on the **full** price — otherwise the discount silently comes out of their
     * earnings, which is the exact inversion this feature forbids.
     */
    it('drops the coupon when the technician records cash, and bills the full price', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon();
      const job = await bookAndComplete();

      await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/coupon`)
        .set(auth(job.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' })
        .expect(200);

      const cash = await request(app)
        .post(`/api/v1/bookings/${job.bookingId}/payments/cash`)
        .set(auth(job.technician.accessToken))
        .send({})
        .expect(201);

      // Cash is recorded at the full, undiscounted bill.
      expect(cash.body.payment.amountPaise).toBe(job.payablePaise);

      // The redemption is gone: the customer did not use the coupon, so they
      // keep it and the campaign keeps its budget.
      const redemption = await context.prisma.couponRedemption.findUnique({
        where: { bookingId: job.bookingId },
      });
      expect(redemption).toBeNull();

      // And the technician owes commission on the full price, not a discounted
      // one — the number that would otherwise quietly cost them the discount.
      const payment = await context.prisma.payment.findFirst({
        where: { bookingId: job.bookingId, method: 'cash' },
      });
      const commissionPaise = Math.floor(
        (job.payablePaise * (payment?.commissionBpsSnapshot ?? 0)) / 10_000,
      );

      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.duesPaise).toBe(commissionPaise);
    });
  });

  describe('usage limits', () => {
    it('refuses a customer their second use of a one-per-customer coupon', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon({ perCustomerLimit: 1 });

      const first = await bookAndComplete();
      await request(app)
        .post(`/api/v1/bookings/${first.bookingId}/coupon`)
        .set(auth(first.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' })
        .expect(200);

      const second = await bookAndComplete();
      const refused = await request(app)
        .post(`/api/v1/bookings/${second.bookingId}/coupon`)
        .set(auth(second.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' });

      expect(refused.status).toBe(422);
      expect(refused.body.error?.details?.reason ?? refused.body.details?.reason).toBe(
        'per_customer_limit_reached',
      );
    });

    it('refuses everybody once the campaign budget is spent', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await seedCoupon({ totalUsageLimit: 1, perCustomerLimit: 5 });

      const first = await bookAndComplete();
      await request(app)
        .post(`/api/v1/bookings/${first.bookingId}/coupon`)
        .set(auth(first.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' })
        .expect(200);

      const second = await bookAndComplete();
      const refused = await request(app)
        .post(`/api/v1/bookings/${second.bookingId}/coupon`)
        .set(auth(second.customer.accessToken))
        .send({ code: 'PHASEC20', paymentMethod: 'online' });

      expect(refused.status).toBe(422);
      expect(refused.body.error?.details?.reason ?? refused.body.details?.reason).toBe(
        'usage_limit_reached',
      );
    });
  });

  describe('the database has the last word', () => {
    /**
     * The CHECK constraints are the third statement of the same rules, after
     * Zod and `assertValidTerms`. They matter because they hold against a write
     * that bypasses both — a migration, a script, a future repository.
     */
    it('refuses an uncapped or nonsensical coupon at the database', async () => {
      if (unavailableReason || !context || !fixture) return;

      const base = {
        description: 'constraint probe',
        discountType: 'percent' as const,
        value: 20,
        maxDiscountPaise: 20_000,
        validFrom: new Date(Date.now() - 1000),
        validUntil: new Date(Date.now() + 1000),
        createdByAdminId: fixture.adminId,
      };

      // A cap of zero is "no ceiling" by another name.
      await expect(
        context.prisma.coupon.create({
          data: { ...base, code: 'PHASECBAD1', maxDiscountPaise: 0 },
        }),
      ).rejects.toThrow();

      // 120% off is not a discount.
      await expect(
        context.prisma.coupon.create({ data: { ...base, code: 'PHASECBAD2', value: 120 } }),
      ).rejects.toThrow();

      // A window that closes before it opens.
      await expect(
        context.prisma.coupon.create({
          data: {
            ...base,
            code: 'PHASECBAD3',
            validFrom: new Date(Date.now() + 1000),
            validUntil: new Date(Date.now() - 1000),
          },
        }),
      ).rejects.toThrow();

      // A lowercase code would be invisible to the uppercase lookup path.
      await expect(
        context.prisma.coupon.create({ data: { ...base, code: 'phasecbad4' } }),
      ).rejects.toThrow();
    });
  });
});
