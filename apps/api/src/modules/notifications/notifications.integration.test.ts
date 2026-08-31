import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { registerOutboxSubscribers } from '../../core/background';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { createOutboxDispatcher, type DeliveredEvent } from '../../core/outbox';
import { purgeBookingData } from '../bookings/repository';
import { generateSlotsForProvider } from '../bookings/slots-service';
import { unregisterRoute } from './routing';
import {
  handleNotificationEvent,
  registerNotificationRoute,
  releaseHeldDeliveries,
} from './service';
import { asFakeTransport, type FakeTransport, type SentMessage } from './transports';

/**
 * Phase 10 against real Postgres and Redis.
 *
 * This file has its own technicians and customer, on their own phone prefix, for
 * the reason every phase since 8 has: earlier suites assert exact counts over the
 * seeded dataset, and this one suspends people and floods inboxes.
 */

const FIXED_OTP = '000000';
const PHONES = {
  technician: '+919999910001',
  otherTechnician: '+919999910002',
  customer: '+919999910010',
  englishCustomer: '+919999910011',
  ops: '+919999910020',
};

const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };
const FIXED_PRICE_PAISE = 22_000;

let app: Express | undefined;
let context: AppContext | undefined;
let whatsapp: FakeTransport | undefined;
let sms: FakeTransport | undefined;
let unavailableReason: string | undefined;

interface Fixture {
  technicianId: string;
  otherTechnicianId: string;
  customerId: string;
  englishCustomerId: string;
  opsId: string;
  addressId: string;
  englishAddressId: string;
  cityId: number;
  categoryId: number;
  priceCardId: string;
  otherPriceCardId: string;
}

let fixture: Fixture | undefined;

/**
 * Every message the whole suite produced, for the redaction sweep at the end.
 *
 * Kept separately from the transports' own arrays because those are reset
 * between tests — and the point of the sweep is that *nothing* this file ever
 * sent contained a phone number, not merely the last test's output.
 */
const allSent: SentMessage[] = [];

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
  ['00000000', '0000', '4000', '9e00', suffix.padStart(12, '0')].join('-');

/** IST is UTC+05:30, fixed all year. Written out so the tests read as wall clock. */
const ist = (day: number, hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 7, day, hour, minute - 330));

async function signIn(server: Express, phone: string, deviceId = 'device-notif') {
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
      displayName: `Notify Test ${phone.slice(-4)}`,
      yearsExperience: 6,
      cityId,
      serviceRadiusKm: 10,
      completenessScore: 100,
      isListed: true,
    },
  });

  await ctx.prisma.providerProfile.update({
    where: { userId },
    data: { baseLat: WRIGHT_TOWN.lat, baseLng: WRIGHT_TOWN.lng },
  });

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

  // Deliveries cascade from notifications, and notifications from users — but
  // this runs between tests, when the users must survive.
  await ctx.prisma.notification.deleteMany({ where: { userId: { in: userIds } } });

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
  await ctx.prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: { preferredLanguage: 'hi' },
  });

  await ctx.prisma.outboxEvent.deleteMany({
    where: { OR: [{ aggregateId: { in: bookingIds } }, { aggregateId: { in: userIds } }] },
  });

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
  whatsapp = asFakeTransport(context.messaging.whatsapp);
  sms = asFakeTransport(context.messaging.sms);
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

  const tech = await makeTechnician(context, app, PHONES.technician, city.id, category.id, 'd01');
  const other = await makeTechnician(
    context,
    app,
    PHONES.otherTechnician,
    city.id,
    category.id,
    'd02',
  );

  const customer = await signIn(app, PHONES.customer, 'device-notif-cust');
  const english = await signIn(app, PHONES.englishCustomer, 'device-notif-en');
  const ops = await signIn(app, PHONES.ops, 'device-notif-ops');

  await context.prisma.userRole.upsert({
    where: { userId_role: { userId: ops.user.id, role: 'ops' } },
    update: {},
    create: { userId: ops.user.id, role: 'ops' },
  });

  const addressId = fixtureUuid('e01');
  await context.prisma.address.upsert({
    where: { id: addressId },
    update: {},
    create: {
      id: addressId,
      userId: customer.user.id,
      label: 'home',
      addressText: '9, Notify Road, Wright Town',
      landmark: 'Near the water tank',
      cityId: city.id,
      lat: WRIGHT_TOWN.lat,
      lng: WRIGHT_TOWN.lng,
      isDefault: true,
    },
  });

  /** The English reader needs their own address — an address is not shareable. */
  const englishAddressId = fixtureUuid('e02');
  await context.prisma.address.upsert({
    where: { id: englishAddressId },
    update: {},
    create: {
      id: englishAddressId,
      userId: english.user.id,
      label: 'home',
      addressText: '11, Notify Road, Wright Town',
      landmark: 'Opposite the school',
      cityId: city.id,
      lat: WRIGHT_TOWN.lat,
      lng: WRIGHT_TOWN.lng,
      isDefault: true,
    },
  });

  fixture = {
    englishAddressId,
    technicianId: tech.userId,
    otherTechnicianId: other.userId,
    customerId: customer.user.id,
    englishCustomerId: english.user.id,
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

  whatsapp?.reset();
  sms?.reset();

  await clearFixtureData(context, [
    fixture.technicianId,
    fixture.otherTechnicianId,
    fixture.customerId,
    fixture.englishCustomerId,
  ]);

  await generateSlotsForProvider(context, fixture.technicianId);
  await generateSlotsForProvider(context, fixture.otherTechnicianId);
});

