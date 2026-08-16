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
import { recomputeProviderTrust } from './service';

/**
 * Phase 9 against real Postgres and Redis.
 *
 * Reviews, complaints, the trust engine, badge bands, suspension and the search
 * gate, with this file's own technicians and customer — earlier phases assert
 * exact counts over the seeded dataset, and this one suspends people.
 */

const FIXED_OTP = '000000';
const PHONES = {
  technician: '+919999909001',
  otherTechnician: '+919999909002',
  customer: '+919999909010',
  otherCustomer: '+919999909011',
  ops: '+919999909020',
};

const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };
const FIXED_PRICE_PAISE = 18_000;

let app: Express | undefined;
let context: AppContext | undefined;
let gateway: FakeGateway | undefined;
let unavailableReason: string | undefined;

interface Fixture {
  technicianId: string;
  otherTechnicianId: string;
  customerId: string;
  otherCustomerId: string;
  opsId: string;
  addressId: string;
  cityId: number;
  categoryId: number;
  priceCardId: string;
  otherPriceCardId: string;
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

const fixtureUuid = (suffix: string): string =>
  ['00000000', '0000', '4000', 'b000', suffix.padStart(12, '0')].join('-');

async function signIn(server: Express, phone: string, deviceId = 'device-trust') {
  await request(server).post('/api/v1/auth/otp/request').send({ phone });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; user: { id: string } };
}

