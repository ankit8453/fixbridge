import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { ADMIN_ONLY_ROUTES, AUDIT_ACTIONS } from '../../core/audit';
import { registerOutboxSubscribers } from '../../core/background';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { createOutboxDispatcher } from '../../core/outbox';
import { bookingOtpKeys } from '../bookings/otp';
import { purgeBookingData } from '../bookings/repository';
import { generateSlotsForProvider } from '../bookings/slots-service';
import { asFakeTransport, type FakeTransport } from '../notifications/transports';

/**
 * Phase 11 — the ops console's API, against real Postgres and Redis.
 *
 * Own technicians, own customer, own phone prefix, for the reason every phase
 * since 8 has had one: earlier suites assert exact counts over the seeded
 * dataset, and this one blocks people and cancels bookings.
 */

const FIXED_OTP = '000000';
const PHONES = {
  technician: '+919999912001',
  customer: '+919999912010',
  ops: '+919999912020',
  admin: '+919999912021',
};

const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };
const FIXED_PRICE_PAISE = 24_000;

let app: Express | undefined;
let context: AppContext | undefined;
let whatsapp: FakeTransport | undefined;
let unavailableReason: string | undefined;

interface Fixture {
  technicianId: string;
  customerId: string;
  opsId: string;
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

const fixtureUuid = (suffix: string): string =>
  ['00000000', '0000', '4000', 'ad00', suffix.padStart(12, '0')].join('-');

async function signIn(server: Express, phone: string, deviceId = 'device-admin') {
  await request(server).post('/api/v1/auth/otp/request').send({ phone });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; user: { id: string } };
}