/** Everything sent, accumulated before the per-test reset wipes it. */
afterEach(() => {
  allSent.push(...(whatsapp?.sent ?? []), ...(sms?.sent ?? []));
});

afterAll(async () => {
  if (context && !unavailableReason) await purgeFixture(context);
  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] Phase 10 notification tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

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

  for (let pass = 0; pass < 25; pass += 1) {
    const result = await dispatcher.runOnce();
    if (result.claimed === 0) return;
  }
}

async function openSlot(providerId: string, skip = 0) {
  const ctx = context as AppContext;

  const slots = await ctx.prisma.slot.findMany({
    where: { providerId, status: 'open', startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) } },
    orderBy: { startsAt: 'asc' },
    take: skip + 1,
  });

  const slot = slots[skip];
  if (!slot) throw new Error('fixture has no open slot');

  return slot;
}

async function bookIt(
  which: 'technician' | 'otherTechnician' = 'technician',
  skip = 0,
): Promise<{ bookingId: string; customer: Session; technician: Session }> {
  const server = app as Express;
  const fix = fixture as Fixture;

  const providerId = which === 'technician' ? fix.technicianId : fix.otherTechnicianId;
  const priceCardId = which === 'technician' ? fix.priceCardId : fix.otherPriceCardId;
  const slot = await openSlot(providerId, skip);

  const customer = await signIn(server, PHONES.customer, 'device-notif-cust');
  const technician = await signIn(
    server,
    which === 'technician' ? PHONES.technician : PHONES.otherTechnician,
    'device-notif-tech',
  );

  const created = await request(server)
    .post('/api/v1/bookings')
    .set(auth(customer.accessToken))
    .send({ slotId: slot.id, categoryId: fix.categoryId, addressId: fix.addressId, priceCardId })
    .expect(201);

  return { bookingId: created.body.booking.id as string, customer, technician };
}

async function acceptIt(bookingId: string, technician: Session): Promise<void> {
  await request(app as Express)
    .post(`/api/v1/bookings/${bookingId}/accept`)
    .set(auth(technician.accessToken))
    .expect(200);
}

/** Booked, accepted, worked and paid in cash — the shortest path to settlement. */
async function completeAndPayCash(): Promise<{
  bookingId: string;
  customer: Session;
  technician: Session;
}> {
  const ctx = context as AppContext;
  const server = app as Express;
  const { bookingId, customer, technician } = await bookIt();

  await acceptIt(bookingId, technician);

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

  await request(server)
    .post(`/api/v1/bookings/${bookingId}/payments/cash`)
    .set(auth(technician.accessToken))
    .send({})
    .expect(201);

  return { bookingId, customer, technician };
}

const inboxOf = (userId: string) =>
  (context as AppContext).prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { deliveries: { orderBy: { channel: 'asc' } } },
  });

