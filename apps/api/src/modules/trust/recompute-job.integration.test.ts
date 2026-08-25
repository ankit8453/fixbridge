import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { registerOutboxSubscribers } from '../../core/background';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { purgeBookingData } from '../bookings/repository';
import { generateSlotsForProvider } from '../bookings/slots-service';
import { createTrustJobs, recomputeAllProviders, recomputeProviderTrust } from './service';

/**
 * The scheduled trust recompute — the Phase 9 carry-over.
 *
 * The blind spot it closes is structural rather than a bug: **nothing happening
 * is also a signal.** A technician who stops accepting work generates no events,
 * so the event-driven engine never runs for them and the recency component —
 * whose entire job is to decay — freezes at whatever it was the day they went
 * quiet. A customer three months later sees a score describing somebody who is
 * no longer working.
 *
 * Everything here runs on an injected clock. No timers, no waiting 45 days.
 */

const FIXED_OTP = '000000';
const PHONES = {
  technician: '+919999911001',
  customer: '+919999911010',
};

const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };
const FIXED_PRICE_PAISE = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The two technicians the Phase 9 seed hand-boosts, and by how much. */
const SEEDED_BANDS = [
  { phone: '+919000000001', settledJobs: 14, badge: 'SILVER' as const },
  { phone: '+919000000007', settledJobs: 42, badge: 'GOLD' as const },
];

let app: Express | undefined;
let context: AppContext | undefined;
let unavailableReason: string | undefined;

interface Fixture {
  technicianId: string;
  customerId: string;
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

const fixtureUuid = (suffix: string): string =>
  ['00000000', '0000', '4000', 'af00', suffix.padStart(12, '0')].join('-');

async function signIn(server: Express, phone: string, deviceId = 'device-sweep') {
  await request(server).post('/api/v1/auth/otp/request').send({ phone });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; user: { id: string } };
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

  const technicianSession = await signIn(app, PHONES.technician, 'device-sweep-tech');
  const customerSession = await signIn(app, PHONES.customer, 'device-sweep-cust');
  const technicianId = technicianSession.user.id;

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
      displayName: 'Sweep Test Technician',
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
    await context.prisma.providerAvailabilityTemplate.upsert({
      where: { id: fixtureUuid(`b0${dayOfWeek}`) },
      update: { isActive: true },
      create: {
        id: fixtureUuid(`b0${dayOfWeek}`),
        providerId: technicianId,
        dayOfWeek,
        startMinute: 0,
        endMinute: 24 * 60,
        isActive: true,
      },
    });
  }

  const addressId = fixtureUuid('a01');
  await context.prisma.address.upsert({
    where: { id: addressId },
    update: {},
    create: {
      id: addressId,
      userId: customerSession.user.id,
      label: 'home',
      addressText: '4, Sweep Lane, Wright Town',
      landmark: 'Near the crossing',
      cityId: city.id,
      lat: WRIGHT_TOWN.lat,
      lng: WRIGHT_TOWN.lng,
      isDefault: true,
    },
  });

  fixture = {
    technicianId,
    customerId: customerSession.user.id,
    addressId,
    cityId: city.id,
    categoryId: category.id,
    priceCardId,
  };
}, 120_000);

beforeEach(async () => {
  if (!context || !fixture || unavailableReason) return;

  /**
   * Truncate, not delete: snapshots are append-only by trigger, deliberately.
   * The sledgehammer is what a teardown needs and what production must never
   * have — the same reasoning as the Phase 9 suite, which truncates the same
   * table for the same reason.
   */
  await context.prisma.$executeRawUnsafe('TRUNCATE trust_score_snapshots CASCADE');

  await generateSlotsForProvider(context, fixture.technicianId);
});

/**
 * Restores what a full sweep necessarily disturbs.
 *
 * `recomputeAllProviders` recounts `settled_jobs_count` from real bookings, which
 * undoes the two volumes the Phase 9 seed sets by hand to manufacture a SILVER
 * and a GOLD holder. Other suites assert against those bands, so this puts them
 * back rather than leaving the next file to discover it.
 */
async function restoreSeededBands(ctx: AppContext): Promise<void> {
  for (const seeded of SEEDED_BANDS) {
    const user = await ctx.prisma.user.findUnique({
      where: { phone: seeded.phone },
      select: { id: true },
    });

    if (!user) continue;

    await ctx.prisma.providerStats.updateMany({
      where: { providerId: user.id },
      data: { settledJobsCount: seeded.settledJobs },
    });

    await ctx.prisma.providerVerificationSummary.updateMany({
      where: { providerId: user.id },
      data: { badge: seeded.badge },
    });
  }
}