async function grantRole(ctx: AppContext, userId: string, role: 'ops' | 'admin' | 'technician') {
  await ctx.prisma.userRole.upsert({
    where: { userId_role: { userId, role } },
    update: {},
    create: { userId, role },
  });
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

  /**
   * Un-block anybody this suite left blocked last time.
   *
   * This file's whole subject is ops actions, and blocking is one of them — so a
   * run that dies mid-test leaves a fixture account that cannot even sign in,
   * and every subsequent run fails in `beforeAll` for a reason that has nothing
   * to do with the code under test.
   */
  const existing = await context.prisma.user.findMany({
    where: { phone: { in: Object.values(PHONES) } },
    select: { id: true },
  });

  if (existing.length > 0) {
    await context.prisma.user.updateMany({
      where: { id: { in: existing.map((user) => user.id) } },
      data: { status: 'active' },
    });

    for (const user of existing) await context.userDenylist.remove(user.id);
  }

  const tech = await signIn(app, PHONES.technician, 'device-admin-tech');
  const customer = await signIn(app, PHONES.customer, 'device-admin-cust');
  const ops = await signIn(app, PHONES.ops, 'device-admin-ops');
  const admin = await signIn(app, PHONES.admin, 'device-admin-admin');

  await grantRole(context, tech.user.id, 'technician');
  await grantRole(context, ops.user.id, 'ops');
  await grantRole(context, admin.user.id, 'admin');

  await context.prisma.providerProfile.upsert({
    where: { userId: tech.user.id },
    update: { isListed: true, completenessScore: 100, cityId: city.id, serviceRadiusKm: 10 },
    create: {
      userId: tech.user.id,
      displayName: 'Admin Test Technician',
      yearsExperience: 8,
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
    WHERE user_id = ${tech.user.id}::uuid
  `;

  await context.prisma.providerVerificationSummary.upsert({
    where: { providerId: tech.user.id },
    update: { badge: 'VERIFIED', levelsPassed: [0, 1] },
    create: {
      providerId: tech.user.id,
      badge: 'VERIFIED',
      levelsPassed: [0, 1],
      badgeSince: new Date(),
    },
  });

  await context.prisma.providerSkill.upsert({
    where: { providerId_categoryId: { providerId: tech.user.id, categoryId: category.id } },
    update: {},
    create: { providerId: tech.user.id, categoryId: category.id },
  });

  const priceCardId = fixtureUuid('c01');

  await context.prisma.providerPriceCard.upsert({
    where: { id: priceCardId },
    update: { amountPaise: FIXED_PRICE_PAISE, isActive: true },
    create: {
      id: priceCardId,
      providerId: tech.user.id,
      categoryId: category.id,
      title: 'Flat rate visit',
      priceType: 'fixed',
      amountPaise: FIXED_PRICE_PAISE,
    },
  });

  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    await context.prisma.providerAvailabilityTemplate.upsert({
      where: { id: fixtureUuid(`d0${dayOfWeek}`) },
      update: { isActive: true },
      create: {
        id: fixtureUuid(`d0${dayOfWeek}`),
        providerId: tech.user.id,
        dayOfWeek,
        startMinute: 0,
        endMinute: 24 * 60,
        isActive: true,
      },
    });
  }

  const addressId = fixtureUuid('a01');
  await context.prisma.$executeRaw`
    INSERT INTO addresses
      (id, user_id, label, address_text, landmark, city_id, location, is_default, created_at, updated_at)
    VALUES (
      ${addressId}::uuid, ${customer.user.id}::uuid, 'home'::address_label,
      '21, Ops Road, Wright Town', 'Beside the clinic', ${city.id},
      ST_SetSRID(ST_MakePoint(${WRIGHT_TOWN.lng}::double precision, ${WRIGHT_TOWN.lat}::double precision), 4326)::geography,
      true, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  fixture = {
    technicianId: tech.user.id,
    customerId: customer.user.id,
    opsId: ops.user.id,
    adminId: admin.user.id,
    addressId,
    cityId: city.id,
    categoryId: category.id,
    priceCardId,
  };
}, 120_000);

beforeEach(async () => {
  if (!context || !fixture || unavailableReason) return;

  whatsapp?.reset();

  const ids = [fixture.technicianId, fixture.customerId];

  const bookingIds = (
    await context.prisma.booking.findMany({
      where: { OR: [{ customerId: { in: ids } }, { providerId: { in: ids } }] },
      select: { id: true },
    })
  ).map((booking) => booking.id);

  await context.prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  /**
   * Truncate, not delete: audit_logs refuses DELETE by trigger, deliberately.
   * The sledgehammer is what a teardown needs and what production must never
   * have — the same pattern the reviews and trust-snapshot suites use.
   */
  await context.prisma.$executeRawUnsafe('TRUNCATE audit_logs CASCADE');
  await context.prisma.$executeRawUnsafe('TRUNCATE ledger_entries, ledger_journals CASCADE');
  await context.prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await context.prisma.payout.deleteMany({ where: { providerId: { in: ids } } });
  await context.prisma.payoutBatch.deleteMany({});
  await context.prisma.$executeRawUnsafe('DELETE FROM accounts');
  await purgeBookingData(context.prisma, ids);

  await context.prisma.user.updateMany({ where: { id: { in: ids } }, data: { status: 'active' } });
  await context.userDenylist.remove(fixture.customerId);
  await context.prisma.providerProfile.updateMany({
    where: { userId: fixture.technicianId },
    data: { suspendedUntil: null, suspendedAt: null, suspensionReason: null },
  });

  const keys = await context.redis.keys('booking:*');
  if (keys.length > 0) await context.redis.del(...keys);

  await generateSlotsForProvider(context, fixture.technicianId);
});

afterAll(async () => {
  if (context && !unavailableReason && fixture) {
    const ids = Object.values(PHONES);
    const users = await context.prisma.user.findMany({
      where: { phone: { in: ids } },
      select: { id: true },
    });

    const userIds = users.map((user) => user.id);

    await context.prisma.$executeRawUnsafe('TRUNCATE audit_logs CASCADE');
    await context.prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await context.prisma.$executeRawUnsafe('TRUNCATE ledger_entries, ledger_journals CASCADE');
    await context.prisma.payment.deleteMany({
      where: { booking: { providerId: fixture.technicianId } },
    });
    await context.prisma.payout.deleteMany({ where: { providerId: { in: userIds } } });
    await context.prisma.payoutBatch.deleteMany({});
    await context.prisma.$executeRawUnsafe('DELETE FROM accounts');
    await purgeBookingData(context.prisma, userIds);
    await context.prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] Phase 11 admin tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface Session {
  accessToken: string;
  user: { id: string };
}

const opsSession = () => signIn(app as Express, PHONES.ops, 'device-admin-ops');

/**
 * The money-and-config session.
 *
 * Phase 12 split the roles on **reversibility**: ops does the judgment work,
 * admin holds the actions that move money or change the rules. Tests exercising
 * a refund, a payout marked paid, a dues settlement or the entry-approval flag
 * need this one — and the fact that they used to pass with an ops token is
 * precisely what the split was correcting.
 */
const adminSession = () => signIn(app as Express, PHONES.admin, 'device-admin-admin');

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

/** A booking taken to whatever point the test needs. */
async function makeBooking(): Promise<{
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

  const customer = await signIn(server, PHONES.customer, 'device-admin-cust');
  const technician = await signIn(server, PHONES.technician, 'device-admin-tech');

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

  return { bookingId: created.body.booking.id as string, customer, technician };
}

async function settledBooking(): Promise<string> {
  const ctx = context as AppContext;
  const server = app as Express;
  const { bookingId, technician } = await makeBooking();

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

  return bookingId;
}

/**
 * Audit rows written by one actor.
 *
 * Defaults to the ops user because most of the console's work is theirs; the
 * money and config tests pass `adminId`, since Phase 12 moved those actions to
 * the `admin` role. Scoping by actor rather than reading the whole table keeps
 * each test's assertion about its own decision.
 */
const auditRows = (action?: string, actorUserId?: string) =>
  (context as AppContext).prisma.auditLog.findMany({
    where: {
      actorUserId: actorUserId ?? (fixture as Fixture).opsId,
      ...(action ? { action } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('Phase 11 — the ops console API', () => {
  it('has a working environment', () => {
    if (unavailableReason) {
      console.warn(SKIP(unavailableReason));
      expect(unavailableReason).toBeTruthy();
      return;
    }

    expect(fixture).toBeDefined();
  });

  /* ---------------------------------------------------------------------- */
  /* Authorisation                                                          */
  /* ---------------------------------------------------------------------- */

  describe('who gets in', () => {
    /**
     * The guard is applied once at the top of the router rather than per route,
     * so this asserts the property that arrangement buys: there is no admin path
     * a customer can reach, including ones added later.
     */
    it('refuses a customer everywhere under /admin', async () => {
      if (unavailableReason || !fixture) return;

      const customer = await signIn(app as Express, PHONES.customer, 'device-admin-cust');

      const paths = [
        '/api/v1/admin/summary',
        '/api/v1/admin/users',
        '/api/v1/admin/providers',
        '/api/v1/admin/bookings',
        '/api/v1/admin/audit-logs',
        '/api/v1/admin/queues/outbox',
        '/api/v1/admin/queues/webhooks',
        '/api/v1/admin/queues/deliveries',
        '/api/v1/admin/ledger/journals',
        '/api/v1/admin/cities',
        '/api/v1/admin/payout-batches',
        '/api/v1/admin/verification/queue',
        '/api/v1/admin/complaints',
        '/api/v1/admin/reviews/reports',
      ];

      for (const path of paths) {
        const response = await request(app as Express)
          .get(path)
          .set(auth(customer.accessToken));
        expect(response.status, path).toBe(403);
      }
    }, 60_000);

    it('refuses a technician too', async () => {
      if (unavailableReason || !fixture) return;

      const technician = await signIn(app as Express, PHONES.technician, 'device-admin-tech');

      await request(app as Express)
        .get('/api/v1/admin/summary')
        .set(auth(technician.accessToken))
        .expect(403);
    }, 30_000);

    it('refuses an anonymous caller', async () => {
      if (unavailableReason) return;
      await request(app as Express)
        .get('/api/v1/admin/summary')
        .expect(401);
    }, 30_000);

    it('lets both ops and admin through the door', async () => {
      if (unavailableReason) return;

      const ops = await opsSession();
      const admin = await signIn(app as Express, PHONES.admin, 'device-admin-admin');

      await request(app as Express)
        .get('/api/v1/admin/summary')
        .set(auth(ops.accessToken))
        .expect(200);

      await request(app as Express)
        .get('/api/v1/admin/summary')
        .set(auth(admin.accessToken))
        .expect(200);
    }, 45_000);

    /**
     * The ops/admin split, enumerated from the registry rather than typed out.
     *
     * The line is reversibility: an ops assistant does the judgment work all day
     * and should never hold a credential that can refund a customer or declare a
     * payout paid. If somebody adds a money route and forgets the guard, this
     * fails — the list it walks is the same one `ADMIN_ONLY_ROUTES` publishes.
     *
     * The bodies are deliberately empty. A `403` must come from the role guard
     * *before* validation, so a well-formed body is not needed to prove the
     * refusal — and if the guard were missing, a `400` here would fail this test
     * just as loudly as a `200` would.
     */
    it('refuses an ops token on every admin-only route', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();
      const server = app as Express;

      for (const entry of ADMIN_ONLY_ROUTES) {
        const [method, template] = entry.split(' ') as [string, string];

        // Any syntactically valid id: the guard runs before the handler, so the
        // target need not exist.
        const path = template
          .replace(':paymentId', fixture.technicianId)
          .replace(':payoutId', fixture.technicianId)
          .replace(':cityId', String(fixture.cityId));

        const response =
          method === 'PATCH'
            ? await request(server).patch(path).set(auth(ops.accessToken)).send({})
            : await request(server).post(path).set(auth(ops.accessToken)).send({});

        expect(response.status, `${method} ${path} should be admin-only`).toBe(403);
      }
    }, 90_000);

    /**
     * The other half: the split must not have locked ops out of their own work.
     *
     * A permission change that quietly stops the queue being workable is a worse
     * outcome than the one it was guarding against, and it is the failure nobody
     * notices until a technician has been waiting three days.
     */
    it('still lets ops do the judgment work', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();
      const server = app as Express;

      // A payout batch is ops work — creating and reviewing one is not the same
      // as declaring money paid.
      await request(server)
        .post('/api/v1/admin/payments/payout-batches')
        .set(auth(ops.accessToken))
        .send({})
        .expect((response) => {
          expect([200, 201]).toContain(response.status);
        });

      // And the queues they live in all day.
      for (const path of [
        '/api/v1/admin/verification/queue',
        '/api/v1/admin/complaints',
        '/api/v1/admin/reviews/reports',
        '/api/v1/admin/queues/outbox',
      ]) {
        await request(server).get(path).set(auth(ops.accessToken)).expect(200);
      }
    }, 90_000);

    /**
     * The audit log is a supervision tool, not a way for colleagues to check up
     * on each other. Ops can account for their own decisions; reviewing somebody
     * else's is the supervisor's job — and the scoping is forced server-side,
     * because a filter the client applies is not a permission.
     */
    it('shows ops only their own actions, and admin everything', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();
      const admin = await signIn(app as Express, PHONES.admin, 'device-admin-admin');

      const asOps = await request(app as Express)
        .get('/api/v1/admin/audit-logs')
        .set(auth(ops.accessToken))
        .expect(200);

      expect(asOps.body.scope).toBe('own');

      const foreign = (asOps.body.entries as { actorUserId: string | null }[]).filter(
        (entry) => entry.actorUserId !== fixture!.opsId,
      );
      expect(foreign, 'ops saw somebody else’s decisions').toEqual([]);

      const asAdmin = await request(app as Express)
        .get('/api/v1/admin/audit-logs')
        .set(auth(admin.accessToken))
        .expect(200);

      expect(asAdmin.body.scope).toBe('all');

      // Asking for another actor explicitly must not widen an ops view either.
      const attempted = await request(app as Express)
        .get('/api/v1/admin/audit-logs')
        .query({ actor_user_id: fixture.adminId })
        .set(auth(ops.accessToken))
        .expect(200);

      expect(
        (attempted.body.entries as { actorUserId: string | null }[]).filter(
          (entry) => entry.actorUserId !== fixture!.opsId,
        ),
      ).toEqual([]);
    }, 90_000);
  });

  /* ---------------------------------------------------------------------- */
  /* The audit backbone                                                     */
  /* ---------------------------------------------------------------------- */

  describe('the audit log', () => {
    it('records the actor, the target and the substance', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();

      await request(app as Express)
        .post(`/api/v1/admin/users/${fixture.customerId}/block`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Repeated abusive messages to technicians.' })
        .expect(200);

      const rows = await auditRows(AUDIT_ACTIONS.userBlock);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorUserId).toBe(fixture.opsId);
      expect(rows[0]!.targetType).toBe('user');
      expect(rows[0]!.targetId).toBe(fixture.customerId);
      expect(rows[0]!.payload).toMatchObject({
        reason: 'Repeated abusive messages to technicians.',
      });
      // Ties the decision back to the request log around it.
      expect(rows[0]!.requestId).toBeTruthy();
    }, 45_000);

    /**
     * The property the whole design rests on.
     *
     * A log full of decisions that did not happen is worse than no log, because
     * somebody will act on it. Here the mutation is made to fail *after* the
     * audit row is written inside the same transaction — and neither survives.
     */
    it('writes nothing when the mutation rolls back', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const admin = await adminSession();

      /**
       * A payout that is already settled.
       *
       * `markPayoutFailed` writes its audit row **first**, inside the
       * transaction, and only then discovers the row is not pending and throws.
       * That ordering is exactly what makes this a real test of the guarantee:
       * the audit row genuinely existed for a moment, and the rollback took it
       * with the failed decision.
       */
      const batchId = fixtureUuid('b01');
      const payoutId = fixtureUuid('b02');

      await ctx.prisma.payoutBatch.create({
        data: {
          id: batchId,
          status: 'draft',
          windowEnd: new Date(),
          totalPaise: 5_000,
          payoutCount: 1,
          payouts: {
            create: {
              id: payoutId,
              providerId: fixture.technicianId,
              amountPaise: 5_000,
              // Already dealt with, so the mark-failed below cannot match it.
              status: 'paid',
              utrRef: 'UTR-ALREADY-SENT',
              paidAt: new Date(),
            },
          },
        },
      });

      const before = (await auditRows(undefined, fixture.adminId)).length;

      await request(app as Express)
        .post(`/api/v1/admin/payments/payouts/${payoutId}/failed`)
        .set(auth(admin.accessToken))
        .send({ note: 'This should not stick.' })
        .expect(409);

      expect((await auditRows(undefined, fixture.adminId)).length).toBe(before);

      const marked = await ctx.prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.payoutMarkFailed, targetId: payoutId },
      });

      expect(marked).toBe(0);

      // And the payout itself is untouched — both halves rolled back together.
      const payout = await ctx.prisma.payout.findUnique({ where: { id: payoutId } });
      expect(payout?.status).toBe('paid');
    }, 60_000);

    it('is append-only, even to the database', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const ops = await opsSession();

      await request(app as Express)
        .post(`/api/v1/admin/users/${fixture.customerId}/block`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Test block for the immutability check.' })
        .expect(200);

      const row = (await auditRows(AUDIT_ACTIONS.userBlock))[0]!;

      await expect(
        ctx.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'user.unblock' } }),
      ).rejects.toThrow();

      await expect(ctx.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    }, 45_000);

    it('is readable through the viewer, filtered', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();

      await request(app as Express)
        .post(`/api/v1/admin/users/${fixture.customerId}/block`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Filtering test.' })
        .expect(200);

      const byAction = await request(app as Express)
        .get('/api/v1/admin/audit-logs')
        .query({ action: AUDIT_ACTIONS.userBlock, actor_user_id: fixture.opsId })
        .set(auth(ops.accessToken))
        .expect(200);

      expect(byAction.body.total).toBeGreaterThan(0);
      expect(byAction.body.entries[0].action).toBe(AUDIT_ACTIONS.userBlock);
      expect(byAction.body.entries[0].actor.id).toBe(fixture.opsId);

      const byTarget = await request(app as Express)
        .get('/api/v1/admin/audit-logs')
        .query({ target_type: 'user', target_id: fixture.customerId })
        .set(auth(ops.accessToken))
        .expect(200);

      expect(byTarget.body.total).toBeGreaterThan(0);
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Users and providers                                                    */
  /* ---------------------------------------------------------------------- */

  describe('users', () => {
    it('searches by phone fragment and blocks with a reason', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();

      const found = await request(app as Express)
        .get('/api/v1/admin/users')
        .query({ q: '9999912010' })
        .set(auth(ops.accessToken))
        .expect(200);

      expect(found.body.total).toBeGreaterThan(0);
      expect(found.body.users[0].id).toBe(fixture.customerId);

      await request(app as Express)
        .post(`/api/v1/admin/users/${fixture.customerId}/block`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Abusive behaviour reported by two technicians.' })
        .expect(200);

      // Blocked means blocked *now* — the denylist kills live access tokens.
      const customer = await (context as AppContext).prisma.user.findUnique({
        where: { id: fixture.customerId },
      });
      expect(customer?.status).toBe('blocked');

      await request(app as Express)
        .post(`/api/v1/admin/users/${fixture.customerId}/unblock`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Spoke to them; it was a misunderstanding.' })
        .expect(200);
    }, 60_000);

    it('will not block without a reason', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();

      await request(app as Express)
        .post(`/api/v1/admin/users/${fixture.customerId}/block`)
        .set(auth(ops.accessToken))
        .send({})
        .expect(400);
    }, 30_000);
  });

  describe('the provider page', () => {
    /**
     * The screen where most ops phone calls get answered. Every reason somebody
     * might be invisible has to be on it at once, or ops end up guessing.
     */
    it('answers every gate separately in one request', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();

      const response = await request(app as Express)
        .get(`/api/v1/admin/providers/${fixture.technicianId}`)
        .set(auth(ops.accessToken))
        .expect(200);

      const provider = response.body.provider;

      expect(provider.visibility).toEqual({
        listed: true,
        accountActive: true,
        verified: true,
        notSuspended: true,
        entryApproved: true,
      });

      expect(provider.balance).toHaveProperty('payablePaise');
      expect(provider.balance).toHaveProperty('duesPaise');
      expect(provider.verification.badge).toBe('VERIFIED');
      expect(Array.isArray(provider.recentBookings)).toBe(true);
    }, 45_000);

    it('shows the suspension gate failing once ops suspend them', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();

      await request(app as Express)
        .post('/api/v1/admin/trust/suspend')
        .set(auth(ops.accessToken))
        .send({ providerId: fixture.technicianId, reason: 'Three no-shows in one week.' })
        .expect(200);

      const response = await request(app as Express)
        .get(`/api/v1/admin/providers/${fixture.technicianId}`)
        .set(auth(ops.accessToken))
        .expect(200);

      expect(response.body.provider.visibility.notSuspended).toBe(false);
      // The badge is untouched — suspension and verification are separate axes.
      expect(response.body.provider.verification.badge).toBe('VERIFIED');

      const rows = await auditRows(AUDIT_ACTIONS.providerSuspend);
      expect(rows[0]!.payload).toMatchObject({ reason: 'Three no-shows in one week.' });
    }, 60_000);

    it('requires a reason to reinstate', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();

      await request(app as Express)
        .post('/api/v1/admin/trust/suspend')
        .set(auth(ops.accessToken))
        .send({ providerId: fixture.technicianId, reason: 'Pending a conversation.' })
        .expect(200);

      await request(app as Express)
        .post(`/api/v1/admin/trust/${fixture.technicianId}/reinstate`)
        .set(auth(ops.accessToken))
        .send({})
        .expect(400);

      await request(app as Express)
        .post(`/api/v1/admin/trust/${fixture.technicianId}/reinstate`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Spoke to them; the cancellations were a family emergency.' })
        .expect(200);

      const rows = await auditRows(AUDIT_ACTIONS.providerReinstate);
      expect(rows[0]!.payload).toMatchObject({ reason: expect.stringContaining('family') });
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Bookings — the dispute screen and the OTP unlock                       */
  /* ---------------------------------------------------------------------- */

  describe('bookings', () => {
    it('finds a booking by id and by either party’s phone', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();
      const { bookingId } = await makeBooking();

      const byId = await request(app as Express)
        .get('/api/v1/admin/bookings')
        .query({ q: bookingId })
        .set(auth(ops.accessToken))
        .expect(200);

      expect(byId.body.total).toBe(1);

      const byPhone = await request(app as Express)
        .get('/api/v1/admin/bookings')
        .query({ q: '9999912010' })
        .set(auth(ops.accessToken))
        .expect(200);

      expect(byPhone.body.total).toBeGreaterThan(0);
    }, 60_000);

    /**
     * The dispute screen: events, quotes, money **and what each side was told**.
     * "Nobody informed me" is the second thing every dispute turns on.
     */
    it('assembles the whole history, notifications included', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();
      const bookingId = await settledBooking();
      await drainOutbox();

      const response = await request(app as Express)
        .get(`/api/v1/admin/bookings/${bookingId}/timeline`)
        .set(auth(ops.accessToken))
        .expect(200);

      expect(response.body.booking.events.length).toBeGreaterThan(3);
      expect(response.body.booking.payments.length).toBe(1);
      expect(response.body.notifications.length).toBeGreaterThan(0);
      expect(response.body.otpLocked).toBe(false);

      const topics = response.body.notifications.map((row: { topic: string }) => row.topic);
      expect(topics).toContain('payment.cash_recorded');
    }, 90_000);

    /**
     * Phase 6 locked the handshake after five wrong codes and deliberately
     * refused to reissue — the point is that a specific person is at a specific
     * door. The resolution was always meant to be a human who checks who they
     * are talking to. This is that human.
     */
    it('unlocks a locked handshake, with a mandatory note', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const ops = await opsSession();
      const { bookingId, technician } = await makeBooking();

      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/accept`)
        .set(auth(technician.accessToken))
        .expect(200);

      // Five wrong codes at the door.
      for (let attempt = 0; attempt < ctx.config.BOOKING_OTP_MAX_ATTEMPTS; attempt += 1) {
        await request(app as Express)
          .post(`/api/v1/bookings/${bookingId}/start`)
          .set(auth(technician.accessToken))
          .send({ otp: '9999' });
      }

      expect(await ctx.redis.exists(bookingOtpKeys.locked(bookingId))).toBe(1);

      // The note is the whole control.
      await request(app as Express)
        .post(`/api/v1/admin/bookings/${bookingId}/otp-unlock`)
        .set(auth(ops.accessToken))
        .send({})
        .expect(400);

      const unlocked = await request(app as Express)
        .post(`/api/v1/admin/bookings/${bookingId}/otp-unlock`)
        .set(auth(ops.accessToken))
        .send({ note: 'Called the customer on the number on file and confirmed identity.' })
        .expect(200);

      expect(unlocked.body.unlocked).toBe(true);
      expect(await ctx.redis.exists(bookingOtpKeys.locked(bookingId))).toBe(0);

      const rows = await auditRows(AUDIT_ACTIONS.bookingOtpUnlock);
      expect(rows[0]!.payload).toMatchObject({
        note: expect.stringContaining('confirmed identity'),
      });

      // And the handshake works again with the real code, which was never changed.
      const startOtp = await ctx.redis.get(`booking:otp:plain:start:${bookingId}`);
      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/start`)
        .set(auth(technician.accessToken))
        .send({ otp: startOtp ?? '0000' })
        .expect(200);
    }, 90_000);

    it('refuses to unlock a booking that is not locked', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();
      const { bookingId } = await makeBooking();

      await request(app as Express)
        .post(`/api/v1/admin/bookings/${bookingId}/otp-unlock`)
        .set(auth(ops.accessToken))
        .send({ note: 'Nothing is actually wrong here.' })
        .expect(409);
    }, 45_000);

    /**
     * Ops-cancel is not a bypass. Once the technician has arrived, work has
     * begun and money may be owed — a button that could make that bill vanish
     * would be a way to lose money quietly.
     */
    it('cancels before arrival and refuses after it', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const ops = await opsSession();
      const { bookingId, technician } = await makeBooking();

      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/accept`)
        .set(auth(technician.accessToken))
        .expect(200);

      await request(app as Express)
        .post(`/api/v1/admin/bookings/${bookingId}/cancel`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Customer phoned the office to cancel.' })
        .expect(200);

      const cancelled = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
      expect(cancelled?.status).toBe('CANCELLED_BY_CUSTOMER');

      // A second booking, taken past the point of no return.
      const second = await makeBooking();

      await request(app as Express)
        .post(`/api/v1/bookings/${second.bookingId}/accept`)
        .set(auth(second.technician.accessToken))
        .expect(200);

      const startOtp = await ctx.redis.get(`booking:otp:plain:start:${second.bookingId}`);
      await request(app as Express)
        .post(`/api/v1/bookings/${second.bookingId}/start`)
        .set(auth(second.technician.accessToken))
        .send({ otp: startOtp ?? '0000' })
        .expect(200);

      await request(app as Express)
        .post(`/api/v1/admin/bookings/${second.bookingId}/cancel`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Trying to cancel a job already under way.' })
        .expect(409);
    }, 90_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Money                                                                  */
  /* ---------------------------------------------------------------------- */

  describe('money ops', () => {
    /**
     * A cash job leaves the technician owing us commission. Settling it posts a
     * balanced journal — there is no balance column anywhere in this system, so
     * the journal *is* the settlement.
     */
    it('records a dues settlement as a balanced journal', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const admin = await adminSession();

      await settledBooking();

      const before = await request(app as Express)
        .get(`/api/v1/admin/providers/${fixture.technicianId}`)
        .set(auth(admin.accessToken))
        .expect(200);

      const owed = before.body.provider.balance.duesPaise;
      expect(owed).toBeGreaterThan(0);

      await request(app as Express)
        .post('/api/v1/admin/payments/dues/settle')
        .set(auth(admin.accessToken))
        .send({
          providerId: fixture.technicianId,
          amountPaise: owed,
          memo: 'Paid by UPI, ref 4471',
        })
        .expect(200);

      const after = await request(app as Express)
        .get(`/api/v1/admin/providers/${fixture.technicianId}`)
        .set(auth(admin.accessToken))
        .expect(200);

      expect(after.body.provider.balance.duesPaise).toBe(0);

      const journals = await ctx.prisma.ledgerJournal.findMany({
        where: { journalType: 'dues_settled' },
        include: { entries: true },
      });

      expect(journals).toHaveLength(1);

      const debits = journals[0]!.entries
        .filter((entry) => entry.direction === 'debit')
        .reduce((sum, entry) => sum + entry.amountPaise, 0);
      const credits = journals[0]!.entries
        .filter((entry) => entry.direction === 'credit')
        .reduce((sum, entry) => sum + entry.amountPaise, 0);

      expect(debits).toBe(credits);
      expect(debits).toBe(owed);

      const rows = await auditRows(AUDIT_ACTIONS.duesSettle, fixture.adminId);
      expect(rows[0]!.payload).toMatchObject({ amountPaise: owed, memo: 'Paid by UPI, ref 4471' });
    }, 120_000);

    /**
     * Mark-paid, then close. The UTR is the substance: it is the number a
     * technician quotes at their bank when they say the money never arrived,
     * so it is mandatory and it lands in the audit row verbatim.
     */
    it('walks a payout from pending to paid, then closes the batch', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const admin = await adminSession();

      const batchId = fixtureUuid('b11');
      const payoutId = fixtureUuid('b12');

      await ctx.prisma.payoutBatch.create({
        data: {
          id: batchId,
          status: 'draft',
          windowEnd: new Date(),
          totalPaise: 12_000,
          payoutCount: 1,
          payouts: {
            create: {
              id: payoutId,
              providerId: fixture.technicianId,
              amountPaise: 12_000,
              status: 'pending',
            },
          },
        },
      });

      // A batch with a pending line cannot be closed — that guard is what stops
      // a run being signed off with somebody unpaid inside it.
      await request(app as Express)
        .post(`/api/v1/admin/payments/payout-batches/${batchId}/close`)
        .set(auth(admin.accessToken))
        .expect(409);

      await request(app as Express)
        .post(`/api/v1/admin/payments/payouts/${payoutId}/paid`)
        .set(auth(admin.accessToken))
        .send({ utrRef: 'HDFC0004471N2026' })
        .expect(200);

      const paid = await ctx.prisma.payout.findUnique({ where: { id: payoutId } });
      expect(paid?.status).toBe('paid');
      expect(paid?.utrRef).toBe('HDFC0004471N2026');

      const paidAudit = await auditRows(AUDIT_ACTIONS.payoutMarkPaid, fixture.adminId);
      expect(paidAudit[0]!.payload).toMatchObject({ utrRef: 'HDFC0004471N2026' });

      // Paying a technician moves money out of what we owe them.
      const journals = await ctx.prisma.ledgerJournal.findMany({
        where: { journalType: 'payout' },
        include: { entries: true },
      });

      expect(journals).toHaveLength(1);
      const debits = journals[0]!.entries
        .filter((entry) => entry.direction === 'debit')
        .reduce((sum, entry) => sum + entry.amountPaise, 0);
      expect(debits).toBe(12_000);

      await request(app as Express)
        .post(`/api/v1/admin/payments/payout-batches/${batchId}/close`)
        .set(auth(admin.accessToken))
        .expect(200);

      const closed = await ctx.prisma.payoutBatch.findUnique({ where: { id: batchId } });
      expect(closed?.status).toBe('completed');
      expect(await auditRows(AUDIT_ACTIONS.payoutBatchClose, fixture.adminId)).toHaveLength(1);

      const batches = await request(app as Express)
        .get('/api/v1/admin/payout-batches')
        .set(auth(admin.accessToken))
        .expect(200);

      expect(batches.body.batches.some((row: { id: string }) => row.id === batchId)).toBe(true);
    }, 120_000);

    it('reads the ledger, and every journal balances', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();
      await settledBooking();

      const list = await request(app as Express)
        .get('/api/v1/admin/ledger/journals')
        .set(auth(ops.accessToken))
        .expect(200);

      expect(list.body.total).toBeGreaterThan(0);

      const detail = await request(app as Express)
        .get(`/api/v1/admin/ledger/journals/${list.body.journals[0].id}`)
        .set(auth(ops.accessToken))
        .expect(200);

      const entries = detail.body.journal.entries as {
        direction: string;
        amountPaise: number;
      }[];

      const debits = entries
        .filter((entry) => entry.direction === 'debit')
        .reduce((sum, entry) => sum + entry.amountPaise, 0);
      const credits = entries
        .filter((entry) => entry.direction === 'credit')
        .reduce((sum, entry) => sum + entry.amountPaise, 0);

      expect(debits).toBe(credits);
    }, 90_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Queues                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('parked queues', () => {
    /**
     * Parked means the retry budget is spent, not that the row was dropped.
     * Every one of these three tables keeps its failures on purpose — this is
     * the human finally getting to see them.
     */
    it('lists a parked outbox event and puts it back in the dispatcher’s path', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const ops = await opsSession();

      const parked = await ctx.prisma.outboxEvent.create({
        data: {
          topic: 'test.parked_topic',
          aggregateType: 'booking',
          aggregateId: fixtureUuid('e01'),
          payload: {},
          attempts: ctx.config.OUTBOX_MAX_ATTEMPTS,
          lastError: 'something went wrong repeatedly',
        },
      });

      const list = await request(app as Express)
        .get('/api/v1/admin/queues/outbox')
        .set(auth(ops.accessToken))
        .expect(200);

      expect(list.body.events.some((row: { id: string }) => row.id === parked.id)).toBe(true);

      await request(app as Express)
        .post(`/api/v1/admin/queues/outbox/${parked.id}/retry`)
        .set(auth(ops.accessToken))
        .expect(200);

      const after = await ctx.prisma.outboxEvent.findUnique({ where: { id: parked.id } });

      // Attempts reset, not the schedule nudged: a human has asserted the cause
      // is fixed, and every consumer is idempotent.
      expect(after?.attempts).toBe(0);
      expect(after?.lastError).toBeNull();

      const rows = await auditRows(AUDIT_ACTIONS.outboxRetry);
      expect(rows).toHaveLength(1);

      await ctx.prisma.outboxEvent.delete({ where: { id: parked.id } });
    }, 60_000);

    it('discards with a reason, keeping the row as evidence', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const ops = await opsSession();

      const parked = await ctx.prisma.outboxEvent.create({
        data: {
          topic: 'test.parked_topic',
          aggregateType: 'booking',
          aggregateId: fixtureUuid('e02'),
          payload: {},
          attempts: ctx.config.OUTBOX_MAX_ATTEMPTS,
          lastError: 'permanently broken',
        },
      });

      await request(app as Express)
        .post(`/api/v1/admin/queues/outbox/${parked.id}/discard`)
        .set(auth(ops.accessToken))
        .send({ reason: 'Topic was removed in Phase 11; nothing consumes it.' })
        .expect(200);

      const after = await ctx.prisma.outboxEvent.findUnique({ where: { id: parked.id } });

      // Marked processed, never deleted — the row is the evidence that something
      // was published and never delivered.
      expect(after).not.toBeNull();
      expect(after?.processedAt).not.toBeNull();
      expect(after?.lastError).toContain('discarded by ops');

      await ctx.prisma.outboxEvent.delete({ where: { id: parked.id } });
    }, 60_000);

    it('retries a parked notification delivery and actually sends it', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const ops = await opsSession();

      // A real booking notification, then broken on purpose.
      await makeBooking();
      await drainOutbox();

      const delivery = await ctx.prisma.notificationDelivery.findFirst({
        where: { channel: 'whatsapp', recipientUserId: fixture.technicianId },
      });

      expect(delivery).not.toBeNull();

      await ctx.prisma.notificationDelivery.update({
        where: { id: delivery!.id },
        data: {
          status: 'failed',
          attempts: ctx.config.NOTIFY_MAX_ATTEMPTS,
          lastError: 'vendor was down',
        },
      });

      const list = await request(app as Express)
        .get('/api/v1/admin/queues/deliveries')
        .set(auth(ops.accessToken))
        .expect(200);

      expect(list.body.deliveries.some((row: { id: string }) => row.id === delivery!.id)).toBe(
        true,
      );

      whatsapp?.reset();

      const retried = await request(app as Express)
        .post(`/api/v1/admin/queues/deliveries/${delivery!.id}/retry`)
        .set(auth(ops.accessToken))
        .expect(200);

      expect(retried.body.sent).toBe(true);
      expect(whatsapp!.sent.length).toBe(1);

      const after = await ctx.prisma.notificationDelivery.findUnique({
        where: { id: delivery!.id },
      });

      expect(after?.status).toBe('sent');
    }, 90_000);

    it('lists failed webhooks and re-queues one for the processor', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const ops = await opsSession();

      const webhook = await ctx.prisma.webhookEvent.create({
        data: {
          gateway: 'razorpay',
          gatewayEventId: `evt_admin_test_${Date.now()}`,
          eventType: 'payment.captured',
          payload: {},
          processingError: 'payment not found',
        },
      });

      const list = await request(app as Express)
        .get('/api/v1/admin/queues/webhooks')
        .set(auth(ops.accessToken))
        .expect(200);

      expect(list.body.webhooks.some((row: { id: string }) => row.id === webhook.id)).toBe(true);

      await request(app as Express)
        .post(`/api/v1/admin/queues/webhooks/${webhook.id}/reprocess`)
        .set(auth(ops.accessToken))
        .expect(200);

      const after = await ctx.prisma.webhookEvent.findUnique({ where: { id: webhook.id } });
      expect(after?.processingError).toBeNull();

      // Re-published rather than applied inline: a gateway's budget is seconds
      // and ledger work does not belong inside it.
      const requeued = await ctx.prisma.outboxEvent.findFirst({
        where: { topic: 'webhook.received', aggregateId: webhook.id },
      });

      expect(requeued).not.toBeNull();

      await ctx.prisma.outboxEvent.deleteMany({ where: { aggregateId: webhook.id } });
      await ctx.prisma.webhookEvent.delete({ where: { id: webhook.id } });
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Reviews                                                                */
  /* ---------------------------------------------------------------------- */

  describe('review moderation', () => {
    it('hides a reported review and drops it out of the aggregate', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const ops = await opsSession();

      const bookingId = await settledBooking();
      const customer = await signIn(app as Express, PHONES.customer, 'device-admin-cust');

      await request(app as Express)
        .post(`/api/v1/bookings/${bookingId}/reviews`)
        .set(auth(customer.accessToken))
        .send({ stars: 1, tags: [], text: 'Rude and left a mess.' })
        .expect(201);

      await drainOutbox();

      const before = await ctx.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });

      expect(before?.avgStars).toBe(1);

      const review = await ctx.prisma.review.findFirst({ where: { bookingId } });

      await request(app as Express)
        .post(`/api/v1/reviews/${review!.id}/report`)
        .set(auth(customer.accessToken))
        .send({ reason: 'This is not about the work at all.' })
        .expect(202);

      const reports = await request(app as Express)
        .get('/api/v1/admin/reviews/reports')
        .set(auth(ops.accessToken))
        .expect(200);

      expect(reports.body.total).toBeGreaterThan(0);

      await request(app as Express)
        .post(`/api/v1/admin/reviews/${review!.id}/hide`)
        .set(auth(ops.accessToken))
        .expect(200);

      await drainOutbox();

      const after = await ctx.prisma.providerStats.findUnique({
        where: { providerId: fixture.technicianId },
      });

      // Hidden reviews are excluded because the recompute simply does not select
      // them — there is no "subtract from the average" step to get wrong.
      expect(after?.avgStars).toBeNull();
      expect(after?.reviewCount).toBe(0);

      const rows = await auditRows(AUDIT_ACTIONS.reviewHide);
      expect(rows).toHaveLength(1);
    }, 120_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Overview and cities                                                    */
  /* ---------------------------------------------------------------------- */

  describe('the overview', () => {
    it('answers "what needs my attention" in one request', async () => {
      if (unavailableReason || !fixture) return;

      const ops = await opsSession();

      const response = await request(app as Express)
        .get('/api/v1/admin/summary')
        .set(auth(ops.accessToken))
        .expect(200);

      const body = response.body;

      for (const key of [
        'verificationPending',
        'complaintsOpen',
        'reviewReports',
        'parkedOutbox',
        'parkedWebhooks',
        'parkedDeliveries',
        'otpLockedBookings',
        'suspendedProviders',
        'pendingEntryApproval',
      ]) {
        expect(typeof body.queues[key], key).toBe('number');
      }

      expect(typeof body.money.gmvTodayPaise).toBe('number');
      expect(typeof body.money.revenuePaise).toBe('number');
      expect(typeof body.bookings.todayTotal).toBe('number');
    }, 45_000);
  });

  describe('city settings', () => {
    /**
     * The entry-approval flag, and the two roles it needs.
     *
     * This is the split in one test, and the division of labour is the point:
     * **admin** decides that a city needs a human in the path of every signup —
     * a policy change about how the marketplace runs — and **ops** then works
     * the queue that policy creates, one technician at a time. Neither could do
     * the other's half, and that is deliberate.
     *
     * The flag is off everywhere today, and the queue it feeds is simply empty
     * when off, which is why the feature costs nothing until the first city
     * where we do not know the trades personally.
     */
    it('turns entry approval on as admin, and ops works the queue it fills', async () => {
      if (unavailableReason || !fixture) return;

      const ctx = context as AppContext;
      const admin = await adminSession();
      const ops = await opsSession();

      const emptyQueue = await request(app as Express)
        .get('/api/v1/admin/providers')
        .query({ pending_approval: 'true' })
        .set(auth(ops.accessToken))
        .expect(200);

      expect(emptyQueue.body.total).toBe(0);

      // Ops cannot set the policy, however much of the queue they work.
      await request(app as Express)
        .patch(`/api/v1/admin/cities/${fixture.cityId}`)
        .set(auth(ops.accessToken))
        .send({ requireEntryApproval: true })
        .expect(403);

      await request(app as Express)
        .patch(`/api/v1/admin/cities/${fixture.cityId}`)
        .set(auth(admin.accessToken))
        .send({ requireEntryApproval: true })
        .expect(200);

      try {
        const queue = await request(app as Express)
          .get('/api/v1/admin/providers')
          .query({ pending_approval: 'true' })
          .set(auth(ops.accessToken))
          .expect(200);

        expect(queue.body.total).toBeGreaterThan(0);

        // …and approving an individual technician is squarely ops work.
        await request(app as Express)
          .post(`/api/v1/admin/providers/${fixture.technicianId}/approve-entry`)
          .set(auth(ops.accessToken))
          .send({ note: 'Met them at the shop; they are who they say they are.' })
          .expect(200);

        const approved = await ctx.prisma.providerProfile.findUnique({
          where: { userId: fixture.technicianId },
        });

        expect(approved?.entryApprovedAt).not.toBeNull();
        expect(approved?.entryApprovedById).toBe(fixture.opsId);

        // Each half is recorded against the person who actually did it.
        expect(await auditRows(AUDIT_ACTIONS.cityUpdateSettings, fixture.adminId)).toHaveLength(1);
        expect(await auditRows(AUDIT_ACTIONS.providerApproveEntry, fixture.opsId)).toHaveLength(1);
      } finally {
        // Back off again: every other suite assumes the pilot's default.
        await ctx.prisma.city.update({
          where: { id: fixture.cityId },
          data: { requireEntryApproval: false },
        });
        await ctx.prisma.providerProfile.updateMany({
          where: { userId: fixture.technicianId },
          data: { entryApprovedAt: null, entryApprovedById: null },
        });
      }
    }, 90_000);
  });
});