const channelsOf = (row: { deliveries: { channel: string }[] }) =>
  row.deliveries.map((delivery) => delivery.channel).sort();

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('Phase 10 — notifications', () => {
  it('has a working environment', () => {
    if (unavailableReason) {
      console.warn(SKIP(unavailableReason));
      expect(unavailableReason).toBeTruthy();
      return;
    }

    expect(fixture).toBeDefined();
    // The suite drives the fakes directly; a real transport here would send.
    expect(whatsapp?.name).toBe('fake');
    expect(sms?.name).toBe('fake');
  });

  /* ---------------------------------------------------------------------- */
  /* The routing table                                                      */
  /* ---------------------------------------------------------------------- */

  describe('routing', () => {
    it('tells the technician about a new request, on two channels, critically', async () => {
      if (unavailableReason || !fixture) return;

      const { bookingId } = await bookIt();
      await drainOutbox();

      const inbox = await inboxOf(fixture.technicianId);
      const row = inbox.find((entry) => entry.topic === 'booking.requested');

      expect(row).toBeDefined();
      expect(row!.aggregateId).toBe(bookingId);
      expect(row!.criticality).toBe('critical');
      expect(channelsOf(row!)).toEqual(['in_app', 'whatsapp']);
      expect(row!.deepLink).toBe(`booking/${bookingId}`);

      // The customer hears nothing yet — nobody has agreed to anything.
      const customerInbox = await inboxOf(fixture.customerId);
      expect(customerInbox.some((entry) => entry.topic === 'booking.requested')).toBe(false);

      const sent = whatsapp!.sent.filter((m) => m.meta.topic === 'booking.requested');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.message.body).toContain('15');
    }, 45_000);

    /**
     * The message that carries an OTP.
     *
     * For a web user with no app there is nowhere else the start code can come
     * from, which is why this route is critical and why it goes out at all.
     */
    it('sends the customer the start code when a technician accepts', async () => {
      if (unavailableReason || !fixture) return;

      const { bookingId, technician } = await bookIt();
      const ctx = context as AppContext;

      await acceptIt(bookingId, technician);
      const otp = await ctx.redis.get(`booking:otp:plain:start:${bookingId}`);
      await drainOutbox();

      const row = (await inboxOf(fixture.customerId)).find(
        (entry) => entry.topic === 'booking.accepted',
      );

      expect(row).toBeDefined();
      expect(row!.criticality).toBe('critical');
      expect(row!.bodyKey).toBe('notif.booking.accepted.body');

      const sent = whatsapp!.sent.find((m) => m.meta.topic === 'booking.accepted');
      expect(sent).toBeDefined();
      expect(sent!.message.body).toContain(otp as string);
    }, 45_000);

    /**
     * The declared fallback, exercised.
     *
     * The OTP lives in Redis with a TTL and this consumer is asynchronous; when
     * the code is gone the route degrades to a template that never mentions it,
     * rather than sending a sentence with a hole in it.
     */
    it('degrades to the no-OTP template when the code has already expired', async () => {
      if (unavailableReason || !fixture) return;

      const { bookingId, technician } = await bookIt();
      const ctx = context as AppContext;

      await acceptIt(bookingId, technician);

      // Exactly what a slow dispatcher would find.
      await ctx.redis.del(`booking:otp:plain:start:${bookingId}`);
      await drainOutbox();

      const row = (await inboxOf(fixture.customerId)).find(
        (entry) => entry.topic === 'booking.accepted',
      );

      expect(row!.bodyKey).toBe('notif.booking.acceptedNoOtp.body');

      const sent = whatsapp!.sent.find((m) => m.meta.topic === 'booking.accepted');
      expect(sent!.message.body).not.toContain('undefined');
      expect(sent!.message.body).not.toContain('{{');
    }, 45_000);

    it('points a rejected customer at search rather than at the dead booking', async () => {
      if (unavailableReason || !fixture) return;

      const { bookingId, technician } = await bookIt();

      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/reject`)
        .set(auth(technician.accessToken))
        .send({ reason: 'too_far' })
        .expect(200);

      await drainOutbox();

      const row = (await inboxOf(fixture.customerId)).find(
        (entry) => entry.topic === 'booking.rejected',
      );

      expect(row).toBeDefined();
      expect(row!.deepLink).toBe('search');
      expect(row!.criticality).toBe('critical');
    }, 45_000);

    /** Each cancellation tells the other side. Nobody is told what they did. */
    it('tells the technician when the customer cancels, and nobody else', async () => {
      if (unavailableReason || !fixture) return;

      const { bookingId, customer, technician } = await bookIt();
      await acceptIt(bookingId, technician);

      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set(auth(customer.accessToken))
        .send({ reason: 'other' })
        .expect(200);

      await drainOutbox();

      const providerRows = await inboxOf(fixture.technicianId);
      const customerRows = await inboxOf(fixture.customerId);

      expect(providerRows.some((r) => r.topic === 'booking.cancelled_by_customer')).toBe(true);
      expect(customerRows.some((r) => r.topic === 'booking.cancelled_by_customer')).toBe(false);
    }, 45_000);

    it('sends the customer a quote with its total', async () => {
      if (unavailableReason || !fixture) return;

      const { bookingId, technician } = await bookIt();
      const ctx = context as AppContext;

      await acceptIt(bookingId, technician);

      const startOtp = await ctx.redis.get(`booking:otp:plain:start:${bookingId}`);
      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/start`)
        .set(auth(technician.accessToken))
        .send({ otp: startOtp ?? '0000' })
        .expect(200);

      /**
       * The booking is anchored at `FIXED_PRICE_PAISE`, so labour above that is
       * *extra* and must say why — this test predates that rule and sent a bare
       * ₹500 against an agreed ₹220, which the labour rules now refuse. The
       * split is stated honestly here; what this test is actually about is the
       * notification the customer receives, not the pricing.
       */
      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/quotations`)
        .set(auth(technician.accessToken))
        .send({
          labourPaise: 50_000,
          agreedLabourPaise: FIXED_PRICE_PAISE,
          extraLabourPaise: 50_000 - FIXED_PRICE_PAISE,
          extraLabourReason: 'The compressor mount had seized and had to be cut free.',
          items: [{ kind: 'part', description: 'Capacitor', qty: 1, unitPaise: 30_000 }],
        })
        .expect(201);

      await drainOutbox();

      const row = (await inboxOf(fixture.customerId)).find(
        (entry) => entry.topic === 'quotation.sent',
      );

      expect(row).toBeDefined();
      expect(channelsOf(row!)).toEqual(['in_app', 'whatsapp']);

      const sent = whatsapp!.sent.find((m) => m.meta.topic === 'quotation.sent');
      expect(sent!.message.body).toContain('₹800');
    }, 60_000);

    /**
     * The anti-fraud message, and the reason this phase exists.
     *
     * Three channels, including the one that works with no data connection. A
     * customer who never sees this cannot dispute it, and a charge nobody can
     * dispute is a charge somebody will eventually invent.
     */
    it('tells the customer about recorded cash on all three channels', async () => {
      if (unavailableReason || !fixture) return;

      await completeAndPayCash();
      await drainOutbox();

      const row = (await inboxOf(fixture.customerId)).find(
        (entry) => entry.topic === 'payment.cash_recorded',
      );

      expect(row).toBeDefined();
      expect(row!.criticality).toBe('critical');
      expect(channelsOf(row!)).toEqual(['in_app', 'sms', 'whatsapp']);

      expect(sms!.sent.filter((m) => m.meta.topic === 'payment.cash_recorded')).toHaveLength(1);

      const message = whatsapp!.sent.find((m) => m.meta.topic === 'payment.cash_recorded');
      // ₹220 price card + ₹49 visit fee, the payable frozen at completion.
      expect(message!.message.body).toContain('₹269');
      // The whole point: it tells them what to do if it is wrong.
      expect(message!.message.body).toContain('शिकायत');
    }, 60_000);

    /**
     * Mandatory per Phase 9, and the route this phase would be a failure
     * without: a technician whose work silently stops concludes the platform is
     * broken and goes back to the shop that phones them.
     */
    it('explains a suspension, with its reason, on every channel', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await signIn(app as Express, PHONES.ops, 'device-notif-ops');

      await request(app as Express)
        .post('/api/v1/admin/trust/suspend')
        .set(auth(ops.accessToken))
        .send({ providerId: fixture.technicianId, reason: 'Repeated no-shows reported by hand' })
        .expect(200);

      await drainOutbox();

      const row = (await inboxOf(fixture.technicianId)).find(
        (entry) => entry.topic === 'provider.suspended',
      );

      expect(row).toBeDefined();
      expect(row!.criticality).toBe('critical');
      expect(channelsOf(row!)).toEqual(['in_app', 'sms', 'whatsapp']);
      expect(row!.deepLink).toBe('trust');

      const message = sms!.sent.find((m) => m.meta.topic === 'provider.suspended');
      expect(message).toBeDefined();
      // The reason, resolved into Hindi rather than left as an i18n key.
      expect(message!.message.body).toContain('सहायता टीम');
      expect(message!.message.body).not.toContain('trust.suspension');
    }, 45_000);

    it('tells a reinstated technician they can work again', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await signIn(app as Express, PHONES.ops, 'device-notif-ops');

      await request(app as Express)
        .post('/api/v1/admin/trust/suspend')
        .set(auth(ops.accessToken))
        .send({ providerId: fixture.technicianId, reason: 'Pending a conversation' })
        .expect(200);

      await request(app as Express)
        .post(`/api/v1/admin/trust/${fixture.technicianId}/reinstate`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Spoke to them; the cancellations were a family emergency.' })
        .expect(200);

      await drainOutbox();

      const rows = await inboxOf(fixture.technicianId);
      expect(rows.some((entry) => entry.topic === 'provider.reinstated')).toBe(true);
    }, 45_000);

    /**
     * Being complained about is in-app only, and deliberately so. It is not yet
     * a finding — ops have not looked at it — and a WhatsApp at 9pm saying
     * somebody has accused you of something, with no decision attached, would do
     * more harm than good.
     */
    it('tells the accused about a complaint, quietly', async () => {
      if (unavailableReason || !fixture) return;

      const { bookingId, customer } = await completeAndPayCash();

      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/complaints`)
        .set(auth(customer.accessToken))
        .send({ category: 'quality', description: 'The fan started making the same noise again.' })
        .expect(201);

      await drainOutbox();

      const row = (await inboxOf(fixture.technicianId)).find(
        (entry) => entry.topic === 'complaint.opened',
      );

      expect(row).toBeDefined();
      expect(channelsOf(row!)).toEqual(['in_app']);
      expect(row!.criticality).toBe('standard');
      expect(whatsapp!.sent.some((m) => m.meta.topic === 'complaint.opened')).toBe(false);
    }, 60_000);

    it('tells both sides when a complaint is decided', async () => {
      if (unavailableReason || !fixture) return;

      const { bookingId, customer } = await completeAndPayCash();
      const ops = await signIn(app as Express, PHONES.ops, 'device-notif-ops');

      const raised = await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/complaints`)
        .set(auth(customer.accessToken))
        .send({ category: 'overcharge', description: 'I was charged more than the quote said.' })
        .expect(201);

      const complaintId = raised.body.complaint.id as string;

      await request(app as Express)
        .post(`/api/v1/admin/complaints/${complaintId}/take-up`)
        .set(auth(ops.accessToken))
        .send({})
        .expect(200);

      await request(app as Express)
        .post(`/api/v1/admin/complaints/${complaintId}/resolve`)
        .set(auth(ops.accessToken))
        .send({ note: 'Refunded the difference by hand.', severity: 'minor' })
        .expect(200);

      await drainOutbox();

      const customerRow = (await inboxOf(fixture.customerId)).find(
        (entry) => entry.topic === 'complaint.resolved',
      );
      const providerRow = (await inboxOf(fixture.technicianId)).find(
        (entry) => entry.topic === 'complaint.resolved',
      );

      expect(customerRow).toBeDefined();
      expect(providerRow).toBeDefined();
      // Two people, two different sentences about the same decision.
      expect(customerRow!.bodyKey).not.toBe(providerRow!.bodyKey);
    }, 90_000);

    /**
     * Most of what this system publishes is for projections, not people. A topic
     * with no row in the table is normal, not an error.
     */
    it('does nothing at all for an unrouted topic', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;

      const event: DeliveredEvent = {
        id: fixtureUuid('f01'),
        topic: 'booking.en_route',
        aggregateType: 'booking',
        aggregateId: fixtureUuid('f02'),
        payload: {},
        attempts: 0,
        createdAt: new Date(),
      };

      await expect(handleNotificationEvent({ context: ctx }, event)).resolves.toBeUndefined();

      expect(await ctx.prisma.notification.count({ where: { topic: 'booking.en_route' } })).toBe(0);
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Idempotency                                                            */
  /* ---------------------------------------------------------------------- */

  describe('idempotency', () => {
    /**
     * The property the outbox's at-least-once contract actually requires.
     *
     * A projection can shrug off a replay. A message cannot: the human sees it
     * twice, and after the third identical WhatsApp about one booking they stop
     * reading any of them.
     */
    it('messages a person once, however many times the event is delivered', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const { bookingId } = await bookIt();
      await drainOutbox();

      const event = await ctx.prisma.outboxEvent.findFirst({
        where: { aggregateId: bookingId, topic: 'booking.requested' },
      });

      expect(event).toBeDefined();

      const delivered: DeliveredEvent = {
        id: event!.id,
        topic: event!.topic,
        aggregateType: event!.aggregateType,
        aggregateId: event!.aggregateId,
        payload: event!.payload,
        attempts: event!.attempts,
        createdAt: event!.createdAt,
      };

      // Three more deliveries of exactly the same event.
      for (let pass = 0; pass < 3; pass += 1) {
        await handleNotificationEvent({ context: ctx }, delivered);
      }

      const rows = await ctx.prisma.notification.findMany({
        where: { topic: 'booking.requested', aggregateId: bookingId },
        include: { deliveries: true },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]!.deliveries).toHaveLength(2);
      expect(whatsapp!.sent.filter((m) => m.meta.topic === 'booking.requested')).toHaveLength(1);
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Quiet hours                                                            */
  /* ---------------------------------------------------------------------- */

  describe('quiet hours', () => {
    async function eventFor(bookingId: string, topic: string): Promise<DeliveredEvent> {
      return {
        id: fixtureUuid('f10'),
        topic,
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: { totalPaise: 80_000 },
        attempts: 0,
        createdAt: new Date(),
      };
    }

    /**
     * Held, not dropped — and the row says exactly when it will go out. Dropping
     * would be a silent loss the recipient can never detect.
     */
    it('holds a standard message sent at 23:00 IST until 07:00', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const { bookingId } = await bookIt();

      await handleNotificationEvent(
        { context: ctx, now: () => ist(16, 23, 0) },
        await eventFor(bookingId, 'payment.captured'),
      );

      const deliveries = await ctx.prisma.notificationDelivery.findMany({
        where: { topic: 'payment.captured', aggregateId: bookingId },
        orderBy: { channel: 'asc' },
      });

      const inApp = deliveries.find((d) => d.channel === 'in_app');
      expect(inApp?.status).toBe('sent');
      expect(inApp?.scheduledFor).toBeNull();
    }, 45_000);

    it('sends a critical message at 23:00 without hesitating', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const { bookingId } = await bookIt();

      await handleNotificationEvent(
        { context: ctx, now: () => ist(16, 23, 0) },
        {
          id: fixtureUuid('f11'),
          topic: 'payment.cash_recorded',
          aggregateType: 'booking',
          aggregateId: bookingId,
          payload: { amountPaise: 22_000 },
          attempts: 0,
          createdAt: new Date(),
        },
      );

      const deliveries = await ctx.prisma.notificationDelivery.findMany({
        where: { topic: 'payment.cash_recorded', aggregateId: bookingId },
      });

      expect(deliveries.every((d) => d.status === 'sent')).toBe(true);
      expect(sms!.sent.filter((m) => m.meta.topic === 'payment.cash_recorded')).toHaveLength(1);
    }, 45_000);

    /**
     * The full round trip, on an injected clock: held at 23:00, still held at
     * 02:00, released at 07:00. No timers, no waiting.
     */
    it('holds a standard whatsapp overnight and releases it in the morning', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;

      // A standard route that does use WhatsApp: a badge change.
      await handleNotificationEvent(
        { context: ctx, now: () => ist(16, 23, 30) },
        {
          id: fixtureUuid('f12'),
          topic: 'provider.badge_changed',
          aggregateType: 'provider',
          aggregateId: fixture.technicianId,
          payload: { badge: 'SILVER' },
          attempts: 0,
          createdAt: new Date(),
        },
      );

      const held = await ctx.prisma.notificationDelivery.findFirst({
        where: { topic: 'provider.badge_changed', channel: 'whatsapp' },
      });

      expect(held?.status).toBe('suppressed_quiet_hours');
      expect(held?.scheduledFor?.toISOString()).toBe(ist(17, 7, 0).toISOString());
      expect(whatsapp!.sent.some((m) => m.meta.topic === 'provider.badge_changed')).toBe(false);

      // The inbox row, though, was there all along.
      const inApp = await ctx.prisma.notificationDelivery.findFirst({
        where: { topic: 'provider.badge_changed', channel: 'in_app' },
      });
      expect(inApp?.status).toBe('sent');

      // 02:00 — still not time.
      expect(await releaseHeldDeliveries({ context: ctx, now: () => ist(17, 2, 0) })).toBe(0);
      expect(whatsapp!.sent.some((m) => m.meta.topic === 'provider.badge_changed')).toBe(false);

      // 07:00 — the window opens.
      expect(await releaseHeldDeliveries({ context: ctx, now: () => ist(17, 7, 1) })).toBe(1);

      const released = await ctx.prisma.notificationDelivery.findFirst({
        where: { topic: 'provider.badge_changed', channel: 'whatsapp' },
      });

      expect(released?.status).toBe('sent');
      expect(released?.transportRef).toMatch(/^fake-/);
      expect(whatsapp!.sent.filter((m) => m.meta.topic === 'provider.badge_changed')).toHaveLength(
        1,
      );
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Language                                                               */
  /* ---------------------------------------------------------------------- */

  describe('language', () => {
    it('defaults everybody to Hindi', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const user = await ctx.prisma.user.findUnique({ where: { id: fixture.customerId } });

      expect(user?.preferredLanguage).toBe('hi');
    }, 30_000);

    it('writes to a customer in the language they chose, not the one the request had', async () => {
      if (unavailableReason || !fixture) return;

      const server = app as Express;

      const english = await signIn(server, PHONES.englishCustomer, 'device-notif-en');

      await request(server)
        .patch('/api/v1/auth/me')
        .set(auth(english.accessToken))
        .send({ preferredLanguage: 'en' })
        .expect(200);

      /**
       * Deliberately a booking whose *request* carried no English header at all
       * — the whole point of the column is that an asynchronous message has no
       * header to read.
       */
      const slot = await openSlot(fixture.otherTechnicianId);

      const created = await request(server)
        .post('/api/v1/bookings')
        .set(auth(english.accessToken))
        .set('Accept-Language', 'hi')
        .send({
          slotId: slot.id,
          categoryId: fixture.categoryId,
          addressId: fixture.englishAddressId,
          priceCardId: fixture.otherPriceCardId,
        })
        .expect(201);

      const bookingId = created.body.booking.id as string;
      const technician = await signIn(server, PHONES.otherTechnician, 'device-notif-tech2');
      await acceptIt(bookingId, technician);
      await drainOutbox();

      const sent = whatsapp!.sent.find((m) => m.meta.topic === 'booking.accepted');

      expect(sent).toBeDefined();
      expect(sent!.message.language).toBe('en');
      expect(sent!.message.body).toContain('is coming at');
      expect(/[ऀ-ॿ]/.test(sent!.message.body)).toBe(false);

      // And the technician, who did not change anything, still gets Hindi.
      const toTechnician = whatsapp!.sent.find((m) => m.meta.topic === 'booking.requested');
      expect(toTechnician!.message.language).toBe('hi');
      expect(/[ऀ-ॿ]/.test(toTechnician!.message.body)).toBe(true);
    }, 90_000);

    /**
     * The reason the rendered text is not stored.
     *
     * Switching language translates a person's whole history, because the row
     * keeps template keys and tagged parameters rather than a finished sentence.
     */
    it('re-renders an existing inbox when somebody switches language', async () => {
      if (unavailableReason || !fixture) return;

      const server = app as Express;
      const { bookingId, technician } = await bookIt();

      await acceptIt(bookingId, technician);
      await drainOutbox();

      const customer = await signIn(server, PHONES.customer, 'device-notif-cust');

      const before = await request(server)
        .get('/api/v1/notifications')
        .set(auth(customer.accessToken))
        .expect(200);

      const hindi = before.body.notifications.find(
        (n: { topic: string }) => n.topic === 'booking.accepted',
      );
      expect(/[ऀ-ॿ]/.test(hindi.body)).toBe(true);

      await request(server)
        .patch('/api/v1/auth/me')
        .set(auth(customer.accessToken))
        .send({ preferredLanguage: 'en' })
        .expect(200);

      const after = await request(server)
        .get('/api/v1/notifications')
        .set(auth(customer.accessToken))
        .expect(200);

      const english = after.body.notifications.find(
        (n: { topic: string }) => n.topic === 'booking.accepted',
      );

      expect(english.id).toBe(hindi.id);
      expect(/[ऀ-ॿ]/.test(english.body)).toBe(false);
      expect(english.body).toContain('is coming at');
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Retry and parking                                                      */
  /* ---------------------------------------------------------------------- */

  describe('retry', () => {
    it('retries a failed send through the outbox and succeeds on the next pass', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;

      whatsapp!.failNext(1);

      const { bookingId } = await bookIt();
      await drainOutbox();

      const afterFirst = await ctx.prisma.notificationDelivery.findFirst({
        where: { topic: 'booking.requested', aggregateId: bookingId, channel: 'whatsapp' },
      });

      expect(afterFirst?.status).toBe('failed');
      expect(afterFirst?.attempts).toBe(1);
      expect(afterFirst?.lastError).toContain('send refused');

      // The inbox row is unaffected — one channel failing is not the message
      // failing.
      const inApp = await ctx.prisma.notificationDelivery.findFirst({
        where: { topic: 'booking.requested', aggregateId: bookingId, channel: 'in_app' },
      });
      expect(inApp?.status).toBe('sent');

      // The outbox backs off; force the retry rather than waiting for it.
      await ctx.prisma.outboxEvent.updateMany({
        where: { aggregateId: bookingId, topic: 'booking.requested' },
        data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      });

      await drainOutbox();

      const afterRetry = await ctx.prisma.notificationDelivery.findFirst({
        where: { topic: 'booking.requested', aggregateId: bookingId, channel: 'whatsapp' },
      });

      expect(afterRetry?.status).toBe('sent');
      expect(whatsapp!.sent.filter((m) => m.meta.topic === 'booking.requested')).toHaveLength(1);
    }, 90_000);

    /**
     * Parked, not retried forever.
     *
     * A message nobody can send is a fact for ops — Phase 11 gives it a screen —
     * not a reason to keep one outbox event circling and blocking the batch.
     */
    it('parks a delivery once its attempts are spent', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      whatsapp!.failAlways(true);

      const { bookingId } = await bookIt();

      const delivered = async (): Promise<void> => {
        const event = await ctx.prisma.outboxEvent.findFirst({
          where: { aggregateId: bookingId, topic: 'booking.requested' },
        });

        if (!event) throw new Error('no outbox event');

        await handleNotificationEvent(
          { context: ctx },
          {
            id: event.id,
            topic: event.topic,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: event.payload,
            attempts: event.attempts,
            createdAt: event.createdAt,
          },
        ).catch(() => undefined);
      };

      for (let pass = 0; pass < ctx.config.NOTIFY_MAX_ATTEMPTS + 2; pass += 1) {
        await delivered();
      }

      const parked = await ctx.prisma.notificationDelivery.findFirst({
        where: { topic: 'booking.requested', aggregateId: bookingId, channel: 'whatsapp' },
      });

      expect(parked?.status).toBe('failed');
      expect(parked?.attempts).toBe(ctx.config.NOTIFY_MAX_ATTEMPTS);

      // And it stops throwing, so the event itself can be marked processed.
      whatsapp!.failAlways(false);
      await expect(delivered()).resolves.toBeUndefined();
    }, 90_000);
  });

  /* ---------------------------------------------------------------------- */
  /* The table really is the whole thing                                    */
  /* ---------------------------------------------------------------------- */

  describe('adding a route takes no code', () => {
    const SYNTHETIC = 'test.synthetic_topic';

    afterEach(() => {
      unregisterRoute(SYNTHETIC);
    });

    /**
     * The claim, tested honestly.
     *
     * Every route already in the table was written by somebody who could also
     * have edited the consumer. This registers a topic the codebase has never
     * heard of, publishes an event under it, and asserts the message arrives —
     * with no handler, no subscriber and no `if` written for it.
     */
    it('delivers a topic this codebase has never heard of', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;

      registerNotificationRoute(ctx.outbox, ctx, SYNTHETIC, {
        criticality: 'critical',
        audiences: [
          {
            role: 'customer',
            channels: ['in_app', 'whatsapp'],
            template: 'bookingRejected',
            deepLink: 'search',
          },
        ],
      });

      const { bookingId } = await bookIt();
      await drainOutbox();
      whatsapp!.reset();

      await ctx.prisma.$transaction(async (tx) => {
        await tx.outboxEvent.create({
          data: {
            topic: SYNTHETIC,
            aggregateType: 'booking',
            aggregateId: bookingId,
            payload: {},
          },
        });
      });

      await drainOutbox();

      const row = (await inboxOf(fixture.customerId)).find((entry) => entry.topic === SYNTHETIC);

      expect(row).toBeDefined();
      expect(row!.deepLink).toBe('search');
      expect(channelsOf(row!)).toEqual(['in_app', 'whatsapp']);
      expect(whatsapp!.sent.filter((m) => m.meta.topic === SYNTHETIC)).toHaveLength(1);
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- */
  /* The inbox API                                                          */
  /* ---------------------------------------------------------------------- */

  describe('the inbox', () => {
    it('lists, counts, and marks read', async () => {
      if (unavailableReason || !fixture) return;

      const server = app as Express;
      const { bookingId, technician } = await bookIt();
      await acceptIt(bookingId, technician);
      await drainOutbox();

      const customer = await signIn(server, PHONES.customer, 'device-notif-cust');

      const listed = await request(server)
        .get('/api/v1/notifications')
        .set(auth(customer.accessToken))
        .expect(200);

      expect(listed.body.total).toBeGreaterThan(0);
      expect(listed.body.unread).toBe(listed.body.total);
      expect(listed.body.notifications[0].read).toBe(false);
      expect(listed.body.notifications[0].title.length).toBeGreaterThan(0);

      const count = await request(server)
        .get('/api/v1/notifications/unread-count')
        .set(auth(customer.accessToken))
        .expect(200);

      expect(count.body.unread).toBe(listed.body.total);

      const id = listed.body.notifications[0].id as string;

      const read = await request(server)
        .post(`/api/v1/notifications/${id}/read`)
        .set(auth(customer.accessToken))
        .expect(200);

      expect(read.body.unread).toBe(count.body.unread - 1);

      const all = await request(server)
        .post('/api/v1/notifications/read-all')
        .set(auth(customer.accessToken))
        .expect(200);

      expect(all.body.unread).toBe(0);
    }, 60_000);

    /** An inbox is a record of what one person was told. There is no other view. */
    it('never shows somebody else’s notifications', async () => {
      if (unavailableReason || !fixture) return;

      const server = app as Express;
      const { bookingId, technician } = await bookIt();
      await acceptIt(bookingId, technician);
      await drainOutbox();

      const other = await signIn(server, PHONES.englishCustomer, 'device-notif-en');

      const listed = await request(server)
        .get('/api/v1/notifications')
        .set(auth(other.accessToken))
        .expect(200);

      expect(listed.body.notifications).toEqual([]);
      expect(listed.body.total).toBe(0);
    }, 45_000);

    it('filters to unread only when asked', async () => {
      if (unavailableReason || !fixture) return;

      const server = app as Express;
      const { bookingId, technician } = await bookIt();
      await acceptIt(bookingId, technician);
      await drainOutbox();

      const customer = await signIn(server, PHONES.customer, 'device-notif-cust');

      await request(server)
        .post('/api/v1/notifications/read-all')
        .set(auth(customer.accessToken))
        .expect(200);

      const unread = await request(server)
        .get('/api/v1/notifications')
        .query({ unread_only: 'true' })
        .set(auth(customer.accessToken))
        .expect(200);

      expect(unread.body.notifications).toEqual([]);

      const everything = await request(server)
        .get('/api/v1/notifications')
        .set(auth(customer.accessToken))
        .expect(200);

      expect(everything.body.notifications.length).toBeGreaterThan(0);
    }, 45_000);

    it('refuses an anonymous caller', async () => {
      if (unavailableReason) return;

      await request(app as Express)
        .get('/api/v1/notifications')
        .expect(401);
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* End to end                                                             */
  /* ---------------------------------------------------------------------- */

  describe('a whole job, from both inboxes', () => {
    it('tells each side exactly what concerns them, in Hindi', async () => {
      if (unavailableReason || !fixture) return;

      await completeAndPayCash();
      await drainOutbox();

      const customerTimeline = (await inboxOf(fixture.customerId)).map((row) => row.topic);
      const providerTimeline = (await inboxOf(fixture.technicianId)).map((row) => row.topic);

      // Newest first, and each side hears only its own half of the story.
      expect(customerTimeline).toEqual(['payment.cash_recorded', 'booking.accepted']);
      expect(providerTimeline).toEqual(['booking.requested']);

      const server = app as Express;
      const customer = await signIn(server, PHONES.customer, 'device-notif-cust');

      const listed = await request(server)
        .get('/api/v1/notifications')
        .set(auth(customer.accessToken))
        .expect(200);

      for (const notification of listed.body.notifications) {
        expect(/[ऀ-ॿ]/.test(notification.title)).toBe(true);
        expect(notification.body).not.toContain('{{');
        expect(notification.body).not.toContain('undefined');
      }
    }, 90_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Redaction sweep                                                        */
  /* ---------------------------------------------------------------------- */

  describe('nothing this suite sent carried a phone number', () => {
    /**
     * The sweep, over every message this file produced.
     *
     * Notifications travel over channels the recipient does not control — a
     * forwarded WhatsApp outlives everything — so the other party's number never
     * belongs in one. Unmasking lives in the apps, behind a booking in progress.
     *
     * Runs last, over the accumulated capture rather than the last test's, so it
     * covers every route the suite exercised.
     */
    it('has no ten-digit run in any rendered title or body', () => {
      if (unavailableReason) return;

      expect(allSent.length).toBeGreaterThan(0);

      const offences = allSent
        .filter((sent) => /\d{10}/.test(`${sent.message.title} ${sent.message.body}`))
        .map((sent) => `${sent.meta.topic}: ${sent.message.body}`);

      expect(offences).toEqual([]);
    });

    it('never puts a recipient’s own number into the text either', () => {
      if (unavailableReason) return;

      const phones = Object.values(PHONES).map((phone) => phone.replace('+91', ''));

      const offences = allSent
        .filter((sent) =>
          phones.some((phone) => `${sent.message.title}${sent.message.body}`.includes(phone)),
        )
        .map((sent) => sent.meta.topic);

      expect(offences).toEqual([]);
    });
  });
});