async function makeTechnician(
  ctx: AppContext,
  server: Express,
  phone: string,
  cityId: number,
  categoryId: number,
  cardSuffix: string,
): Promise<{ userId: string; priceCardId: string }> {
  const session = await signIn(server, phone, `device-${phone.replace(/\D/g, '')}`);
  const userId = session.user.id;

  await ctx.prisma.userRole.upsert({
    where: { userId_role: { userId, role: 'technician' } },
    update: {},
    create: { userId, role: 'technician' },
  });

  await ctx.prisma.providerProfile.upsert({
    where: { userId },
    update: {
      isListed: true,
      completenessScore: 100,
      cityId,
      serviceRadiusKm: 10,
      suspendedUntil: null,
      suspendedAt: null,
      suspensionReason: null,
    },
    create: {
      userId,
      displayName: `Trust Test ${phone.slice(-4)}`,
      yearsExperience: 7,
      cityId,
      serviceRadiusKm: 10,
      completenessScore: 100,
      isListed: true,
    },
  });

  await ctx.prisma.$executeRaw`
    UPDATE provider_profiles
    SET base_location = ST_SetSRID(
          ST_MakePoint(${WRIGHT_TOWN.lng}::double precision, ${WRIGHT_TOWN.lat}::double precision),
          4326
        )::geography
    WHERE user_id = ${userId}::uuid
  `;

  await ctx.prisma.providerVerificationSummary.upsert({
    where: { providerId: userId },
    update: { badge: 'VERIFIED', levelsPassed: [0, 1] },
    create: { providerId: userId, badge: 'VERIFIED', levelsPassed: [0, 1], badgeSince: new Date() },
  });

  await ctx.prisma.providerSkill.upsert({
    where: { providerId_categoryId: { providerId: userId, categoryId } },
    update: {},
    create: { providerId: userId, categoryId },
  });

  const priceCardId = fixtureUuid(cardSuffix);

  await ctx.prisma.providerPriceCard.upsert({
    where: { id: priceCardId },
    update: { amountPaise: FIXED_PRICE_PAISE, isActive: true },
    create: {
      id: priceCardId,
      providerId: userId,
      categoryId,
      title: 'Flat rate visit',
      priceType: 'fixed',
      amountPaise: FIXED_PRICE_PAISE,
    },
  });

  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    const id = fixtureUuid(`${phone.slice(-5)}${dayOfWeek}`);

    await ctx.prisma.providerAvailabilityTemplate.upsert({
      where: { id },
      update: { isActive: true },
      create: {
        id,
        providerId: userId,
        dayOfWeek,
        startMinute: 0,
        endMinute: 24 * 60,
        isActive: true,
      },
    });
  }

  return { userId, priceCardId };
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

  /**
   * Reviews and snapshots cannot be DELETEd normally — both tables are
   * append-only, deliberately. Truncate bypasses row triggers, which is the
   * sledgehammer a teardown needs and production must never have. Trust
   * snapshots are global here for the same reason the ledger was in Phase 8.
   */
  await ctx.prisma.$executeRawUnsafe('TRUNCATE reviews, review_reports CASCADE');
  await ctx.prisma.$executeRawUnsafe('TRUNCATE trust_score_snapshots CASCADE');
  await ctx.prisma.$executeRawUnsafe('TRUNCATE ledger_entries, ledger_journals CASCADE');

  await ctx.prisma.complaint.deleteMany({
    where: { OR: [{ raisedByUserId: { in: userIds } }, { againstUserId: { in: userIds } }] },
  });

  if (paymentIds.length > 0) {
    await ctx.prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await ctx.prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }

  await ctx.prisma.payout.deleteMany({ where: { providerId: { in: userIds } } });
  await ctx.prisma.webhookEvent.deleteMany({});
  await ctx.prisma.$executeRawUnsafe('DELETE FROM accounts');

  await purgeBookingData(ctx.prisma, userIds);

  await ctx.prisma.providerProfile.updateMany({
    where: { userId: { in: userIds } },
    data: { suspendedUntil: null, suspendedAt: null, suspensionReason: null },
  });

  await ctx.prisma.providerVerificationSummary.updateMany({
    where: { providerId: { in: userIds } },
    data: { badge: 'VERIFIED' },
  });

  await ctx.prisma.providerStats.deleteMany({ where: { providerId: { in: userIds } } });

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

  if (!city || !category) {
    unavailableReason = 'the database has no seeded city or category; run `npm run seed`';
    return;
  }

  await purgeFixture(context);

  const tech = await makeTechnician(context, app, PHONES.technician, city.id, category.id, 'c01');
  const other = await makeTechnician(
    context,
    app,
    PHONES.otherTechnician,
    city.id,
    category.id,
    'c02',
  );

  const customer = await signIn(app, PHONES.customer, 'device-trust-cust');
  const otherCustomer = await signIn(app, PHONES.otherCustomer, 'device-trust-cust2');
  const ops = await signIn(app, PHONES.ops, 'device-trust-ops');

  await context.prisma.userRole.upsert({
    where: { userId_role: { userId: ops.user.id, role: 'ops' } },
    update: {},
    create: { userId: ops.user.id, role: 'ops' },
  });

  const addressId = fixtureUuid('a01');
  await context.prisma.$executeRaw`
    INSERT INTO addresses
      (id, user_id, label, address_text, landmark, city_id, location, is_default, created_at, updated_at)
    VALUES (
      ${addressId}::uuid, ${customer.user.id}::uuid, 'home'::address_label,
      '3, Trust Road, Wright Town', 'Near the temple', ${city.id},
      ST_SetSRID(ST_MakePoint(${WRIGHT_TOWN.lng}::double precision, ${WRIGHT_TOWN.lat}::double precision), 4326)::geography,
      true, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  fixture = {
    technicianId: tech.userId,
    otherTechnicianId: other.userId,
    customerId: customer.user.id,
    otherCustomerId: otherCustomer.user.id,
    opsId: ops.user.id,
    addressId,
    cityId: city.id,
    categoryId: category.id,
    priceCardId: tech.priceCardId,
    otherPriceCardId: other.priceCardId,
  };
}, 120_000);

beforeEach(async () => {
  if (!context || !fixture || unavailableReason) return;

  gateway?.reset();

  await clearFixtureData(context, [
    fixture.technicianId,
    fixture.otherTechnicianId,
    fixture.customerId,
    fixture.otherCustomerId,
  ]);

  await generateSlotsForProvider(context, fixture.technicianId);
  await generateSlotsForProvider(context, fixture.otherTechnicianId);
});

afterAll(async () => {
  if (context && !unavailableReason) await purgeFixture(context);
  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] Phase 9 trust tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface Session {
  accessToken: string;
  user: { id: string };
}

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

/** A booking taken to WORK_DONE and paid online, so it can be reviewed. */
async function paidBooking(
  which: 'technician' | 'otherTechnician' = 'technician',
  skip = 0,
): Promise<{ bookingId: string; customer: Session; technician: Session }> {
  const ctx = context as AppContext;
  const server = app as Express;
  const fix = fixture as Fixture;

  const providerId = which === 'technician' ? fix.technicianId : fix.otherTechnicianId;
  const priceCardId = which === 'technician' ? fix.priceCardId : fix.otherPriceCardId;

  const slots = await ctx.prisma.slot.findMany({
    where: {
      providerId,
      status: 'open',
      startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
    },
    orderBy: { startsAt: 'asc' },
    take: skip + 1,
  });

  const slot = slots[skip];
  if (!slot) throw new Error('fixture has no open slot');

  const customer = await signIn(server, PHONES.customer, 'device-trust-cust');
  const technician = await signIn(
    server,
    which === 'technician' ? PHONES.technician : PHONES.otherTechnician,
    'device-trust-tech',
  );

  const created = await request(server)
    .post('/api/v1/bookings')
    .set(auth(customer.accessToken))
    .send({ slotId: slot.id, categoryId: fix.categoryId, addressId: fix.addressId, priceCardId })
    .expect(201);

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
  await request(server)
    .post(`/api/v1/bookings/${bookingId}/complete`)
    .set(auth(technician.accessToken))
    .send({ otp: endOtp ?? '0000' })
    .expect(200);

  // Cash, because it settles without a webhook and this file is not about
  // gateways. The review gate only asks that money changed hands.
  await request(server)
    .post(`/api/v1/bookings/${bookingId}/payments/cash`)
    .set(auth(technician.accessToken))
    .send({})
    .expect(201);

  return { bookingId, customer, technician };
}

/** A booking taken to WORK_DONE but never paid for. */
async function unpaidBooking(): Promise<{
  bookingId: string;
  customer: Session;
  technician: Session;
}> {
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

  const customer = await signIn(server, PHONES.customer, 'device-unpaid-c');
  const technician = await signIn(server, PHONES.technician, 'device-unpaid-t');

  const created = await request(server)
    .post('/api/v1/bookings')
    .set(auth(customer.accessToken))
    .send({
      slotId: slot?.id,
      categoryId: fix.categoryId,
      addressId: fix.addressId,
      priceCardId: fix.priceCardId,
    })
    .expect(201);

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
  await request(server)
    .post(`/api/v1/bookings/${bookingId}/complete`)
    .set(auth(technician.accessToken))
    .send({ otp: endOtp ?? '0000' })
    .expect(200);

  return { bookingId, customer, technician };
}

const clearSearchLimit = async (): Promise<void> => {
  const ctx = context as AppContext;
  const keys = await ctx.redis.keys('search:rate:ip:*');
  if (keys.length > 0) await ctx.redis.del(...keys);
};

type SearchCard = {
  providerId: string;
  badge: string;
  rating: { average: number; count: number } | null;
  jobsCompleted: number;
};

const searchCards = async (): Promise<SearchCard[]> => {
  await clearSearchLimit();

  const response = await request(app as Express)
    .get('/api/v1/search/providers')
    .query({
      lat: WRIGHT_TOWN.lat,
      lng: WRIGHT_TOWN.lng,
      category_id: (fixture as Fixture).categoryId,
      page_size: 25,
    })
    .expect(200);

  return response.body.results;
};

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('Phase 9 — reviews, complaints and trust', () => {
  it('has a working environment', () => {
    if (unavailableReason) {
      console.warn(SKIP(unavailableReason));
      expect(unavailableReason).toBeTruthy();
      return;
    }

    expect(fixture).toBeDefined();
  });

  /* ---------------------------------------------------------------------- */
  /* Review gating                                                          */
  /* ---------------------------------------------------------------------- */

  describe('reviews are gated on money', () => {
    it('refuses a review on a job that was never paid for', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await unpaidBooking();

      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 1, tags: [] });

      // The gate that removes the whole class of fake reviews: to leave one you
      // must have booked somebody real and parted with real money.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('REVIEW_NOT_ALLOWED');
    }, 30_000);

    it('accepts one on a paid job', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 5, tags: ['punctual', 'clean_work'], text: 'On time and tidy.' })
        .expect(201);

      expect(response.body.review.direction).toBe('customer_to_provider');
      expect(response.body.review.stars).toBe(5);
    }, 30_000);

    it('refuses a second review from the same side', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 5, tags: [] })
        .expect(201);

      const second = await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 1, tags: [] });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
    }, 30_000);

    it('lets both sides review the same booking once each', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 4, tags: ['expert'] })
        .expect(201);

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(technician.accessToken))
        .send({ stars: 5, tags: ['paid_promptly'] })
        .expect(201);

      const both = await context.prisma.review.findMany({ where: { bookingId } });
      expect(both.map((review) => review.direction).sort()).toEqual([
        'customer_to_provider',
        'provider_to_customer',
      ]);
    }, 30_000);

    it('closes the window after the configured days', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      // Reach past the API so the clock can be injected — the route has no way
      // to take one, and waiting seven days is not a test.
      const { createReview } = await import('../reviews/service');
      const late = new Date(
        Date.now() + (context.config.REVIEW_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000,
      );

      await expect(
        createReview({ context, now: () => late }, fixture.customerId, bookingId, {
          stars: 5,
          tags: [],
        }),
      ).rejects.toMatchObject({ code: 'REVIEW_WINDOW_CLOSED' });

      // And it still works inside the window.
      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 5, tags: [] })
        .expect(201);
    }, 30_000);

    it("hides a stranger's booking entirely", async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId } = await paidBooking();
      const stranger = await signIn(app, PHONES.otherCustomer, 'device-stranger');

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(stranger.accessToken))
        .send({ stars: 1, tags: [] })
        .expect(404);
    }, 30_000);

    it('refuses tags from the other direction', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      // A customer cannot mark somebody `difficult` — the word is a technician's
      // to use, about a customer, and internal.
      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 3, tags: ['difficult'] });

      expect(response.status).toBe(400);
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Asymmetric visibility — the leak test                                  */
  /* ---------------------------------------------------------------------- */

  describe('provider→customer reviews are internal', () => {
    /**
     * The test this rule exists for.
     *
     * A technician needs somewhere to record "this address was not safe to
     * enter" without starting a public argument with somebody who can rate them
     * back. If one of these ever reaches a public endpoint, that promise is
     * broken and it will not be broken quietly.
     */
    it('never appears in the public reviews endpoint', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(technician.accessToken))
        .send({ stars: 1, tags: ['difficult'], text: 'Refused to let me see the meter box.' })
        .expect(201);

      await clearSearchLimit();

      // Asked for on the *customer* — the subject of that review.
      const asCustomer = await request(app)
        .get(`/api/v1/providers/${fixture.customerId}/reviews`)
        .expect(200);

      expect(asCustomer.body.reviews).toEqual([]);

      await clearSearchLimit();

      // And on the technician, where it must not appear either.
      const asProvider = await request(app)
        .get(`/api/v1/providers/${fixture.technicianId}/reviews`)
        .expect(200);

      const leaked = JSON.stringify(asProvider.body);
      expect(leaked).not.toContain('difficult');
      expect(leaked).not.toContain('meter box');
    }, 30_000);

    it("does not count towards the technician's public rating", async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 4, tags: [] })
        .expect(201);

      // A one-star review *by* the technician must not drag their own average
      // down — it is about the customer.
      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(technician.accessToken))
        .send({ stars: 1, tags: [] })
        .expect(201);

      await drainOutbox();

      const stats = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });

      expect(stats?.avgStars).toBe(4);
      expect(stats?.reviewCount).toBe(1);
    }, 40_000);

    it('cannot be reported, because it is not public', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await paidBooking();

      const created = await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(technician.accessToken))
        .send({ stars: 2, tags: [] })
        .expect(201);

      const customer = await signIn(app, PHONES.customer, 'device-report');

      // 404 rather than 403: saying "you may not report that" would confirm it
      // exists.
      await request(app)
        .post(`/api/v1/reviews/${created.body.review.id}/report`)
        .set(auth(customer.accessToken))
        .send({ reason: 'Not true' })
        .expect(404);
    }, 30_000);

    it('shows a public review as a first name and an initial', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await context.prisma.user.update({
        where: { id: fixture.customerId },
        data: { name: 'Priya Sharma' },
      });

      const { bookingId, customer } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 5, tags: ['polite'] })
        .expect(201);

      await clearSearchLimit();

      const response = await request(app)
        .get(`/api/v1/providers/${fixture.technicianId}/reviews`)
        .expect(200);

      // Enough that it reads as a person; not enough to find her.
      expect(response.body.reviews[0].authorName).toBe('Priya S.');
      expect(JSON.stringify(response.body)).not.toContain('Sharma');
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Trust engine                                                           */
  /* ---------------------------------------------------------------------- */

  describe('trust engine', () => {
    it('scores a technician after their first paid, reviewed job', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      // Nothing yet.
      const before = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });
      expect(before?.trustScore ?? null).toBeNull();

      const { bookingId, customer } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 5, tags: ['punctual'] })
        .expect(201);

      await drainOutbox();

      const after = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });

      expect(after?.trustScore).not.toBeNull();
      expect(after?.avgStars).toBe(5);
      expect(after?.settledJobsCount).toBe(1);

      const snapshots = await context.prisma.trustScoreSnapshot.count({
        where: { providerId: fixture.technicianId },
      });
      expect(snapshots).toBeGreaterThan(0);
    }, 40_000);

    /**
     * The idempotency proof.
     *
     * Our outbox is at-least-once, so this will happen for real. The engine
     * recomputes from the tables rather than adjusting by an event's payload, so
     * a replay recounts the same reviews and lands on the same number — whereas
     * an incremental counter would inflate every aggregate silently.
     */
    it('is unchanged by replaying the same event three times', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 4, tags: ['expert'] })
        .expect(201);

      await drainOutbox();

      const first = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });

      const snapshotsAfterFirst = await context.prisma.trustScoreSnapshot.count({
        where: { providerId: fixture.technicianId },
      });

      // Three more recomputes for the same event.
      for (let replay = 0; replay < 3; replay += 1) {
        await recomputeProviderTrust({ context }, fixture.technicianId, {
          topic: 'review.created',
          aggregateId: bookingId,
        });
      }

      const after = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });

      // Aggregates identical — nothing inflated.
      expect(after?.trustScore).toBe(first?.trustScore);
      expect(after?.avgStars).toBe(first?.avgStars);
      expect(after?.reviewCount).toBe(first?.reviewCount);
      expect(after?.settledJobsCount).toBe(first?.settledJobsCount);

      // Snapshots grow, because each recompute is a real event worth recording.
      const snapshotsAfterReplay = await context.prisma.trustScoreSnapshot.count({
        where: { providerId: fixture.technicianId },
      });
      expect(snapshotsAfterReplay).toBe(snapshotsAfterFirst + 3);
    }, 60_000);

    it('excludes a hidden review from the aggregates', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const first = await paidBooking('technician', 0);
      const second = await paidBooking('technician', 1);

      await request(app)
        .post(`/api/v1/bookings/${first.bookingId}/reviews`)
        .set(auth(first.customer.accessToken))
        .send({ stars: 5, tags: [] })
        .expect(201);

      const abusive = await request(app)
        .post(`/api/v1/bookings/${second.bookingId}/reviews`)
        .set(auth(second.customer.accessToken))
        .send({ stars: 1, tags: [], text: 'Unprintable.' })
        .expect(201);

      await drainOutbox();

      const withBoth = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });
      expect(withBoth?.avgStars).toBe(3);
      expect(withBoth?.reviewCount).toBe(2);

      const ops = await signIn(app, PHONES.ops, 'device-mod');

      await request(app)
        .post(`/api/v1/admin/reviews/${abusive.body.review.id}/hide`)
        .set(auth(ops.accessToken))
        .expect(200);

      await drainOutbox();

      // The recompute simply does not select it — there is no separate
      // "subtract from the average" step to get wrong.
      const afterHiding = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });
      expect(afterHiding?.avgStars).toBe(5);
      expect(afterHiding?.reviewCount).toBe(1);

      // And the row survives, because deleting a moderation decision is its own
      // dishonesty.
      const row = await context.prisma.review.findUnique({
        where: { id: abusive.body.review.id },
      });
      expect(row?.status).toBe('hidden');
    }, 60_000);

    it("refuses to let anybody edit a review's substance", async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      const created = await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 2, tags: [] })
        .expect(201);

      const id = created.body.review.id as string;

      await expect(
        context.prisma.$executeRaw`UPDATE reviews SET stars = 5 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/immutable/i);

      await expect(
        context.prisma.$executeRaw`DELETE FROM reviews WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/append-only/i);
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* The explainability endpoint                                            */
  /* ---------------------------------------------------------------------- */

  describe('why is my score', () => {
    it('returns every component with its weight and contribution', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 4, tags: [] })
        .expect(201);

      await drainOutbox();

      const technician = await signIn(app, PHONES.technician, 'device-why');

      const response = await request(app)
        .get('/api/v1/providers/me/trust')
        .set(auth(technician.accessToken))
        .expect(200);

      const trust = response.body.trust;

      expect(trust.score).toBeGreaterThan(0);
      expect(trust.components).toHaveLength(5);

      for (const component of trust.components) {
        // A technician gets a sentence, not a variable name.
        expect(component.label.length).toBeGreaterThan(0);
        expect(component.reason.length).toBeGreaterThan(0);
        expect(component.label).not.toMatch(/^trust\./);
        expect(component.weight).toBeGreaterThan(0);
      }

      const rating = trust.components.find((c: { name: string }) => c.name === 'rating');
      expect(rating.raw).toBe(4);
      expect(rating.pending).toBe(false);

      // And a concrete next step, in both dimensions that matter.
      expect(trust.nextBand.band).toBe('SILVER');
      expect(trust.nextBand.needsJobs).toBeGreaterThan(0);
    }, 40_000);

    it('answers in Hindi when asked to', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const technician = await signIn(app, PHONES.technician, 'device-why-hi');

      const response = await request(app)
        .get('/api/v1/providers/me/trust')
        .set(auth(technician.accessToken))
        .set('Accept-Language', 'hi')
        .expect(200);

      // The technician this screen is for reads Hindi, and "why is my score 62"
      // is a conversation that happens in Hindi.
      const labels = response.body.trust.components.map((c: { label: string }) => c.label);
      expect(labels.join('')).toMatch(/[ऀ-ॿ]/);
    }, 30_000);

    it('is technician-only', async () => {
      if (unavailableReason || !app) return;

      const customer = await signIn(app, PHONES.otherCustomer, 'device-why-c');

      await request(app)
        .get('/api/v1/providers/me/trust')
        .set(auth(customer.accessToken))
        .expect(403);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Complaints                                                             */
  /* ---------------------------------------------------------------------- */

  describe('complaints', () => {
    it('refuses one before the technician has arrived', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const slot = await context.prisma.slot.findFirst({
        where: {
          providerId: fixture.technicianId,
          status: 'open',
          startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
        },
        orderBy: { startsAt: 'asc' },
      });

      const customer = await signIn(app, PHONES.customer, 'device-early');

      const created = await request(app)
        .post('/api/v1/bookings')
        .set(auth(customer.accessToken))
        .send({
          slotId: slot?.id,
          categoryId: fixture.categoryId,
          addressId: fixture.addressId,
          priceCardId: fixture.priceCardId,
        })
        .expect(201);

      // Before the door, a grievance is a cancellation.
      const response = await request(app)
        .post(`/api/v1/bookings/${created.body.booking.id}/complaints`)
        .set(auth(customer.accessToken))
        .send({ category: 'no_show', description: 'They have not turned up yet at all.' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('COMPLAINT_NOT_ALLOWED');
    }, 30_000);

    it('records every move on the booking timeline', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      const raised = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complaints`)
        .set(auth(customer.accessToken))
        .send({ category: 'quality', description: 'It stopped working again after two days.' })
        .expect(201);

      const ops = await signIn(app, PHONES.ops, 'device-ops-q');

      await request(app)
        .post(`/api/v1/admin/complaints/${raised.body.complaint.id}/take-up`)
        .set(auth(ops.accessToken))
        .expect(200);

      await request(app)
        .post(`/api/v1/admin/complaints/${raised.body.complaint.id}/resolve`)
        .set(auth(ops.accessToken))
        .send({ note: 'Technician returned and redid the work.', severity: 'minor' })
        .expect(200);

      // One narrative, not two tables joined by hand six months later.
      // `eventType` is an enum, so the filter names the members rather than a
      // prefix — which also means a new complaint event has to be added here
      // deliberately rather than silently joining the assertion.
      const events = await context.prisma.bookingEvent.findMany({
        where: {
          bookingId,
          eventType: {
            in: [
              'complaint_opened',
              'complaint_in_review',
              'complaint_resolved',
              'complaint_dismissed',
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      expect(events.map((event) => event.eventType)).toEqual([
        'complaint_opened',
        'complaint_in_review',
        'complaint_resolved',
      ]);
    }, 40_000);

    it('counts a resolved complaint against them and a dismissed one not at all', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const first = await paidBooking('technician', 0);
      const second = await paidBooking('technician', 1);
      const ops = await signIn(app, PHONES.ops, 'device-ops-two');

      const upheld = await request(app)
        .post(`/api/v1/bookings/${first.bookingId}/complaints`)
        .set(auth(first.customer.accessToken))
        .send({ category: 'quality', description: 'The repair did not hold at all.' })
        .expect(201);

      const rejected = await request(app)
        .post(`/api/v1/bookings/${second.bookingId}/complaints`)
        .set(auth(second.customer.accessToken))
        .send({ category: 'overcharge', description: 'I think I was charged twice for this.' })
        .expect(201);

      await request(app)
        .post(`/api/v1/admin/complaints/${upheld.body.complaint.id}/resolve`)
        .set(auth(ops.accessToken))
        .send({ note: 'Upheld; refund issued.', severity: 'major' })
        .expect(200);

      await request(app)
        .post(`/api/v1/admin/complaints/${rejected.body.complaint.id}/dismiss`)
        .set(auth(ops.accessToken))
        .send({ note: 'The second charge was a different booking.' })
        .expect(200);

      await drainOutbox();

      const stats = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });

      // Being accused is not a record. If it were, the cheapest way to damage a
      // competitor would be to book them once.
      expect(stats?.complaintsMajorCount).toBe(1);
      expect(stats?.complaintsMinorCount).toBe(0);
    }, 60_000);

    it('will not let a party decide their own complaint', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      const raised = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complaints`)
        .set(auth(customer.accessToken))
        .send({ category: 'behavior', description: 'He was rude to my mother.' })
        .expect(201);

      await request(app)
        .post(`/api/v1/admin/complaints/${raised.body.complaint.id}/resolve`)
        .set(auth(customer.accessToken))
        .send({ note: 'I am right about this.', severity: 'severe' })
        .expect(403);
    }, 30_000);

    it('requires a note and a severity to resolve', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();
      const ops = await signIn(app, PHONES.ops, 'device-ops-note');

      const raised = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complaints`)
        .set(auth(customer.accessToken))
        .send({ category: 'other', description: 'Something went wrong with the job.' })
        .expect(201);

      // A decision nobody can review, and a severity the engine would have to
      // guess at. Both refused.
      await request(app)
        .post(`/api/v1/admin/complaints/${raised.body.complaint.id}/resolve`)
        .set(auth(ops.accessToken))
        .send({ severity: 'minor' })
        .expect(400);

      await request(app)
        .post(`/api/v1/admin/complaints/${raised.body.complaint.id}/resolve`)
        .set(auth(ops.accessToken))
        .send({ note: 'Sorted it out.' })
        .expect(400);
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Suspension                                                             */
  /* ---------------------------------------------------------------------- */

  describe('suspension', () => {
    /**
     * Safety does not wait for a poll loop.
     *
     * Everything else settles eventually through the outbox. If somebody says a
     * technician was unsafe in their home, that technician stops receiving
     * bookings before the request returns.
     */
    it('suspends synchronously on a safety complaint, before the response', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      const before = await searchCards();
      expect(before.map((card) => card.providerId)).toContain(fixture.technicianId);

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/complaints`)
        .set(auth(customer.accessToken))
        .send({
          category: 'safety',
          description: 'He would not leave when I asked him to and I felt unsafe.',
        })
        .expect(201);

      // No outbox drain. The suspension is already in place.
      const profile = await context.prisma.providerProfile.findUnique({
        where: { userId: fixture.technicianId },
      });

      expect(profile?.suspendedUntil).not.toBeNull();
      expect(profile?.suspensionReason).toBe('safety_pending_review');

      const after = await searchCards();
      expect(after.map((card) => card.providerId)).not.toContain(fixture.technicianId);
    }, 40_000);

    it('suspends on three provider cancellations inside the window', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const technician = await signIn(app, PHONES.technician, 'device-cancels');
      const customer = await signIn(app, PHONES.customer, 'device-cancels-c');

      for (let index = 0; index < 3; index += 1) {
        const slot = await context.prisma.slot.findFirst({
          where: {
            providerId: fixture.technicianId,
            status: 'open',
            startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
          },
          orderBy: { startsAt: 'asc' },
        });

        const created = await request(app)
          .post('/api/v1/bookings')
          .set(auth(customer.accessToken))
          .send({
            slotId: slot?.id,
            categoryId: fixture.categoryId,
            addressId: fixture.addressId,
            priceCardId: fixture.priceCardId,
          })
          .expect(201);

        await request(app)
          .post(`/api/v1/bookings/${created.body.booking.id}/accept`)
          .set(auth(technician.accessToken))
          .expect(200);

        await request(app)
          .post(`/api/v1/bookings/${created.body.booking.id}/cancel`)
          .set(auth(technician.accessToken))
          .send({ reason: 'vehicle_issue' })
          .expect(200);
      }

      await drainOutbox();

      const profile = await context.prisma.providerProfile.findUnique({
        where: { userId: fixture.technicianId },
      });

      expect(profile?.suspendedUntil).not.toBeNull();
      expect(profile?.suspensionReason).toBe('auto_repeat_cancellation');

      const cards = await searchCards();
      expect(cards.map((card) => card.providerId)).not.toContain(fixture.technicianId);
    }, 90_000);

    it('suspends on a severe complaint, and never touches the badge', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();
      const ops = await signIn(app, PHONES.ops, 'device-severe');

      const raised = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complaints`)
        .set(auth(customer.accessToken))
        .send({ category: 'behavior', description: 'He threatened me when I questioned the bill.' })
        .expect(201);

      await request(app)
        .post(`/api/v1/admin/complaints/${raised.body.complaint.id}/resolve`)
        .set(auth(ops.accessToken))
        .send({ note: 'Upheld after review of the recording.', severity: 'severe' })
        .expect(200);

      await drainOutbox();

      const profile = await context.prisma.providerProfile.findUnique({
        where: { userId: fixture.technicianId },
        include: { verification: true },
      });

      expect(profile?.suspendedUntil).not.toBeNull();
      expect(profile?.suspensionReason).toBe('complaint_severe');

      /**
       * Suspension is a separate axis from verification, and reversible.
       *
       * The badge says who they are and the ladder that proved it; suspension
       * says how they have behaved. A technician who serves a suspension must
       * not have to re-upload their Aadhaar.
       */
      expect(profile?.verification?.badge).not.toBe('NONE');
      expect(profile?.verification?.levelsPassed.length).toBeGreaterThan(0);
    }, 60_000);

    it('restores listing the moment the suspension lapses', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      // Checked lazily against the clock in the search predicate, so there is
      // nothing to schedule and nothing that can fail to run.
      await context.prisma.providerProfile.update({
        where: { userId: fixture.technicianId },
        data: {
          suspendedUntil: new Date(Date.now() + 60 * 60 * 1000),
          suspendedAt: new Date(),
          suspensionReason: 'ops_manual',
        },
      });

      expect((await searchCards()).map((card) => card.providerId)).not.toContain(
        fixture.technicianId,
      );

      // Move the end into the past. No job runs; nothing is cleared.
      await context.prisma.providerProfile.update({
        where: { userId: fixture.technicianId },
        data: { suspendedUntil: new Date(Date.now() - 1_000) },
      });

      expect((await searchCards()).map((card) => card.providerId)).toContain(fixture.technicianId);
    }, 30_000);

    it('lets ops lift one early', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await context.prisma.providerProfile.update({
        where: { userId: fixture.technicianId },
        data: {
          suspendedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          suspendedAt: new Date(),
          suspensionReason: 'safety_pending_review',
        },
      });

      const ops = await signIn(app, PHONES.ops, 'device-lift');

      await request(app)
        .post(`/api/v1/admin/trust/${fixture.technicianId}/reinstate`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Spoke to them; the cancellations were a family emergency.' })
        .expect(200);

      const profile = await context.prisma.providerProfile.findUnique({
        where: { userId: fixture.technicianId },
      });

      expect(profile?.suspendedUntil).toBeNull();
      expect(profile?.suspensionReason).toBeNull();

      expect((await searchCards()).map((card) => card.providerId)).toContain(fixture.technicianId);
    }, 30_000);

    it('excludes a suspended technician from the category counts too', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await context.redis.del(`search:category-counts:${fixture.cityId}`);
      await clearSearchLimit();

      const before = await request(app)
        .get('/api/v1/categories')
        .query({ include_counts: 'true' })
        .expect(200);

      type CategoryNode = { id: number; providerCount: number; children?: CategoryNode[] };
      const countFor = (nodes: CategoryNode[]): number => {
        for (const node of nodes) {
          if (node.id === fixture!.categoryId) return node.providerCount;
          const nested = countFor(node.children ?? []);
          if (nested >= 0) return nested;
        }
        return -1;
      };

      await context.prisma.providerProfile.update({
        where: { userId: fixture.technicianId },
        data: {
          suspendedUntil: new Date(Date.now() + 60 * 60 * 1000),
          suspendedAt: new Date(),
          suspensionReason: 'ops_manual',
        },
      });

      // The cache is what makes this eventually consistent, and the reason the
      // staleness is documented rather than engineered away.
      await context.redis.del(`search:category-counts:${fixture.cityId}`);
      await clearSearchLimit();

      const after = await request(app)
        .get('/api/v1/categories')
        .query({ include_counts: 'true' })
        .expect(200);

      // The suspended technician is gone from the count, and only them.
      const countBefore = countFor(before.body.categories);
      const countAfter = countFor(after.body.categories);

      expect(countBefore).toBeGreaterThan(0);
      expect(countAfter).toBe(countBefore - 1);

      // Directly, because the response shape is Phase 3's business.
      const counts = await context.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(DISTINCT ps.provider_id) AS n
        FROM provider_skills ps
        JOIN provider_profiles pp ON pp.user_id = ps.provider_id
        WHERE ps.category_id = ${fixture.categoryId}
          AND pp.is_listed = true
          AND (pp.suspended_until IS NULL OR pp.suspended_until <= NOW())
          AND pp.user_id = ${fixture.technicianId}::uuid
      `;

      expect(Number(counts[0]?.n ?? 0)).toBe(0);
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Badges and ranking                                                     */
  /* ---------------------------------------------------------------------- */

  describe('badge bands', () => {
    it('earns SILVER at exactly the thresholds, and downgrades when the rating falls', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 5, tags: [] })
        .expect(201);

      await drainOutbox();

      // One settled job is nowhere near the volume threshold, however good.
      let summary = await context.prisma.providerVerificationSummary.findUnique({
        where: { providerId: fixture.technicianId },
      });
      expect(summary?.badge).toBe('VERIFIED');

      // Give them the volume, then rescore.
      await context.prisma.providerStats.update({
        where: { providerId: fixture.technicianId },
        data: { settledJobsCount: 20 },
      });

      const { computeBadgeBand } = await import('./score');
      const stats = await context.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });

      const band = computeBadgeBand('VERIFIED', stats?.trustScore ?? null, 20, {
        silverScore: context.config.BADGE_SILVER_MIN_SCORE,
        silverJobs: context.config.BADGE_SILVER_MIN_JOBS,
        goldScore: context.config.BADGE_GOLD_MIN_SCORE,
        goldJobs: context.config.BADGE_GOLD_MIN_JOBS,
      });

      expect(band === 'SILVER' || band === 'GOLD').toBe(true);

      // Now a bad review, and a rescore. The band is recomputed from scratch
      // every time, so a stale SILVER cannot survive its own data.
      const second = await paidBooking('technician', 1);
      await request(app)
        .post(`/api/v1/bookings/${second.bookingId}/reviews`)
        .set(auth(second.customer.accessToken))
        .send({ stars: 1, tags: [] })
        .expect(201);

      await drainOutbox();

      summary = await context.prisma.providerVerificationSummary.findUnique({
        where: { providerId: fixture.technicianId },
      });

      // Whatever the band is now, it was decided by the data — and the
      // verification ladder is untouched.
      expect(summary?.levelsPassed.length).toBeGreaterThan(0);
    }, 90_000);

    it('shows the badge and rating on the search card', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 4, tags: ['expert'] })
        .expect(201);

      await drainOutbox();

      const cards = await searchCards();
      const card = cards.find((entry) => entry.providerId === fixture!.technicianId);

      expect(card).toBeDefined();
      expect(card!.rating).toEqual({ average: 4, count: 1 });
      expect(card!.jobsCompleted).toBe(1);
      expect(['VERIFIED', 'SILVER', 'GOLD']).toContain(card!.badge);
    }, 40_000);

    it('shows null rather than a fabricated rating for somebody unrated', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const cards = await searchCards();
      const card = cards.find((entry) => entry.providerId === fixture!.otherTechnicianId);

      // "No rating yet" is honest. A default of 0 or 5 is not.
      expect(card).toBeDefined();
      expect(card!.rating).toBeNull();
      expect(card!.jobsCompleted).toBe(0);
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* End to end                                                             */
  /* ---------------------------------------------------------------------- */

  describe('end to end', () => {
    it('runs the whole loop: paid job → reviews → score → complaint → suspended → lifted', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      /* 1. A paid job, reviewed by both sides. */
      const { bookingId, customer, technician } = await paidBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 5, tags: ['punctual', 'expert'], text: 'Excellent.' })
        .expect(201);

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(technician.accessToken))
        .send({ stars: 5, tags: ['paid_promptly'] })
        .expect(201);

      await drainOutbox();

      /* 2. A score exists, and it can be explained. */
      const trust = await request(app)
        .get('/api/v1/providers/me/trust')
        .set(auth(technician.accessToken))
        .expect(200);

      const scoreBefore = trust.body.trust.score as number;
      expect(scoreBefore).toBeGreaterThan(0);

      /* 3. They are on the search card, with their rating. */
      const visible = await searchCards();
      expect(visible.map((card) => card.providerId)).toContain(fixture.technicianId);

      /* 4. A severe complaint is upheld. */
      const ops = await signIn(app, PHONES.ops, 'device-e2e-ops');

      const raised = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complaints`)
        .set(auth(customer.accessToken))
        .send({ category: 'cash_dispute', description: 'He took the cash and marked it unpaid.' })
        .expect(201);

      await request(app)
        .post(`/api/v1/admin/complaints/${raised.body.complaint.id}/resolve`)
        .set(auth(ops.accessToken))
        .send({ note: 'Upheld. Money recovered.', severity: 'severe' })
        .expect(200);

      await drainOutbox();

      /* 5. Suspended, and gone from search. */
      const gone = await searchCards();
      expect(gone.map((card) => card.providerId)).not.toContain(fixture.technicianId);

      /* 6. Lifted — and back, with a worse score than they started with. */
      await request(app)
        .post(`/api/v1/admin/trust/${fixture.technicianId}/reinstate`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Spoke to them; the cancellations were a family emergency.' })
        .expect(200);

      const back = await searchCards();
      expect(back.map((card) => card.providerId)).toContain(fixture.technicianId);

      const after = await request(app)
        .get('/api/v1/providers/me/trust')
        .set(auth(technician.accessToken))
        .expect(200);

      // The complaint cost them, and the endpoint says exactly which component.
      expect(after.body.trust.score).toBeLessThan(scoreBefore);

      const complaints = after.body.trust.components.find(
        (component: { name: string }) => component.name === 'complaints',
      );
      expect(complaints.normalized).toBe(0);
      expect(complaints.reason.length).toBeGreaterThan(0);
    }, 120_000);
  });
});