afterAll(async () => {
  if (context && !unavailableReason && fixture) {
    await restoreSeededBands(context);

    const ids = [fixture.technicianId, fixture.customerId];

    await context.prisma.$executeRawUnsafe('TRUNCATE ledger_entries, ledger_journals CASCADE');
    await context.prisma.payment.deleteMany({
      where: { booking: { providerId: fixture.technicianId } },
    });
    await context.prisma.$executeRawUnsafe('DELETE FROM accounts');
    await context.prisma.$executeRawUnsafe('TRUNCATE trust_score_snapshots CASCADE');
    await purgeBookingData(context.prisma, ids);
    await context.prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] scheduled trust recompute — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

/** A booking taken all the way to settled, so there is something to decay. */
async function settledJob(): Promise<void> {
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

  const customer = await signIn(server, PHONES.customer, 'device-sweep-cust');
  const technician = await signIn(server, PHONES.technician, 'device-sweep-tech');

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

  await request(server)
    .post(`/api/v1/bookings/${bookingId}/payments/cash`)
    .set(auth(technician.accessToken))
    .send({})
    .expect(201);
}

describe('scheduled trust recompute', () => {
  it('has a working environment', () => {
    if (unavailableReason) {
      console.warn(SKIP(unavailableReason));
      expect(unavailableReason).toBeTruthy();
      return;
    }

    expect(fixture).toBeDefined();
  });

  /**
   * The whole point of the carry-over: 45 days of nothing is a fact about a
   * technician, and no event will ever announce it.
   */
  it('drops the score of somebody who has not worked in 45 days', async () => {
    if (unavailableReason || !context || !fixture) return;

    await settledJob();

    const today = await recomputeProviderTrust(
      { context },
      fixture.technicianId,
      { topic: 'test.baseline', aggregateId: null },
      { snapshotOnlyOnChange: true },
    );

    expect(today?.score).not.toBeNull();

    const later = new Date(Date.now() + 45 * DAY_MS);

    const after = await recomputeProviderTrust(
      { context, now: () => later },
      fixture.technicianId,
      { topic: 'trust.scheduled_recompute', aggregateId: null },
      { snapshotOnlyOnChange: true },
    );

    expect(after?.score).not.toBeNull();
    expect(after!.score!).toBeLessThan(today!.score!);

    // And the recency component is the one that moved.
    const recency = after!.trust.components.find((component) => component.name === 'recency');
    expect(recency?.normalized).toBeLessThan(0.75);
    expect(recency?.normalized).toBeGreaterThan(0.65);
  }, 90_000);

  /**
   * A sweep that ran and found nothing is not history.
   *
   * Without this, every technician would accumulate four identical snapshots a
   * day and the one row where something actually happened would be impossible to
   * find in the trend.
   */
  it('writes no snapshot when the score has not moved', async () => {
    if (unavailableReason || !context || !fixture) return;

    await settledJob();

    const count = () =>
      (context as AppContext).prisma.trustScoreSnapshot.count({
        where: { providerId: (fixture as Fixture).technicianId },
      });

    await recomputeProviderTrust(
      { context },
      fixture.technicianId,
      { topic: 'trust.scheduled_recompute', aggregateId: null },
      { snapshotOnlyOnChange: true },
    );

    const first = await count();
    expect(first).toBe(1);

    for (let pass = 0; pass < 5; pass += 1) {
      await recomputeProviderTrust(
        { context },
        fixture.technicianId,
        { topic: 'trust.scheduled_recompute', aggregateId: null },
        { snapshotOnlyOnChange: true },
      );
    }

    expect(await count()).toBe(first);
  }, 90_000);

  /**
   * The event-driven path keeps writing one every time, and should.
   *
   * "This review changed nothing" is itself worth recording — the trigger topic
   * on the row is what lets a technician trace a jump back to a cause.
   */
  it('still writes a snapshot for every event-driven recompute', async () => {
    if (unavailableReason || !context || !fixture) return;

    await settledJob();

    for (let pass = 0; pass < 3; pass += 1) {
      await recomputeProviderTrust({ context }, fixture.technicianId, {
        topic: 'review.created',
        aggregateId: null,
      });
    }

    const snapshots = await context.prisma.trustScoreSnapshot.count({
      where: { providerId: fixture.technicianId },
    });

    expect(snapshots).toBe(3);
  }, 90_000);

  it('scans every technician, not only the ones something happened to', async () => {
    if (unavailableReason || !context || !fixture) return;

    const providers = await context.prisma.providerProfile.count();
    const result = await recomputeAllProviders({ context });

    expect(result.scanned).toBe(providers);

    // Put back what a full recount necessarily undid, before anything else runs.
    await restoreSeededBands(context);
  }, 120_000);

  it('is scheduled on the configured interval, Redis-locked like every other job', () => {
    if (unavailableReason || !context) return;

    const jobs = createTrustJobs(context);
    const job = jobs.find((definition) => definition.name === 'trust-recompute');

    expect(job).toBeDefined();
    expect(job!.intervalMs).toBe(context.config.TRUST_RECOMPUTE_JOB_INTERVAL_MS);
    expect(job!.lockTtlMs).toBeGreaterThan(0);
  });
});
