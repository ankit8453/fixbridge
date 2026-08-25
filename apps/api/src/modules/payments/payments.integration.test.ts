import { createHmac } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedPayments } from '../../../prisma/seeds/payments';
import { createApp } from '../../app';
import { registerOutboxSubscribers } from '../../core/background';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { createOutboxDispatcher } from '../../core/outbox';
import { purgeBookingData } from '../bookings/repository';
import { generateSlotsForProvider } from '../bookings/slots-service';
import { asFakeGateway, type FakeGateway } from './gateway';
import * as ledger from './ledger';
import * as payouts from './payouts';
import { PAYMENT_TOPICS } from './state-machine';

/**
 * Phase 8 against real Postgres and Redis, and the fake gateway.
 *
 * The three tests this phase exists to pass are all here and all labelled:
 * an unbalanced journal cannot commit, a replayed webhook posts once, and a
 * customer whose browser died still gets their booking settled.
 */

const FIXED_OTP = '000000';
const PHONES = {
  technician: '+919999908001',
  otherTechnician: '+919999908002',
  customer: '+919999908010',
  money: '+919999908020',
};

const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };

/** ₹180 flat rate. Every payable below is this plus the visit fee. */
const FIXED_PRICE_PAISE = 18_000;

let app: Express | undefined;
let context: AppContext | undefined;
let gateway: FakeGateway | undefined;
let unavailableReason: string | undefined;

interface Fixture {
  technicianId: string;
  otherTechnicianId: string;
  customerId: string;
  opsId: string;
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

/** See the Phase 6 suite: no hyphenated UUID literals in source. */
const fixtureUuid = (suffix: string): string =>
  ['00000000', '0000', '4000', 'a000', suffix.padStart(12, '0')].join('-');

async function signIn(server: Express, phone: string, deviceId = 'device-pay') {
  await request(server).post('/api/v1/auth/otp/request').send({ phone });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; user: { id: string } };
}

async function clearMoney(ctx: AppContext, userIds: string[]): Promise<void> {
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
   * Ledger rows are cleared with `TRUNCATE`, because they cannot be DELETEd —
   * the immutability trigger has no purge escape hatch, deliberately. Truncate
   * bypasses row triggers, which is exactly the sledgehammer a test teardown
   * needs and exactly what production must never have.
   */
  await ctx.prisma.$executeRawUnsafe('TRUNCATE ledger_entries, ledger_journals CASCADE');

  if (paymentIds.length > 0) {
    await ctx.prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await ctx.prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }

  await ctx.prisma.payout.deleteMany({ where: { providerId: { in: userIds } } });
  await ctx.prisma.payoutBatch.deleteMany({ where: { payouts: { none: {} } } });
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

  await clearMoney(ctx, ids);
  await ctx.prisma.user.deleteMany({ where: { id: { in: ids } } });
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
    update: { isListed: true, completenessScore: 100, cityId, serviceRadiusKm: 10 },
    create: {
      userId,
      displayName: 'Payment Test Technician',
      yearsExperience: 8,
      cityId,
      serviceRadiusKm: 10,
      completenessScore: 100,
      isListed: true,
    },
  });

  await ctx.prisma.providerProfile.update({
    where: { userId: userId },
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

  /**
   * The same registration `index.ts` performs at boot.
   *
   * Called explicitly rather than relying on a side effect, so these tests
   * exercise the real handlers on the real registry — a webhook that is recorded
   * but never processed is precisely the failure mode this phase must not have.
   */
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

  const customer = await signIn(app, PHONES.customer, 'device-pay-cust');
  const money = await signIn(app, PHONES.money, 'device-pay-ops');

  /**
   * Both roles, because this suite's actor is whoever runs money.
   *
   * Phase 12 split ops from admin on reversibility: refunds, marking a payout
   * paid and recording a dues settlement all became `admin`, while reading the
   * platform's position stayed `ops`. This file exercises both, and it is about
   * ledger correctness rather than authorization — the enumerated ops-is-refused
   * test lives with the admin module, where it can walk the whole route list.
   */
  for (const role of ['ops', 'admin'] as const) {
    await context.prisma.userRole.upsert({
      where: { userId_role: { userId: money.user.id, role } },
      update: {},
      create: { userId: money.user.id, role },
    });
  }

  const addressId = fixtureUuid('a01');
  await context.prisma.address.upsert({
    where: { id: addressId },
    update: {},
    create: {
      id: addressId,
      userId: customer.user.id,
      label: 'home',
      addressText: '7, Ledger Lane, Wright Town',
      landmark: 'Opposite the bank',
      cityId: city.id,
      lat: WRIGHT_TOWN.lat,
      lng: WRIGHT_TOWN.lng,
      isDefault: true,
    },
  });

  fixture = {
    technicianId: tech.userId,
    otherTechnicianId: other.userId,
    customerId: customer.user.id,
    opsId: money.user.id,
    addressId,
    cityId: city.id,
    categoryId: category.id,
    priceCardId: tech.priceCardId,
  };
}, 120_000);

beforeEach(async () => {
  if (!context || !fixture || unavailableReason) return;

  gateway?.reset();

  await clearMoney(context, [fixture.technicianId, fixture.otherTechnicianId, fixture.customerId]);

  await context.prisma.commissionConfig.deleteMany({
    where: { rateBps: { in: [2_500, 4_000] } },
  });

  await generateSlotsForProvider(context, fixture.technicianId);
  await generateSlotsForProvider(context, fixture.otherTechnicianId);
});

/**
 * Puts the seeded books back.
 *
 * `TRUNCATE` is the only way to clear ledger rows — they cannot be DELETEd, by
 * design — and truncate is global, so this suite unavoidably wipes the seeded
 * ledger along with its own. Re-running the real seed afterwards restores it,
 * which keeps the seed-audit suite honest and leaves a developer's database as
 * they left it rather than mysteriously empty.
 */
async function restoreSeededLedger(ctx: AppContext, cityId: number): Promise<void> {
  await ctx.prisma.refund.deleteMany({});
  await ctx.prisma.payment.deleteMany({});
  await ctx.prisma.payout.deleteMany({});
  await ctx.prisma.payoutBatch.deleteMany({});
  await ctx.prisma.$executeRawUnsafe('TRUNCATE ledger_entries, ledger_journals CASCADE');
  await ctx.prisma.$executeRawUnsafe('DELETE FROM accounts');

  await seedPayments(ctx.prisma, cityId);
}

afterAll(async () => {
  if (context && !unavailableReason && fixture) {
    await purgeFixture(context);
    await restoreSeededLedger(context, fixture.cityId);
  }

  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] Phase 8 payment tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface Session {
  accessToken: string;
  user: { id: string };
}

/** Drives a flat-rate booking all the way to WORK_DONE with a frozen payable. */
async function completedBooking(
  which: 'technician' | 'otherTechnician' = 'technician',
  skip = 0,
): Promise<{ bookingId: string; payablePaise: number; customer: Session; technician: Session }> {
  const ctx = context as AppContext;
  const server = app as Express;
  const fix = fixture as Fixture;

  const providerId = which === 'technician' ? fix.technicianId : fix.otherTechnicianId;
  const priceCardId = which === 'technician' ? fix.priceCardId : fixtureUuid('c02');

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

  const customer = await signIn(server, PHONES.customer, 'device-pay-cust');
  const technician = await signIn(
    server,
    which === 'technician' ? PHONES.technician : PHONES.otherTechnician,
    'device-pay-tech',
  );

  const created = await request(server)
    .post('/api/v1/bookings')
    .set(auth(customer.accessToken))
    .send({
      slotId: slot.id,
      categoryId: fix.categoryId,
      addressId: fix.addressId,
      priceCardId,
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
 * Posts a signed webhook exactly as the gateway would.
 *
 * Not `async`, so the supertest chain (`.expect(...)`) survives — and the body
 * goes as a **string**, not a Buffer: superagent JSON-stringifies a Buffer under
 * an `application/json` content type, which turns it into
 * `{"type":"Buffer","data":[…]}` and breaks the signature. A string is passed
 * through untouched, which is the whole point of this test file.
 */
function deliverWebhook(
  eventType: string,
  entity: Record<string, unknown>,
  options: { eventId?: string } = {},
) {
  const fake = gateway as FakeGateway;
  const { raw, signature, eventId } = fake.webhookBody(eventType, entity, options);
  const deliveredId = options.eventId ?? eventId;

  return request(app as Express)
    .post('/api/v1/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', signature)
    .set('X-Razorpay-Event-Id', deliveredId)
    .send(raw.toString('utf8'));
}

/**
 * Runs the outbox until there is nothing left, so queued webhook work happens.
 *
 * A loop, not a single pass: a batch is `OUTBOX_BATCH_SIZE` rows oldest-first,
 * and every booking in a test writes half a dozen events of its own. One pass
 * would leave a freshly-written webhook row sitting behind them — which is a
 * property of the test, not of the dispatcher, since in production it runs every
 * two seconds forever.
 */
async function drainOutbox(): Promise<void> {
  const ctx = context as AppContext;

  const dispatcher = createOutboxDispatcher({
    prisma: ctx.prisma,
    redis: ctx.redis,
    config: ctx.config,
    logger: ctx.logger,
    registry: ctx.outbox,
    // Postgres and the host clock drift a few milliseconds; see the Phase 6 note.
    now: () => new Date(Date.now() + 5_000),
  });

  await ctx.redis.del('outbox:dispatcher:lock');

  // Bounded, so a permanently-failing row cannot spin here forever.
  for (let pass = 0; pass < 20; pass += 1) {
    const result = await dispatcher.runOnce();
    if (result.claimed === 0) return;
  }
}

/** Pays a booking online, end to end, through the webhook. */
async function payOnline(
  bookingId: string,
  customer: Session,
): Promise<{ paymentId: string; orderId: string; gatewayPaymentId: string }> {
  const server = app as Express;

  const started = await request(server)
    .post(`/api/v1/bookings/${bookingId}/payments`)
    .set(auth(customer.accessToken))
    .send({})
    .expect(201);

  const orderId = started.body.orderId as string;
  const captured = (gateway as FakeGateway).captureOrder(orderId);

  await deliverWebhook('payment.captured', {
    id: captured.paymentId,
    order_id: orderId,
    amount: captured.amountPaise,
  }).expect(200);

  await drainOutbox();

  return {
    paymentId: started.body.payment.id as string,
    orderId,
    gatewayPaymentId: captured.paymentId,
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('Phase 8 — payments, ledger and payouts', () => {
  it('has a working environment', () => {
    if (unavailableReason) {
      console.warn(SKIP(unavailableReason));
      expect(unavailableReason).toBeTruthy();
      return;
    }

    expect(fixture).toBeDefined();
    // Every test in this file runs on the fake. CI never touches Razorpay.
    expect(context?.gateway.name).toBe('fake');
  });

  /* ---------------------------------------------------------------------- */
  /* NON-NEGOTIABLE #1 — an unbalanced journal cannot commit                 */
  /* ---------------------------------------------------------------------- */

  describe('the ledger refuses to be wrong', () => {
    it('will not commit a journal whose debits and credits differ', async () => {
      if (unavailableReason || !context) return;

      const accounts = await seedAccounts(context);

      // Straight past the service, straight into the deferred constraint.
      await expect(
        context.prisma.$transaction(async (tx) => {
          const journal = await tx.ledgerJournal.create({
            data: { journalType: 'adjustment', memo: 'deliberately wrong' },
          });

          await tx.ledgerEntry.create({
            data: {
              journalId: journal.id,
              accountId: accounts.gatewayCash,
              direction: 'debit',
              amountPaise: 500,
            },
          });

          await tx.ledgerEntry.create({
            data: {
              journalId: journal.id,
              accountId: accounts.revenue,
              direction: 'credit',
              // One paisa out. That is all it takes.
              amountPaise: 499,
            },
          });
        }),
      ).rejects.toThrow(/does not balance/);

      expect(
        await context.prisma.ledgerJournal.count({ where: { memo: 'deliberately wrong' } }),
      ).toBe(0);
    });

    it('will not commit a journal with no entries at all', async () => {
      if (unavailableReason || !context) return;

      await expect(
        context.prisma.ledgerJournal.create({
          data: { journalType: 'adjustment', memo: 'empty' },
        }),
      ).rejects.toThrow(/double entry needs at least two/);
    });

    it('commits a journal that balances to the paisa', async () => {
      if (unavailableReason || !context) return;

      const accounts = await seedAccounts(context);

      await context.prisma.$transaction(async (tx) => {
        const journal = await tx.ledgerJournal.create({
          data: { journalType: 'adjustment', memo: 'balanced' },
        });

        await tx.ledgerEntry.create({
          data: {
            journalId: journal.id,
            accountId: accounts.gatewayCash,
            direction: 'debit',
            amountPaise: 500,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            journalId: journal.id,
            accountId: accounts.revenue,
            direction: 'credit',
            amountPaise: 500,
          },
        });
      });

      const position = await ledger.platformPosition(context.prisma);
      expect(position.gatewayCashPaise).toBe(500);
      expect(position.revenuePaise).toBe(500);
    });

    it('refuses a zero or negative entry', async () => {
      if (unavailableReason || !context) return;

      const accounts = await seedAccounts(context);

      for (const amount of [0, -100]) {
        await expect(
          context.prisma.$transaction(async (tx) => {
            const journal = await tx.ledgerJournal.create({
              data: { journalType: 'adjustment', memo: 'bad amount' },
            });

            await tx.ledgerEntry.create({
              data: {
                journalId: journal.id,
                accountId: accounts.gatewayCash,
                direction: 'debit',
                amountPaise: amount,
              },
            });
            await tx.ledgerEntry.create({
              data: {
                journalId: journal.id,
                accountId: accounts.revenue,
                direction: 'credit',
                amountPaise: amount,
              },
            });
          }),
        ).rejects.toThrow(/ledger_entries_amount_check/);
      }
    });

    /**
     * No purge escape hatch, deliberately. Bookings and KYC allow DELETE under
     * the DPDP flag because they describe a person; money does not.
     */
    it('refuses UPDATE and DELETE even with the erasure flag set', async () => {
      if (unavailableReason || !context) return;

      const accounts = await seedAccounts(context);

      const journalId = await context.prisma.$transaction(async (tx) => {
        const journal = await tx.ledgerJournal.create({
          data: { journalType: 'adjustment', memo: 'immutable' },
        });

        await tx.ledgerEntry.create({
          data: {
            journalId: journal.id,
            accountId: accounts.gatewayCash,
            direction: 'debit',
            amountPaise: 100,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            journalId: journal.id,
            accountId: accounts.revenue,
            direction: 'credit',
            amountPaise: 100,
          },
        });

        return journal.id;
      });

      await expect(
        context.prisma
          .$executeRaw`UPDATE ledger_journals SET memo = 'edited' WHERE id = ${journalId}::uuid`,
      ).rejects.toThrow(/immutable/i);

      await expect(
        context.prisma
          .$executeRaw`UPDATE ledger_entries SET amount_paise = 1 WHERE journal_id = ${journalId}::uuid`,
      ).rejects.toThrow(/immutable/i);

      await expect(
        context.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL "fixbridge.allow_kyc_purge" = 'on'`);
          await tx.$executeRaw`DELETE FROM ledger_journals WHERE id = ${journalId}::uuid`;
        }),
      ).rejects.toThrow(/immutable/i);
    });

    /**
     * The one exception, and its exact edge.
     *
     * Erasing a person must remove their booking and leave the money — which is
     * an `ON DELETE SET NULL`, which is an UPDATE. So the guard permits a link
     * going to NULL and nothing else. Re-pointing a journal at a *different*
     * booking would be an audit trail being rewritten, and is refused.
     */
    it('lets erasure cut the link to a booking, but not repoint it', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await completedBooking();
      await payOnline(bookingId, customer);

      const journal = await context.prisma.ledgerJournal.findFirst({ where: { bookingId } });
      expect(journal?.bookingId).toBe(bookingId);

      const other = await completedBooking('otherTechnician', 0);

      await expect(
        context.prisma
          .$executeRaw`UPDATE ledger_journals SET booking_id = ${other.bookingId}::uuid WHERE id = ${journal?.id}::uuid`,
      ).rejects.toThrow(/only booking_id and payment_id may be cleared/);

      // Erasing the customer takes the booking with it, and the money stays.
      await purgeBookingData(context.prisma, [fixture.customerId]);

      const survived = await context.prisma.ledgerJournal.findUnique({
        where: { id: journal?.id as string },
        include: { entries: true },
      });

      expect(survived).not.toBeNull();
      expect(survived?.bookingId).toBeNull();
      expect(survived?.entries.length).toBeGreaterThan(0);
    }, 60_000);
  });

  /* ---------------------------------------------------------------------- */
  /* NON-NEGOTIABLE #2 — a replayed webhook posts once                      */
  /* ---------------------------------------------------------------------- */

  describe('webhooks', () => {
    it('rejects a body whose signature does not match', async () => {
      if (unavailableReason || !app) return;

      const response = await request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', 'not-a-signature')
        .send(Buffer.from('{"event":"payment.captured"}', 'utf8'));

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    });

    /**
     * The classic body-parser bug, tested directly.
     *
     * The signature is over the exact bytes. If `express.json()` ever got to the
     * body first, verification would be computed over a re-serialised object and
     * every webhook would fail — so the body here has awkward key order and odd
     * whitespace that no re-serialisation would reproduce.
     */
    it('verifies against the exact bytes Express received, not a reparse', async () => {
      if (unavailableReason || !app || !context) return;

      const awkward =
        '{"payload"  :{"payment":{"entity":{"amount":100,"order_id":"order_zzz","id":"pay_zzz"}}},\n  "event":"payment.captured"}';

      const raw = Buffer.from(awkward, 'utf8');
      const signature = createHmac('sha256', 'fake-webhook-secret').update(awkward).digest('hex');

      // Proof the bytes matter: re-serialising changes them.
      expect(JSON.stringify(JSON.parse(awkward))).not.toBe(awkward);

      const response = await request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', signature)
        .set('X-Razorpay-Event-Id', 'evt_exactbytes')
        .send(raw.toString('utf8'));

      expect(response.status).toBe(200);
    });

    it('posts exactly one journal however many times the same event arrives', async () => {
      if (unavailableReason || !context || !fixture || !app || !gateway) return;

      const { bookingId, payablePaise, customer } = await completedBooking();

      const started = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(201);

      const orderId = started.body.orderId as string;
      const captured = gateway.captureOrder(orderId);

      const entity = { id: captured.paymentId, order_id: orderId, amount: payablePaise };

      // Three deliveries of the same event, as a gateway retry storm would send.
      const first = await deliverWebhook('payment.captured', entity, { eventId: 'evt_replay' });
      const second = await deliverWebhook('payment.captured', entity, { eventId: 'evt_replay' });
      const third = await deliverWebhook('payment.captured', entity, { eventId: 'evt_replay' });

      expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
      expect(first.body.duplicate).toBe(false);
      expect(second.body.duplicate).toBe(true);
      expect(third.body.duplicate).toBe(true);

      // Drain more than once too: our own outbox is at-least-once.
      await drainOutbox();
      await drainOutbox();

      const journals = await context.prisma.ledgerJournal.count({
        where: { bookingId, journalType: 'payment_captured' },
      });
      expect(journals).toBe(1);

      expect(
        await context.prisma.webhookEvent.count({ where: { gatewayEventId: 'evt_replay' } }),
      ).toBe(1);

      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      // 12% of the payable, rounded down, to us; the rest to them. Once.
      const commission = Math.floor((payablePaise * 1_200) / 10_000);
      expect(balance.payablePaise).toBe(payablePaise - commission);
    }, 40_000);

    it('parks an event whose amount does not match the frozen payable', async () => {
      if (unavailableReason || !context || !fixture || !app || !gateway) return;

      const { bookingId, payablePaise, customer } = await completedBooking();

      const started = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(201);

      const orderId = started.body.orderId as string;
      const captured = gateway.captureOrder(orderId);

      // The gateway says a different number. Nothing may move on that.
      await deliverWebhook(
        'payment.captured',
        { id: captured.paymentId, order_id: orderId, amount: payablePaise + 100 },
        { eventId: 'evt_mismatch' },
      ).expect(200);

      await drainOutbox();

      const event = await context.prisma.webhookEvent.findUnique({
        where: { gatewayEventId: 'evt_mismatch' },
      });

      expect(event?.processingError).toMatch(/amount mismatch/);
      expect(event?.processedAt).toBeNull();

      expect(await context.prisma.ledgerJournal.count({ where: { bookingId } })).toBe(0);

      const payment = await context.prisma.payment.findUnique({
        where: { id: started.body.payment.id },
      });
      expect(payment?.status).toBe('created');
    }, 30_000);

    it('records and acknowledges an event type it does not act on', async () => {
      if (unavailableReason || !context) return;

      await deliverWebhook('order.paid', { id: 'order_x' }, { eventId: 'evt_ignored' }).expect(200);
      await drainOutbox();

      const event = await context.prisma.webhookEvent.findUnique({
        where: { gatewayEventId: 'evt_ignored' },
      });

      expect(event?.processedAt).not.toBeNull();
      expect(event?.processingError).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NON-NEGOTIABLE #3 — the browser died                                   */
  /* ---------------------------------------------------------------------- */

  describe('the browser closed after paying', () => {
    /**
     * The single most common real-world payment failure: the customer's UPI app
     * says success, they lock their phone, and the callback never fires. The
     * webhook is server-to-server and arrives anyway — so the booking settles
     * with no callback at all.
     */
    it('settles the booking from the webhook alone, with no callback', async () => {
      if (unavailableReason || !context || !fixture || !app || !gateway) return;

      const { bookingId, payablePaise, customer } = await completedBooking();

      const started = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(201);

      const paymentId = started.body.payment.id as string;
      const orderId = started.body.orderId as string;
      const captured = gateway.captureOrder(orderId);

      // No `/checkout-callback` call. The phone is in a pocket.
      await deliverWebhook('payment.captured', {
        id: captured.paymentId,
        order_id: orderId,
        amount: payablePaise,
      }).expect(200);

      await drainOutbox();

      const payment = await context.prisma.payment.findUnique({ where: { id: paymentId } });

      expect(payment?.status).toBe('captured');
      expect(payment?.capturedAt).not.toBeNull();
      // Never verified by a browser, and it did not matter.
      expect(payment?.checkoutVerifiedAt).toBeNull();

      const commission = Math.floor((payablePaise * 1_200) / 10_000);
      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.payablePaise).toBe(payablePaise - commission);
    }, 30_000);

    it('lets the callback verify without moving a single paisa', async () => {
      if (unavailableReason || !context || !fixture || !app || !gateway) return;

      const { bookingId, customer } = await completedBooking();

      const started = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(201);

      const paymentId = started.body.payment.id as string;
      const orderId = started.body.orderId as string;
      const captured = gateway.captureOrder(orderId);

      const signature = createHmac('sha256', 'fake-key-secret')
        .update(`${orderId}|${captured.paymentId}`)
        .digest('hex');

      const callback = await request(app)
        .post(`/api/v1/payments/${paymentId}/checkout-callback`)
        .set(auth(customer.accessToken))
        .send({
          razorpay_order_id: orderId,
          razorpay_payment_id: captured.paymentId,
          razorpay_signature: signature,
        })
        .expect(200);

      expect(callback.body.payment.checkoutVerifiedAt).not.toBeNull();
      // Still `created`. The app may say "confirming"; the books say nothing yet.
      expect(callback.body.payment.status).toBe('created');
      expect(await context.prisma.ledgerJournal.count({ where: { bookingId } })).toBe(0);

      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.payablePaise).toBe(0);
    }, 30_000);

    it('refuses a forged callback signature', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await completedBooking();

      const started = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(201);

      const response = await request(app)
        .post(`/api/v1/payments/${started.body.payment.id}/checkout-callback`)
        .set(auth(customer.accessToken))
        .send({
          razorpay_order_id: started.body.orderId,
          razorpay_payment_id: 'pay_forged',
          razorpay_signature: 'f'.repeat(64),
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Online rail                                                            */
  /* ---------------------------------------------------------------------- */

  describe('online rail', () => {
    it('returns the same order when a customer taps pay twice', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await completedBooking();

      const first = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(201);

      const second = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(200);

      // Two live orders for one bill is how a customer pays twice.
      expect(second.body.orderId).toBe(first.body.orderId);
      expect(second.body.reused).toBe(true);
      expect(await context.prisma.payment.count({ where: { bookingId } })).toBe(1);
    }, 30_000);

    it('posts the capture journal in the shape the docs promise', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, payablePaise, customer } = await completedBooking();
      await payOnline(bookingId, customer);

      const journal = await context.prisma.ledgerJournal.findFirst({
        where: { bookingId, journalType: 'payment_captured' },
        include: { entries: { include: { account: true } } },
      });

      const commission = Math.floor((payablePaise * 1_200) / 10_000);
      const lines = (journal?.entries ?? []).map((entry) => ({
        account: entry.account.accountType,
        direction: entry.direction,
        amount: entry.amountPaise,
      }));

      expect(lines).toEqual(
        expect.arrayContaining([
          { account: 'gateway_cash', direction: 'debit', amount: payablePaise },
          { account: 'provider_payable', direction: 'credit', amount: payablePaise - commission },
          { account: 'platform_revenue', direction: 'credit', amount: commission },
        ]),
      );
    }, 30_000);

    it('refuses to start a payment on a booking that owes nothing', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const slot = await context.prisma.slot.findFirst({
        where: {
          providerId: fixture.technicianId,
          status: 'open',
          startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
        },
        orderBy: { startsAt: 'asc' },
      });

      const customer = await signIn(app, PHONES.customer, 'device-unbillable');

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

      const response = await request(app)
        .post(`/api/v1/bookings/${created.body.booking.id}/payments`)
        .set(auth(customer.accessToken))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('BOOKING_NOT_BILLABLE');
    }, 30_000);

    it('will not let the technician pay their own booking', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId } = await completedBooking();
      const technician = await signIn(app, PHONES.technician, 'device-wrongside');

      /**
       * 404, not 403 — and the reason is worth knowing.
       *
       * Every account gets the `customer` role at signup (a technician is
       * usually a customer too), so the role guard lets them through. The
       * ownership check is what stops them: they are not this booking's
       * customer, so as far as the payment path is concerned the booking does
       * not exist. Ownership enforced in the query, not after it.
       */
      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(technician.accessToken))
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('BOOKING_NOT_FOUND');
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Cash rail                                                              */
  /* ---------------------------------------------------------------------- */

  describe('cash rail', () => {
    it('moves only the commission, and records it as dues', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, payablePaise, technician } = await completedBooking();

      const recorded = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments/cash`)
        .set(auth(technician.accessToken))
        .send({ note: 'Customer paid in notes' })
        .expect(201);

      expect(recorded.body.payment.method).toBe('cash');
      expect(recorded.body.payment.status).toBe('captured');

      const commission = Math.floor((payablePaise * 1_200) / 10_000);

      const journal = await context.prisma.ledgerJournal.findFirst({
        where: { bookingId, journalType: 'cash_collected' },
        include: { entries: { include: { account: true } } },
      });

      const lines = (journal?.entries ?? []).map((entry) => ({
        account: entry.account.accountType,
        direction: entry.direction,
        amount: entry.amountPaise,
      }));

      // The gross never touches our books — it went hand to hand.
      expect(lines).toEqual(
        expect.arrayContaining([
          { account: 'provider_dues', direction: 'debit', amount: commission },
          { account: 'platform_revenue', direction: 'credit', amount: commission },
        ]),
      );
      expect(lines.some((line) => line.amount === payablePaise)).toBe(false);

      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.duesPaise).toBe(commission);
      expect(balance.payablePaise).toBe(0);
      expect(balance.netPaise).toBe(-commission);
    }, 30_000);

    it('tells the customer, so silent cash-marking gets sunlight', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await completedBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments/cash`)
        .set(auth(technician.accessToken))
        .send({})
        .expect(201);

      const events = await context.prisma.outboxEvent.findMany({
        where: { aggregateId: bookingId, topic: PAYMENT_TOPICS.cashRecorded },
      });

      expect(events).toHaveLength(1);
    }, 30_000);

    it('accumulates dues across jobs and clears them on settlement', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const first = await completedBooking('technician', 0);
      const second = await completedBooking('technician', 1);

      for (const job of [first, second]) {
        await request(app)
          .post(`/api/v1/bookings/${job.bookingId}/payments/cash`)
          .set(auth(job.technician.accessToken))
          .send({})
          .expect(201);
      }

      const perJob = Math.floor((first.payablePaise * 1_200) / 10_000);
      const owed = perJob * 2;

      let balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.duesPaise).toBe(owed);

      const money = await signIn(app, PHONES.money, 'device-pay-ops');

      // Half now.
      await request(app)
        .post('/api/v1/admin/payments/dues/settle')
        .set(auth(money.accessToken))
        .send({ providerId: fixture.technicianId, amountPaise: perJob })
        .expect(200);

      balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.duesPaise).toBe(owed - perJob);

      // More than is owed is refused.
      const tooMuch = await request(app)
        .post('/api/v1/admin/payments/dues/settle')
        .set(auth(money.accessToken))
        .send({ providerId: fixture.technicianId, amountPaise: owed });

      expect(tooMuch.status).toBe(400);

      // And the rest.
      await request(app)
        .post('/api/v1/admin/payments/dues/settle')
        .set(auth(money.accessToken))
        .send({ providerId: fixture.technicianId, amountPaise: owed - perJob })
        .expect(200);

      balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.duesPaise).toBe(0);
    }, 60_000);

    it('refuses cash on a booking that already has a payment', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await completedBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(201);

      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments/cash`)
        .set(auth(technician.accessToken))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('PAYMENT_ALREADY_SETTLED');
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Refunds                                                                */
  /* ---------------------------------------------------------------------- */

  describe('refunds', () => {
    it('reverses a partial refund out of both pockets, in proportion', async () => {
      if (unavailableReason || !context || !fixture || !app || !gateway) return;

      const { bookingId, payablePaise, customer } = await completedBooking();
      const { paymentId } = await payOnline(bookingId, customer);

      const commission = Math.floor((payablePaise * 1_200) / 10_000);
      const money = await signIn(app, PHONES.money, 'device-pay-ops');

      // Give back ₹50.
      const refundAmount = 5_000;
      const requested = await request(app)
        .post(`/api/v1/admin/payments/${paymentId}/refund`)
        .set(auth(money.accessToken))
        .send({ amountPaise: refundAmount, reason: 'Part of the job was redone' })
        .expect(202);

      // Nothing has moved yet — the gateway has not confirmed.
      let balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.payablePaise).toBe(payablePaise - commission);

      const refundId = (
        await context.prisma.refund.findUnique({ where: { id: requested.body.refund.id } })
      )?.gatewayRefundId as string;

      await deliverWebhook('refund.processed', {
        id: refundId,
        payment_id: 'pay_x',
        amount: refundAmount,
      }).expect(200);

      await drainOutbox();

      const refundCommission = Math.floor((refundAmount * 1_200) / 10_000);
      const refundProvider = refundAmount - refundCommission;

      balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.payablePaise).toBe(payablePaise - commission - refundProvider);

      const position = await ledger.platformPosition(context.prisma);
      expect(position.revenuePaise).toBe(commission - refundCommission);
      expect(position.gatewayCashPaise).toBe(payablePaise - refundAmount);

      const payment = await context.prisma.payment.findUnique({ where: { id: paymentId } });
      expect(payment?.status).toBe('partially_refunded');
    }, 40_000);

    it('marks a payment fully refunded when the whole amount goes back', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, payablePaise, customer } = await completedBooking();
      const { paymentId } = await payOnline(bookingId, customer);

      const money = await signIn(app, PHONES.money, 'device-pay-ops');

      // No amount means "everything still refundable".
      const requested = await request(app)
        .post(`/api/v1/admin/payments/${paymentId}/refund`)
        .set(auth(money.accessToken))
        .send({})
        .expect(202);

      expect(requested.body.refund.amountPaise).toBe(payablePaise);

      const refundId = (
        await context.prisma.refund.findUnique({ where: { id: requested.body.refund.id } })
      )?.gatewayRefundId as string;

      await deliverWebhook('refund.processed', { id: refundId, amount: payablePaise }).expect(200);
      await drainOutbox();

      const payment = await context.prisma.payment.findUnique({ where: { id: paymentId } });
      expect(payment?.status).toBe('refunded');

      // Everything is back where it started.
      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.payablePaise).toBe(0);

      const position = await ledger.platformPosition(context.prisma);
      expect(position.revenuePaise).toBe(0);
      expect(position.gatewayCashPaise).toBe(0);
    }, 40_000);

    it('refuses to refund more than is left', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, payablePaise, customer } = await completedBooking();
      const { paymentId } = await payOnline(bookingId, customer);

      const money = await signIn(app, PHONES.money, 'device-pay-ops');

      const response = await request(app)
        .post(`/api/v1/admin/payments/${paymentId}/refund`)
        .set(auth(money.accessToken))
        .send({ amountPaise: payablePaise + 1 });

      expect(response.status).toBe(400);
    }, 30_000);

    it('will not refund cash through us', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await completedBooking();

      const cash = await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments/cash`)
        .set(auth(technician.accessToken))
        .send({})
        .expect(201);

      const money = await signIn(app, PHONES.money, 'device-pay-ops');

      // We never held that money. Refunding it would mean paying out our own.
      const response = await request(app)
        .post(`/api/v1/admin/payments/${cash.body.payment.id}/refund`)
        .set(auth(money.accessToken))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('REFUND_NOT_POSSIBLE');
    }, 30_000);

    /**
     * A customer cannot refund themselves — which sounds obvious until you
     * notice a refund is the one money movement whose beneficiary is the person
     * asking for it.
     */
    it('refuses a refund to the customer it would pay', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await completedBooking();
      const { paymentId } = await payOnline(bookingId, customer);

      await request(app)
        .post(`/api/v1/admin/payments/${paymentId}/refund`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(403);
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Commission snapshot                                                    */
  /* ---------------------------------------------------------------------- */

  describe('snapshots are immune to config edits', () => {
    it('keeps a captured payment on the rate that applied when it was taken', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, payablePaise, customer } = await completedBooking();
      const { paymentId } = await payOnline(bookingId, customer);

      const commission = Math.floor((payablePaise * 1_200) / 10_000);
      const before = await ledger.platformPosition(context.prisma);
      expect(before.revenuePaise).toBe(commission);

      // Ops double the rate afterwards.
      await context.prisma.commissionConfig.create({
        data: { cityId: fixture.cityId, categoryId: null, rateBps: 2_500 },
      });

      const after = await ledger.platformPosition(context.prisma);
      expect(after.revenuePaise).toBe(commission);

      const payment = await context.prisma.payment.findUnique({ where: { id: paymentId } });
      expect(payment?.commissionBpsSnapshot).toBe(1_200);
    }, 30_000);

    it('keeps the bill on the price card as it was at booking', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const slot = await context.prisma.slot.findFirst({
        where: {
          providerId: fixture.technicianId,
          status: 'open',
          startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
        },
        orderBy: { startsAt: 'asc' },
      });

      const customer = await signIn(app, PHONES.customer, 'device-snapshot-c');
      const technician = await signIn(app, PHONES.technician, 'device-snapshot-t');

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

      const bookingId = created.body.booking.id as string;

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/accept`)
        .set(auth(technician.accessToken))
        .expect(200);

      /**
       * The Phase 7 carry-over, tested: the technician triples their rate while
       * standing in the customer's kitchen. The bill must not notice.
       */
      await context.prisma.providerPriceCard.update({
        where: { id: fixture.priceCardId },
        data: { amountPaise: FIXED_PRICE_PAISE * 3 },
      });

      const startOtp = await context.redis.get(`booking:otp:plain:start:${bookingId}`);
      await request(app)
        .post(`/api/v1/bookings/${bookingId}/start`)
        .set(auth(technician.accessToken))
        .send({ otp: startOtp ?? '0000' })
        .expect(200);

      const endOtp = await context.redis.get(`booking:otp:plain:end:${bookingId}`);
      const done = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: endOtp ?? '0000' })
        .expect(200);

      const booking = await context.prisma.booking.findUnique({ where: { id: bookingId } });
      const visitFee = booking?.visitFeePaise ?? 0;

      expect(done.body.booking.payablePaise).toBe(FIXED_PRICE_PAISE + visitFee);
      expect(booking?.priceCardAmountPaise).toBe(FIXED_PRICE_PAISE);

      // Put it back for the tests that follow.
      await context.prisma.providerPriceCard.update({
        where: { id: fixture.priceCardId },
        data: { amountPaise: FIXED_PRICE_PAISE },
      });
    }, 40_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Payouts and wallet                                                     */
  /* ---------------------------------------------------------------------- */

  describe('payouts', () => {
    it('pays a technician, and their balance drops to zero', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, payablePaise, customer } = await completedBooking();
      await payOnline(bookingId, customer);

      const commission = Math.floor((payablePaise * 1_200) / 10_000);
      const owed = payablePaise - commission;

      const money = await signIn(app, PHONES.money, 'device-pay-ops');

      const drafted = await request(app)
        .post('/api/v1/admin/payments/payout-batches')
        .set(auth(money.accessToken))
        .send({})
        .expect(201);

      expect(drafted.body.totalPaise).toBe(owed);
      expect(drafted.body.payoutCount).toBe(1);

      const batch = await request(app)
        .get(`/api/v1/admin/payments/payout-batches/${drafted.body.batchId}`)
        .set(auth(money.accessToken))
        .expect(200);

      const payoutId = batch.body.batch.payouts[0].id as string;

      await request(app)
        .post(`/api/v1/admin/payments/payouts/${payoutId}/paid`)
        .set(auth(money.accessToken))
        .send({ utrRef: 'UTR123456789' })
        .expect(200);

      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.payablePaise).toBe(0);

      // The money left our account too.
      const position = await ledger.platformPosition(context.prisma);
      expect(position.gatewayCashPaise).toBe(payablePaise - owed);
    }, 40_000);

    it('refuses to mark the same payout paid twice', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await completedBooking();
      await payOnline(bookingId, customer);

      const money = await signIn(app, PHONES.money, 'device-pay-ops');
      const drafted = await request(app)
        .post('/api/v1/admin/payments/payout-batches')
        .set(auth(money.accessToken))
        .send({})
        .expect(201);

      const batch = await request(app)
        .get(`/api/v1/admin/payments/payout-batches/${drafted.body.batchId}`)
        .set(auth(money.accessToken))
        .expect(200);

      const payoutId = batch.body.batch.payouts[0].id as string;

      await request(app)
        .post(`/api/v1/admin/payments/payouts/${payoutId}/paid`)
        .set(auth(money.accessToken))
        .send({ utrRef: 'UTR111' })
        .expect(200);

      const second = await request(app)
        .post(`/api/v1/admin/payments/payouts/${payoutId}/paid`)
        .set(auth(money.accessToken))
        .send({ utrRef: 'UTR222' });

      expect(second.status).toBe(409);

      // And exactly one payout journal exists.
      expect(await context.prisma.ledgerJournal.count({ where: { journalType: 'payout' } })).toBe(
        1,
      );
    }, 40_000);

    it('skips a balance below the minimum and leaves it to roll over', async () => {
      if (unavailableReason || !context || !fixture) return;

      // A tiny credit, well under ₹100. Captured outside the closure so the
      // narrowing above survives into it.
      const technicianId = fixture.technicianId;

      await context.prisma.$transaction(async (tx) => {
        await ledger.post(tx, {
          journalType: 'adjustment',
          memo: 'tiny balance',
          entries: [
            {
              accountType: 'gateway_cash',
              ownerType: 'platform',
              direction: 'debit',
              amountPaise: 500,
            },
            {
              accountType: 'provider_payable',
              ownerType: 'provider',
              ownerId: technicianId,
              direction: 'credit',
              amountPaise: 500,
            },
          ],
        });
      });

      const result = await payouts.buildPayoutBatch({ context }, null);

      expect(result.batchId).toBeNull();
      expect(result.skipped).toContainEqual({
        providerId: fixture.technicianId,
        reason: 'below_minimum',
        netPaise: 500,
      });

      // Still theirs, still waiting.
      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.payablePaise).toBe(500);
    });

    /**
     * A technician who owes more than we owe them.
     *
     * They are skipped and their dues are left alone. Netting a debt out of a
     * payout without asking is how a technician opens the app to a number they
     * do not recognise and stops trusting it.
     */
    it('excludes a dues-heavy technician with their dues intact', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const cash = await completedBooking('technician', 0);
      await request(app)
        .post(`/api/v1/bookings/${cash.bookingId}/payments/cash`)
        .set(auth(cash.technician.accessToken))
        .send({})
        .expect(201);

      const owedByThem = Math.floor((cash.payablePaise * 1_200) / 10_000);

      // And a technician with a real balance, so the batch is not empty.
      const online = await completedBooking('otherTechnician', 0);
      await payOnline(online.bookingId, online.customer);

      const result = await payouts.buildPayoutBatch({ context }, null);

      expect(result.payoutCount).toBe(1);
      expect(result.skipped.map((row) => row.providerId)).toContain(fixture.technicianId);

      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance.duesPaise).toBe(owedByThem);
      expect(balance.netPaise).toBe(-owedByThem);
    }, 60_000);

    it('will not let a batch header disagree with its own lines', async () => {
      if (unavailableReason || !context || !fixture) return;

      // The deferred trigger, proved directly.
      await expect(
        context.prisma.$transaction(async (tx) => {
          const batch = await tx.payoutBatch.create({
            data: {
              status: 'draft',
              windowEnd: new Date(),
              totalPaise: 99_999,
              payoutCount: 1,
            },
          });

          await tx.payout.create({
            data: { batchId: batch.id, providerId: fixture!.technicianId, amountPaise: 100 },
          });
        }),
      ).rejects.toThrow(/header says/);
    });
  });

  describe('wallet', () => {
    it('shows what we owe, what they owe, and their own lines only', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const online = await completedBooking('technician', 0);
      await payOnline(online.bookingId, online.customer);

      const cash = await completedBooking('technician', 1);
      await request(app)
        .post(`/api/v1/bookings/${cash.bookingId}/payments/cash`)
        .set(auth(cash.technician.accessToken))
        .send({})
        .expect(201);

      // Somebody else's money, which must not appear.
      const other = await completedBooking('otherTechnician', 0);
      await payOnline(other.bookingId, other.customer);

      const technician = await signIn(app, PHONES.technician, 'device-wallet');

      const response = await request(app)
        .get('/api/v1/providers/me/wallet')
        .set(auth(technician.accessToken))
        .expect(200);

      const wallet = response.body.wallet;
      const commission = Math.floor((online.payablePaise * 1_200) / 10_000);

      expect(wallet.payablePaise).toBe(online.payablePaise - commission);
      expect(wallet.duesPaise).toBe(Math.floor((cash.payablePaise * 1_200) / 10_000));
      expect(wallet.netPaise).toBe(wallet.payablePaise - wallet.duesPaise);
      expect(wallet.payableDisplay).toMatch(/^₹/);

      // Their own accounts, and no memos.
      expect(wallet.ledger.length).toBeGreaterThan(0);
      for (const line of wallet.ledger) {
        expect(['provider_payable', 'provider_dues']).toContain(line.accountType);
        expect(line).not.toHaveProperty('memo');
      }

      const totalPaidOut = await ledger.platformPosition(context.prisma);
      // Sanity: the other technician's money is in the platform view but not here.
      expect(totalPaidOut.owedToProvidersPaise).toBeGreaterThan(wallet.payablePaise);
    }, 60_000);

    it('is technician-only', async () => {
      if (unavailableReason || !app) return;

      const customer = await signIn(app, PHONES.customer, 'device-wallet-c');

      await request(app)
        .get('/api/v1/providers/me/wallet')
        .set(auth(customer.accessToken))
        .expect(403);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* End to end                                                             */
  /* ---------------------------------------------------------------------- */

  describe('end to end', () => {
    it('runs the online rail from booking to payout', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, payablePaise, customer } = await completedBooking();
      expect(payablePaise).toBeGreaterThan(0);

      await payOnline(bookingId, customer);

      const commission = Math.floor((payablePaise * 1_200) / 10_000);
      const owed = payablePaise - commission;

      // Ledger.
      const balance = await ledger.providerBalance(context.prisma, fixture.technicianId);
      expect(balance).toEqual({ payablePaise: owed, duesPaise: 0, netPaise: owed });

      // Wallet.
      const technician = await signIn(app, PHONES.technician, 'device-e2e-wallet');
      const wallet = await request(app)
        .get('/api/v1/providers/me/wallet')
        .set(auth(technician.accessToken))
        .expect(200);
      expect(wallet.body.wallet.payablePaise).toBe(owed);

      // Payout.
      const money = await signIn(app, PHONES.money, 'device-e2e-ops');
      const drafted = await request(app)
        .post('/api/v1/admin/payments/payout-batches')
        .set(auth(money.accessToken))
        .send({})
        .expect(201);

      const batch = await request(app)
        .get(`/api/v1/admin/payments/payout-batches/${drafted.body.batchId}`)
        .set(auth(money.accessToken))
        .expect(200);

      await request(app)
        .post(`/api/v1/admin/payments/payouts/${batch.body.batch.payouts[0].id}/paid`)
        .set(auth(money.accessToken))
        .send({ utrRef: 'UTRE2E0001' })
        .expect(200);

      // And the books close: everything in equals everything out.
      const position = await ledger.platformPosition(context.prisma);
      expect(position.revenuePaise).toBe(commission);
      expect(position.owedToProvidersPaise).toBe(0);
      expect(position.gatewayCashPaise).toBe(commission);

      const journals = await ledger.auditJournals(context.prisma);
      expect(journals.map((journal) => journal.journalType).sort()).toEqual([
        'payment_captured',
        'payout',
      ]);
      for (const journal of journals) expect(journal.debits).toBe(journal.credits);
    }, 60_000);

    it('runs the cash rail from booking to settled dues', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, payablePaise, technician } = await completedBooking();

      await request(app)
        .post(`/api/v1/bookings/${bookingId}/payments/cash`)
        .set(auth(technician.accessToken))
        .send({ note: 'Paid in notes at the door' })
        .expect(201);

      const commission = Math.floor((payablePaise * 1_200) / 10_000);

      let wallet = await request(app)
        .get('/api/v1/providers/me/wallet')
        .set(auth(technician.accessToken))
        .expect(200);

      expect(wallet.body.wallet.duesPaise).toBe(commission);
      // They are not owed anything: the customer already paid them, in full.
      expect(wallet.body.wallet.payablePaise).toBe(0);

      const money = await signIn(app, PHONES.money, 'device-cash-ops');
      await request(app)
        .post('/api/v1/admin/payments/dues/settle')
        .set(auth(money.accessToken))
        .send({
          providerId: fixture.technicianId,
          amountPaise: commission,
          memo: 'UPI to platform',
        })
        .expect(200);

      wallet = await request(app)
        .get('/api/v1/providers/me/wallet')
        .set(auth(technician.accessToken))
        .expect(200);

      expect(wallet.body.wallet.duesPaise).toBe(0);

      const position = await ledger.platformPosition(context.prisma);
      // We earned the commission and now hold it.
      expect(position.revenuePaise).toBe(commission);
      expect(position.gatewayCashPaise).toBe(commission);
      expect(position.owedByProvidersPaise).toBe(0);

      const journals = await ledger.auditJournals(context.prisma);
      for (const journal of journals) expect(journal.debits).toBe(journal.credits);
    }, 60_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Fixture helpers                                                            */
/* -------------------------------------------------------------------------- */

async function seedAccounts(ctx: AppContext): Promise<{ gatewayCash: string; revenue: string }> {
  const rows = await ctx.prisma.$queryRaw<{ id: string; account_type: string }[]>`
    INSERT INTO accounts (id, account_type, owner_type, owner_id, created_at)
    VALUES (gen_random_uuid(), 'gateway_cash'::account_type, 'platform'::account_owner_type, NULL, NOW()),
           (gen_random_uuid(), 'platform_revenue'::account_type, 'platform'::account_owner_type, NULL, NOW())
    ON CONFLICT (account_type, owner_type, owner_id) DO UPDATE SET account_type = EXCLUDED.account_type
    RETURNING id, account_type::text AS account_type
  `;

  const find = (type: string): string =>
    rows.find((row) => row.account_type === type)?.id as string;

  return { gatewayCash: find('gateway_cash'), revenue: find('platform_revenue') };
}
