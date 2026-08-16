import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';
import { createOutboxDispatcher, type DeliveredEvent } from '../../core/outbox';
import { purgeBookingData } from '../bookings/repository';
import { generateSlotsForProvider } from '../bookings/slots-service';
import { BOOKING_TOPICS } from '../bookings/state-machine';
import { MAX_QTY, MAX_UNIT_PAISE } from './money';

/**
 * Phase 7 against real Postgres and Redis.
 *
 * Its own technician, its own customer, its own price cards — for the same
 * reason Phase 6 has its own: earlier phases assert exact counts over the seeded
 * dataset, and quotations mutate more than anything before them.
 */

const FIXED_OTP = '000000';
const PHONES = {
  technician: '+919999907001',
  customer: '+919999907010',
  otherCustomer: '+919999907011',
};

const WRIGHT_TOWN = { lat: 23.1618, lng: 79.9492 };

/** ₹180 — the flat-rate job. */
const FIXED_PRICE_PAISE = 18_000;

let app: Express | undefined;
let context: AppContext | undefined;
let unavailableReason: string | undefined;

interface Fixture {
  technicianId: string;
  customerId: string;
  otherCustomerId: string;
  addressId: string;
  cityId: number;
  /** Booked at a flat rate: the direct path, no quotation needed. */
  fixedCard: { id: string; categoryId: number };
  /** Nobody knows the price until the technician looks: quotation required. */
  inspectionCard: { id: string; categoryId: number };
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

/** See the note in the Phase 6 suite: no hyphenated literal UUIDs in source. */
const fixtureUuid = (suffix: string): string =>
  ['00000000', '0000', '4000', '9000', suffix.padStart(12, '0')].join('-');

async function signIn(server: Express, phone: string, deviceId = 'device-quotes') {
  await request(server).post('/api/v1/auth/otp/request').send({ phone });
  const response = await request(server)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp: FIXED_OTP, deviceId });

  expect(response.status).toBe(200);
  return response.body as { accessToken: string; user: { id: string } };
}

async function clearBookings(ctx: AppContext, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const bookingIds = (
    await ctx.prisma.booking.findMany({
      where: { OR: [{ customerId: { in: userIds } }, { providerId: { in: userIds } }] },
      select: { id: true },
    })
  ).map((booking) => booking.id);

  // Quotations and their items cascade from bookings, and both refuse DELETE
  // outside the erasure path — so teardown exercises that path every run.
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

  await clearBookings(ctx, ids);
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

  const city = await context.prisma.city.findFirst({ where: { isActive: true } });
  const categories = await context.prisma.category.findMany({
    where: { isActive: true, parentId: { not: null } },
    orderBy: { id: 'asc' },
    take: 2,
  });

  const [flatCategory, inspectCategory] = categories;

  if (!city || !flatCategory || !inspectCategory) {
    unavailableReason = 'the database has no seeded city or categories; run `npm run seed`';
    return;
  }

  await purgeFixture(context);

  const session = await signIn(app, PHONES.technician, 'device-quote-tech');
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
      displayName: 'Quotation Test Technician',
      yearsExperience: 11,
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

  for (const category of [flatCategory, inspectCategory]) {
    await context.prisma.providerSkill.upsert({
      where: { providerId_categoryId: { providerId: technicianId, categoryId: category.id } },
      update: {},
      create: { providerId: technicianId, categoryId: category.id },
    });
  }

  // The two pricing paths, one card each.
  const fixedCardId = fixtureUuid('c01');
  const inspectionCardId = fixtureUuid('c02');

  await context.prisma.providerPriceCard.upsert({
    where: { id: fixedCardId },
    update: { amountPaise: FIXED_PRICE_PAISE, isActive: true },
    create: {
      id: fixedCardId,
      providerId: technicianId,
      categoryId: flatCategory.id,
      title: 'Flat rate job',
      priceType: 'fixed',
      amountPaise: FIXED_PRICE_PAISE,
    },
  });

  await context.prisma.providerPriceCard.upsert({
    where: { id: inspectionCardId },
    update: { isActive: true },
    create: {
      id: inspectionCardId,
      providerId: technicianId,
      categoryId: inspectCategory.id,
      title: 'Needs a look first',
      priceType: 'inspection_based',
      amountPaise: null,
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

  const customer = await signIn(app, PHONES.customer, 'device-quote-cust');
  const otherCustomer = await signIn(app, PHONES.otherCustomer, 'device-quote-other');

  const addressId = fixtureUuid('a01');
  await context.prisma.$executeRaw`
    INSERT INTO addresses
      (id, user_id, label, address_text, landmark, city_id, location, is_default, created_at, updated_at)
    VALUES (
      ${addressId}::uuid, ${customer.user.id}::uuid, 'home'::address_label,
      '9, Quote Street, Wright Town', 'Near the water tank', ${city.id},
      ST_SetSRID(ST_MakePoint(${WRIGHT_TOWN.lng}::double precision, ${WRIGHT_TOWN.lat}::double precision), 4326)::geography,
      true, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  fixture = {
    technicianId,
    customerId: customer.user.id,
    otherCustomerId: otherCustomer.user.id,
    addressId,
    cityId: city.id,
    fixedCard: { id: fixedCardId, categoryId: flatCategory.id },
    inspectionCard: { id: inspectionCardId, categoryId: inspectCategory.id },
  };
}, 90_000);

beforeEach(async () => {
  if (!context || !fixture || unavailableReason) return;

  await clearBookings(context, [fixture.technicianId, fixture.customerId, fixture.otherCustomerId]);

  await context.prisma.feeConfig.deleteMany({
    where: { cityId: fixture.cityId, visitFeePaise: { in: [11_100, 22_200, 33_300] } },
  });
  await generateSlotsForProvider(context, fixture.technicianId);
});

afterAll(async () => {
  if (context && !unavailableReason) {
    await purgeFixture(context);
    await context.prisma.feeConfig.deleteMany({
      where: { visitFeePaise: { in: [11_100, 22_200, 33_300] } },
    });
  }

  if (context) await disposeContext(context);
});

const SKIP = (reason: string) =>
  `[skipped] Phase 7 quotation tests — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface Session {
  accessToken: string;
  user: { id: string };
}

/** Drives a booking all the way to IN_PROGRESS, where quoting becomes legal. */
async function bookingInProgress(
  card: 'fixed' | 'inspection',
  skip = 0,
): Promise<{ bookingId: string; customer: Session; technician: Session }> {
  const ctx = context as AppContext;
  const server = app as Express;
  const fix = fixture as Fixture;

  const chosen = card === 'fixed' ? fix.fixedCard : fix.inspectionCard;

  const slots = await ctx.prisma.slot.findMany({
    where: {
      providerId: fix.technicianId,
      status: 'open',
      startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
    },
    orderBy: { startsAt: 'asc' },
    take: skip + 1,
  });

  const slot = slots[skip];
  if (!slot) throw new Error('fixture has no open slot');

  const customer = await signIn(server, PHONES.customer, 'device-quote-cust');
  const technician = await signIn(server, PHONES.technician, 'device-quote-tech');

  const created = await request(server)
    .post('/api/v1/bookings')
    .set(auth(customer.accessToken))
    .send({
      slotId: slot.id,
      categoryId: chosen.categoryId,
      addressId: fix.addressId,
      priceCardId: chosen.id,
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

  return { bookingId, customer, technician };
}

const QUOTE = {
  labourPaise: 50_000,
  items: [
    { kind: 'part' as const, description: 'Door gasket', qty: 1, unitPaise: 85_000 },
    { kind: 'part' as const, description: 'Sealant tube', qty: 2, unitPaise: 12_000 },
  ],
  note: 'Gasket perished; door not sealing.',
};

/** ₹500 labour + ₹850 + (2 × ₹120) = ₹1,590 */
const QUOTE_TOTAL = 50_000 + 85_000 + 2 * 12_000;

const sendQuote = (bookingId: string, token: string, body: object = QUOTE) =>
  request(app as Express)
    .post(`/api/v1/bookings/${bookingId}/quotations`)
    .set(auth(token))
    .send(body);

const endOtpFor = (bookingId: string) =>
  (context as AppContext).redis.get(`booking:otp:plain:end:${bookingId}`);

/**
 * Asserts a raw statement was refused by Postgres, matching the database's own
 * message.
 *
 * Prisma wraps raw failures as `P2010` and buries the real text in
 * `meta.message`, so matching on `error.message` alone silently passes for any
 * failure at all — including a typo in the fixture. Digging the message out is
 * the difference between proving a constraint fired and proving *something*
 * went wrong.
 */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
    expect.unreachable('the statement should have been refused');
  } catch (error) {
    const meta = (error as { meta?: { message?: string } }).meta;
    const text = `${(error as Error).message}\n${meta?.message ?? ''}`;

    expect(text).toMatch(pattern);
  }
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('Phase 7 — quotations and pricing', () => {
  it('has a working environment', () => {
    if (unavailableReason) {
      console.warn(SKIP(unavailableReason));
      expect(unavailableReason).toBeTruthy();
      return;
    }

    expect(fixture).toBeDefined();
    expect(QUOTE_TOTAL).toBe(159_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Money math at the database level                                       */
  /* ---------------------------------------------------------------------- */

  describe('money math', () => {
    it('computes and stores totals that agree with the lines', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      const response = await sendQuote(bookingId, technician.accessToken).expect(201);

      expect(response.body.quotation.partsTotalPaise).toBe(109_000);
      expect(response.body.quotation.totalPaise).toBe(QUOTE_TOTAL);
      expect(response.body.quotation.totalDisplay).toBe('₹1,590');

      const items = response.body.quotation.items as { lineTotalPaise: number }[];
      expect(items.map((item) => item.lineTotalPaise)).toEqual([85_000, 24_000]);
    });

    /**
     * The service could compute a wrong total; the database refuses to store
     * one. Two independent statements of the same arithmetic.
     */
    it('refuses a stored total that is not the sum of its parts', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId } = await bookingInProgress('inspection');

      await expect(
        context.prisma.$executeRaw`
          INSERT INTO quotations
            (id, booking_id, version, status, labour_paise, parts_total_paise, total_paise, created_by, created_at)
          VALUES (${fixtureUuid('e01')}::uuid, ${bookingId}::uuid, 99, 'superseded'::quotation_status,
                  10000, 5000, 99999, ${fixture.technicianId}::uuid, NOW())
        `,
      ).rejects.toThrow(/quotations_total_check|decided_check/);
    });

    it('refuses a line total that is not quantity times unit price', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      await expect(
        context.prisma.$executeRaw`
          INSERT INTO quotation_items
            (id, quotation_id, kind, description, qty, unit_paise, line_total_paise, created_at)
          VALUES (${fixtureUuid('e02')}::uuid, ${created.body.quotation.id}::uuid, 'part'::quotation_item_kind,
                  'Fiddled line', 2, 1000, 5000, NOW())
        `,
      ).rejects.toThrow(/quotation_items_line_total_check/);
    });

    it('refuses a zero or negative unit price at the database', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      for (const unit of [0, -500]) {
        await expect(
          context.prisma.$executeRaw`
            INSERT INTO quotation_items
              (id, quotation_id, kind, description, qty, unit_paise, line_total_paise, created_at)
            VALUES (${fixtureUuid('e03')}::uuid, ${created.body.quotation.id}::uuid, 'part'::quotation_item_kind,
                    'Free part', 1, ${unit}, ${unit}, NOW())
          `,
        ).rejects.toThrow(/quotation_items_unit_check|line_total_check/);
      }
    });

    it('refuses an empty quotation through the API', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');

      const response = await sendQuote(bookingId, technician.accessToken, {
        labourPaise: 0,
        items: [],
      });

      expect(response.status).toBe(400);
    });

    /**
     * `int4` overflow sanity.
     *
     * The API rejects the multiplication long before it reaches Postgres — but
     * if it ever did reach Postgres, the answer must be an error, not a wrapped
     * negative number. Both halves are asserted.
     */
    it('rejects a runaway line, and Postgres would raise rather than wrap', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');

      const response = await sendQuote(bookingId, technician.accessToken, {
        labourPaise: 0,
        items: [{ kind: 'part', description: 'Absurd', qty: MAX_QTY, unitPaise: MAX_UNIT_PAISE }],
      });

      expect(response.status).toBe(400);

      // The database's own opinion of the same arithmetic.
      await expect(
        context.prisma.$queryRaw`SELECT ${MAX_QTY}::int * ${MAX_UNIT_PAISE}::int AS runaway`,
      ).rejects.toThrow(/out of range/i);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Versioning and the two races                                           */
  /* ---------------------------------------------------------------------- */

  describe('versioning', () => {
    it('supersedes the previous version atomically', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');

      const v1 = await sendQuote(bookingId, technician.accessToken).expect(201);
      expect(v1.body.quotation.version).toBe(1);

      const v2 = await sendQuote(bookingId, technician.accessToken, {
        ...QUOTE,
        labourPaise: 40_000,
      }).expect(201);

      expect(v2.body.quotation.version).toBe(2);

      const all = await context.prisma.quotation.findMany({
        where: { bookingId },
        orderBy: { version: 'asc' },
      });

      expect(all.map((quote) => quote.status)).toEqual(['superseded', 'sent']);
      // v1 survives, unchanged, exactly as the customer saw it.
      expect(all[0]?.totalPaise).toBe(QUOTE_TOTAL);
      expect(all[0]?.decidedAt).not.toBeNull();
    });

    /**
     * Six sends at once, from a technician tapping a stuck button.
     *
     * The assertion is **not** "exactly one succeeds", and that distinction
     * matters. A send that arrives after another has already committed is not a
     * race loss — it is a legitimate revision, and it should produce v2. What
     * must hold no matter how the six interleave is the invariant the index
     * states: one live quotation, contiguous versions, and every loser getting a
     * clean 409 rather than a 500.
     */
    it('keeps one live quotation however six parallel sends interleave', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');

      const results = await Promise.all(
        Array.from({ length: 6 }, (_unused, index) =>
          sendQuote(bookingId, technician.accessToken, {
            ...QUOTE,
            labourPaise: 50_000 + index * 100,
          }),
        ),
      );

      const statuses = results.map((response) => response.status);

      // A loser must lose cleanly. A 500 here would mean a constraint violation
      // leaked out as an internal error — correct data, terrible behaviour.
      expect(
        statuses.every((status) => status === 201 || status === 409),
        `unexpected statuses: ${JSON.stringify(statuses)}`,
      ).toBe(true);
      // At least one had to lose: six cannot all serialise cleanly.
      expect(statuses.filter((status) => status === 409).length).toBeGreaterThanOrEqual(1);

      const all = await context.prisma.quotation.findMany({
        where: { bookingId },
        orderBy: { version: 'asc' },
      });

      expect(all.filter((quote) => quote.status === 'sent')).toHaveLength(1);
      // Contiguous from 1, with no gap left by a rolled-back attempt.
      expect(all.map((quote) => quote.version)).toEqual(
        Array.from({ length: all.length }, (_unused, index) => index + 1),
      );
      // Only the newest is live; everything before it was superseded.
      expect(all.slice(0, -1).every((quote) => quote.status === 'superseded')).toBe(true);
      expect(all.length).toBe(statuses.filter((status) => status === 201).length);
    });

    /**
     * The nastier race: the customer taps approve at the same moment the
     * technician sends a revision. Whoever loses must lose cleanly.
     */
    it('produces a single winner when approve races a revision', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const v1 = await sendQuote(bookingId, technician.accessToken).expect(201);

      const [approve, revise] = await Promise.all([
        request(app)
          .post(`/api/v1/quotations/${v1.body.quotation.id}/approve`)
          .set(auth(customer.accessToken)),
        sendQuote(bookingId, technician.accessToken, { ...QUOTE, labourPaise: 30_000 }),
      ]);

      // Exactly one of the two succeeded.
      const winners = [approve.status, revise.status].filter((status) => status < 400);
      expect(winners).toHaveLength(1);

      const live = await context.prisma.quotation.findMany({
        where: { bookingId, status: { in: ['sent', 'approved'] } },
      });
      expect(live).toHaveLength(1);
    });

    it('refuses two live quotations at the SQL level', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      await sendQuote(bookingId, technician.accessToken).expect(201);

      // Straight past the service, straight into the index. The partial index
      // is on `(booking_id)` alone, which is what Postgres names in the error.
      await expectDbError(
        context.prisma.$executeRaw`
          INSERT INTO quotations
            (id, booking_id, version, status, labour_paise, parts_total_paise, total_paise, created_by, created_at)
          VALUES (${fixtureUuid('e04')}::uuid, ${bookingId}::uuid, 77, 'sent'::quotation_status,
                  10000, 0, 10000, ${fixture.technicianId}::uuid, NOW())
        `,
        /Key \(booking_id\)=.* already exists/,
      );
    });

    it('refuses a duplicate version number', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      await sendQuote(bookingId, technician.accessToken).expect(201);

      await expectDbError(
        context.prisma.$executeRaw`
          INSERT INTO quotations
            (id, booking_id, version, status, labour_paise, parts_total_paise, total_paise, created_by, decided_at, created_at)
          VALUES (${fixtureUuid('e05')}::uuid, ${bookingId}::uuid, 1, 'withdrawn'::quotation_status,
                  10000, 0, 10000, ${fixture.technicianId}::uuid, NOW(), NOW())
        `,
        /Key \(booking_id, version\)=.* already exists/,
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Immutability                                                           */
  /* ---------------------------------------------------------------------- */

  describe('immutability', () => {
    it('refuses to change the money on a quotation', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);
      const id = created.body.quotation.id as string;

      /**
       * The customer saw this number. Nothing may quietly change it.
       *
       * Two refusals with two different reasons: an update that leaves the quote
       * `sent` is refused outright (there is no legitimate reason to touch a
       * live quotation), and an update that *does* move it out of `sent` is
       * still refused if it fiddles with the money on the way.
       */
      await expectDbError(
        context.prisma.$executeRaw`UPDATE quotations SET total_paise = 1 WHERE id = ${id}::uuid`,
        /cannot be updated while it stays sent/,
      );

      await expectDbError(
        context.prisma
          .$executeRaw`UPDATE quotations SET labour_paise = 1, status = 'withdrawn', decided_at = NOW() WHERE id = ${id}::uuid`,
        /is immutable: only status, decided_at and decision_note may change/,
      );
    });

    it('refuses to reopen or re-decide a settled quotation', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);
      const id = created.body.quotation.id as string;

      await request(app)
        .post(`/api/v1/quotations/${id}/approve`)
        .set(auth(customer.accessToken))
        .expect(200);

      await expect(
        context.prisma
          .$executeRaw`UPDATE quotations SET status = 'rejected' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/already approved/i);
    });

    it('refuses any UPDATE or DELETE of a line item', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);
      const itemId = (created.body.quotation.items as { id: string }[])[0]?.id as string;

      await expect(
        context.prisma
          .$executeRaw`UPDATE quotation_items SET unit_paise = 1 WHERE id = ${itemId}::uuid`,
      ).rejects.toThrow(/append-only/i);

      await expect(
        context.prisma.$executeRaw`DELETE FROM quotation_items WHERE id = ${itemId}::uuid`,
      ).rejects.toThrow(/append-only/i);
    });

    it('still lets the erasure path through', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      await sendQuote(bookingId, technician.accessToken).expect(201);

      // DPDP erasure has to be able to remove this, and does — by announcing
      // itself with the session flag, exactly as verification and bookings do.
      await purgeBookingData(context.prisma, [fixture.customerId]);

      expect(await context.prisma.quotation.count({ where: { bookingId } })).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Guards                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('guards', () => {
    it('blocks completion while a quotation is awaiting a decision', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      await sendQuote(bookingId, technician.accessToken).expect(201);

      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: (await endOtpFor(bookingId)) ?? '0000' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('QUOTATION_PENDING');

      // And the booking has not moved.
      const booking = await context.prisma.booking.findUnique({ where: { id: bookingId } });
      expect(booking?.status).toBe('IN_PROGRESS');
      expect(booking?.payablePaise).toBeNull();
    });

    it('blocks completion of an inspection-based job with no approved price', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await bookingInProgress('inspection');

      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: (await endOtpFor(bookingId)) ?? '0000' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('QUOTATION_REQUIRED');
    });

    it('blocks completion after the customer rejected the only quote', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      await request(app)
        .post(`/api/v1/quotations/${created.body.quotation.id}/reject`)
        .set(auth(customer.accessToken))
        .send({ reason: 'Too expensive' })
        .expect(200);

      // Rejection does not end the job — but it does not price it either.
      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: (await endOtpFor(bookingId)) ?? '0000' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('QUOTATION_REQUIRED');
    });

    it('leaves the flat-rate path completely untouched', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await bookingInProgress('fixed');

      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: (await endOtpFor(bookingId)) ?? '0000' });

      expect(response.status).toBe(200);
      expect(response.body.booking.status).toBe('WORK_DONE');
    });

    it('refuses a quotation before the technician has started looking', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const slot = await context.prisma.slot.findFirst({
        where: {
          providerId: fixture.technicianId,
          status: 'open',
          startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
        },
        orderBy: { startsAt: 'asc' },
      });

      const customer = await signIn(app, PHONES.customer, 'device-early-c');
      const technician = await signIn(app, PHONES.technician, 'device-early-t');

      const created = await request(app)
        .post('/api/v1/bookings')
        .set(auth(customer.accessToken))
        .send({
          slotId: slot?.id,
          categoryId: fixture.inspectionCard.categoryId,
          addressId: fixture.addressId,
          priceCardId: fixture.inspectionCard.id,
        })
        .expect(201);

      const response = await sendQuote(created.body.booking.id, technician.accessToken);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('QUOTATION_NOT_ALLOWED');
    });

    it('refuses a further quotation once a price is agreed', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      await request(app)
        .post(`/api/v1/quotations/${created.body.quotation.id}/approve`)
        .set(auth(customer.accessToken))
        .expect(200);

      const response = await sendQuote(bookingId, technician.accessToken);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('QUOTATION_ALREADY_APPROVED');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Actors                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('who may do what', () => {
    it('will not let a technician approve their own quotation', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      // The single most important actor rule in the module.
      const response = await request(app)
        .post(`/api/v1/quotations/${created.body.quotation.id}/approve`)
        .set(auth(technician.accessToken));

      expect(response.status).toBe(403);
    });

    it('will not let a customer send a quotation', async () => {
      if (unavailableReason || !context || !fixture) return;

      const { bookingId, customer } = await bookingInProgress('inspection');

      expect((await sendQuote(bookingId, customer.accessToken)).status).toBe(403);
    });

    it('will not let a technician withdraw once the customer has decided', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);
      const id = created.body.quotation.id as string;

      await request(app)
        .post(`/api/v1/quotations/${id}/reject`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(200);

      const response = await request(app)
        .post(`/api/v1/quotations/${id}/withdraw`)
        .set(auth(technician.accessToken));

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('QUOTATION_NOT_PENDING');
    });

    it("hides a booking's quotations from a stranger", async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      await sendQuote(bookingId, technician.accessToken).expect(201);

      const stranger = await signIn(app, PHONES.otherCustomer, 'device-stranger');

      // 404, not 403 — a stranger should not learn the booking exists.
      await request(app)
        .get(`/api/v1/bookings/${bookingId}/quotations`)
        .set(auth(stranger.accessToken))
        .expect(404);
    });

    it('lets a withdrawn quotation be replaced by a corrected one', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await bookingInProgress('inspection');
      const v1 = await sendQuote(bookingId, technician.accessToken).expect(201);

      await request(app)
        .post(`/api/v1/quotations/${v1.body.quotation.id}/withdraw`)
        .set(auth(technician.accessToken))
        .expect(200);

      const v2 = await sendQuote(bookingId, technician.accessToken, {
        ...QUOTE,
        labourPaise: 20_000,
      }).expect(201);

      expect(v2.body.quotation.version).toBe(2);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Declining the work                                                     */
  /* ---------------------------------------------------------------------- */

  describe('decline and close', () => {
    it('refuses while a quotation is still awaiting a decision', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      await sendQuote(bookingId, technician.accessToken).expect(201);

      // Otherwise the history cannot say whether the customer refused this price
      // or simply stopped answering.
      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/decline-work`)
        .set(auth(customer.accessToken))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('QUOTATION_PENDING');
    });

    it('refuses once a price has been agreed', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      await request(app)
        .post(`/api/v1/quotations/${created.body.quotation.id}/approve`)
        .set(auth(customer.accessToken))
        .expect(200);

      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/decline-work`)
        .set(auth(customer.accessToken))
        .send({});

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('QUOTATION_ALREADY_APPROVED');
    });

    it('will not let the technician declare the work declined', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      await request(app)
        .post(`/api/v1/quotations/${created.body.quotation.id}/reject`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(200);

      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/decline-work`)
        .set(auth(technician.accessToken))
        .send({});

      expect(response.status).toBe(403);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* End to end                                                             */
  /* ---------------------------------------------------------------------- */

  describe('end to end', () => {
    /**
     * The whole point of the phase, in one test: an inspection job priced in
     * writing, haggled over once, agreed, and finished — with the customer
     * paying exactly the number they approved and no visit fee on top.
     */
    it('quotes, revises, agrees and settles at the agreed number', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');

      const v1 = await sendQuote(bookingId, technician.accessToken).expect(201);
      expect(v1.body.quotation.version).toBe(1);
      expect(v1.body.quotation.totalPaise).toBe(QUOTE_TOTAL);

      await request(app)
        .post(`/api/v1/quotations/${v1.body.quotation.id}/reject`)
        .set(auth(customer.accessToken))
        .send({ reason: 'Too expensive, suggest a cheaper part' })
        .expect(200);

      // ₹500 labour + ₹950 part = ₹1,450
      const v2 = await sendQuote(bookingId, technician.accessToken, {
        labourPaise: 50_000,
        items: [{ kind: 'part', description: 'Local gasket', qty: 1, unitPaise: 95_000 }],
        note: 'Local part, six month warranty.',
      }).expect(201);

      expect(v2.body.quotation.version).toBe(2);
      expect(v2.body.quotation.totalPaise).toBe(145_000);

      await request(app)
        .post(`/api/v1/quotations/${v2.body.quotation.id}/approve`)
        .set(auth(customer.accessToken))
        .expect(200);

      const completed = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: (await endOtpFor(bookingId)) ?? '0000' })
        .expect(200);

      expect(completed.body.booking.status).toBe('WORK_DONE');

      // The frozen bill: the agreed number, and the visit fee waived into it.
      expect(completed.body.booking.payablePaise).toBe(145_000);
      expect(completed.body.booking.payable.visitFeeCharged).toBe(false);
      expect(completed.body.booking.payable.basis).toBe('approved_quotation');

      const stored = await context.prisma.booking.findUnique({ where: { id: bookingId } });
      expect(stored?.payablePaise).toBe(145_000);

      // Both versions survive, and the timeline tells the whole story.
      const history = await request(app)
        .get(`/api/v1/bookings/${bookingId}/quotations`)
        .set(auth(customer.accessToken))
        .expect(200);

      expect((history.body.quotations as { status: string }[]).map((q) => q.status)).toEqual([
        'rejected',
        'approved',
      ]);
      expect(history.body.quotations[0].decisionNote).toBe('Too expensive, suggest a cheaper part');

      const events = (completed.body.booking.events as { eventType: string }[]).map(
        (event) => event.eventType,
      );

      expect(events).toEqual([
        'requested',
        'accepted',
        'arrived',
        'work_started',
        'quote_sent',
        'quote_rejected',
        'quote_sent',
        'quote_approved',
        'work_done',
      ]);
    }, 30_000);

    /** The other ending: heard the price, sent them away, paid for the trip. */
    it('closes a declined job at the visit fee alone', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      await request(app)
        .post(`/api/v1/quotations/${created.body.quotation.id}/reject`)
        .set(auth(customer.accessToken))
        .send({ reason: 'Will get a second opinion' })
        .expect(200);

      const declined = await request(app)
        .post(`/api/v1/bookings/${bookingId}/decline-work`)
        .set(auth(customer.accessToken))
        .send({ note: 'Getting another quote first' })
        .expect(200);

      expect(declined.body.booking.status).toBe('CLOSED_QUOTE_DECLINED');

      const booking = await context.prisma.booking.findUnique({ where: { id: bookingId } });
      expect(declined.body.booking.payablePaise).toBe(booking?.visitFeePaise);
      expect(declined.body.booking.payable.basis).toBe('visit_fee_only');
      expect(declined.body.booking.payable.visitFeeCharged).toBe(true);

      // Terminal: nothing follows, not even a late completion.
      const late = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: '0000' });

      expect(late.status).toBe(409);
    });

    it('bills the flat-rate path at the card price plus the visit fee', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, technician } = await bookingInProgress('fixed');

      const completed = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: (await endOtpFor(bookingId)) ?? '0000' })
        .expect(200);

      const booking = await context.prisma.booking.findUnique({ where: { id: bookingId } });
      const expected = FIXED_PRICE_PAISE + (booking?.visitFeePaise ?? 0);

      expect(completed.body.booking.payablePaise).toBe(expected);
      expect(completed.body.booking.payable.basis).toBe('price_card');
      expect(completed.body.booking.payable.visitFeeCharged).toBe(true);
    });

    it('leaves no payable on an ending that owes nothing', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer } = await bookingInProgress('inspection');

      // Cancelling mid-job is not possible from IN_PROGRESS, so this uses a
      // fresh booking that never got that far.
      const slot = await context.prisma.slot.findFirst({
        where: {
          providerId: fixture.technicianId,
          status: 'open',
          startsAt: { gt: new Date(Date.now() + 60 * 60 * 1000) },
        },
        orderBy: { startsAt: 'asc' },
      });

      const fresh = await request(app)
        .post('/api/v1/bookings')
        .set(auth(customer.accessToken))
        .send({
          slotId: slot?.id,
          categoryId: fixture.fixedCard.categoryId,
          addressId: fixture.addressId,
          priceCardId: fixture.fixedCard.id,
        })
        .expect(201);

      await request(app)
        .post(`/api/v1/bookings/${fresh.body.booking.id}/cancel`)
        .set(auth(customer.accessToken))
        .send({ reason: 'changed_mind' })
        .expect(200);

      const cancelled = await context.prisma.booking.findUnique({
        where: { id: fresh.body.booking.id },
      });

      expect(cancelled?.status).toBe('CANCELLED_BY_CUSTOMER');
      expect(cancelled?.payablePaise).toBeNull();
      expect(cancelled?.payableBreakdown).toBeNull();
      expect(bookingId).toBeTruthy();
    }, 30_000);
  });

  /* ---------------------------------------------------------------------- */
  /* Fee resolution against the real table                                  */
  /* ---------------------------------------------------------------------- */

  describe('fee config', () => {
    it('snapshots the most specific configured fee at booking time', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const category = await context.prisma.category.findUnique({
        where: { id: fixture.fixedCard.categoryId },
        select: { parentId: true },
      });

      // city default → cluster → exact service, added one rung at a time.
      await context.prisma.feeConfig.create({
        data: { cityId: fixture.cityId, categoryId: null, visitFeePaise: 11_100 },
      });

      const first = await bookingInProgress('fixed');
      const afterCity = await context.prisma.booking.findUnique({
        where: { id: first.bookingId },
      });
      expect(afterCity?.visitFeePaise).toBe(11_100);

      if (category?.parentId) {
        await context.prisma.feeConfig.create({
          data: { cityId: fixture.cityId, categoryId: category.parentId, visitFeePaise: 22_200 },
        });

        const second = await bookingInProgress('fixed', 1);
        const afterCluster = await context.prisma.booking.findUnique({
          where: { id: second.bookingId },
        });
        expect(afterCluster?.visitFeePaise).toBe(22_200);
      }

      await context.prisma.feeConfig.create({
        data: {
          cityId: fixture.cityId,
          categoryId: fixture.fixedCard.categoryId,
          visitFeePaise: 33_300,
        },
      });

      const third = await bookingInProgress('fixed', 2);
      const afterExact = await context.prisma.booking.findUnique({
        where: { id: third.bookingId },
      });
      expect(afterExact?.visitFeePaise).toBe(33_300);
    }, 40_000);

    it('carries the snapshot into the bill even after the fee changes', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await context.prisma.feeConfig.create({
        data: { cityId: fixture.cityId, categoryId: null, visitFeePaise: 11_100 },
      });

      const { bookingId, technician } = await bookingInProgress('fixed');

      // Ops put the price up while the technician is on the job. The customer
      // pays what they were told.
      await context.prisma.feeConfig.updateMany({
        where: { cityId: fixture.cityId, visitFeePaise: 11_100 },
        data: { visitFeePaise: 33_300 },
      });

      const completed = await request(app)
        .post(`/api/v1/bookings/${bookingId}/complete`)
        .set(auth(technician.accessToken))
        .send({ otp: (await endOtpFor(bookingId)) ?? '0000' })
        .expect(200);

      expect(completed.body.booking.payablePaise).toBe(FIXED_PRICE_PAISE + 11_100);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Outbox                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('outbox', () => {
    it('emits sent, rejected and approved under quotation topics', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      const { bookingId, customer, technician } = await bookingInProgress('inspection');

      const v1 = await sendQuote(bookingId, technician.accessToken).expect(201);
      await request(app)
        .post(`/api/v1/quotations/${v1.body.quotation.id}/reject`)
        .set(auth(customer.accessToken))
        .send({})
        .expect(200);

      const v2 = await sendQuote(bookingId, technician.accessToken).expect(201);
      await request(app)
        .post(`/api/v1/quotations/${v2.body.quotation.id}/approve`)
        .set(auth(customer.accessToken))
        .expect(200);

      const events = await context.prisma.outboxEvent.findMany({
        where: { aggregateId: bookingId, topic: { startsWith: 'quotation.' } },
        orderBy: { createdAt: 'asc' },
      });

      expect(events.map((event) => event.topic)).toEqual([
        BOOKING_TOPICS.quote_sent,
        BOOKING_TOPICS.quote_rejected,
        BOOKING_TOPICS.quote_sent,
        BOOKING_TOPICS.quote_approved,
      ]);

      // The payload carries what a Phase 9/10 subscriber will actually need.
      expect(events[0]?.payload).toMatchObject({ totalPaise: QUOTE_TOTAL, version: 1 });
    }, 30_000);

    it('delivers them to a subscriber, and a redelivery changes nothing', async () => {
      if (unavailableReason || !context || !fixture || !app) return;

      await context.prisma.outboxEvent.deleteMany({ where: { processedAt: null } });
      await context.redis.del('outbox:dispatcher:lock');

      const { bookingId, customer, technician } = await bookingInProgress('inspection');
      const created = await sendQuote(bookingId, technician.accessToken).expect(201);

      await request(app)
        .post(`/api/v1/quotations/${created.body.quotation.id}/approve`)
        .set(auth(customer.accessToken))
        .expect(200);

      const seen: DeliveredEvent[] = [];

      const dispatcher = createOutboxDispatcher({
        prisma: context.prisma,
        redis: context.redis,
        config: context.config,
        logger: context.logger,
        registry: {
          subscribe: () => undefined,
          topics: () => [BOOKING_TOPICS.quote_approved],
          handlersFor: (topic) =>
            topic === BOOKING_TOPICS.quote_approved
              ? [
                  async (event) => {
                    seen.push(event);
                  },
                ]
              : [],
        },
        // Postgres and the host clock drift by a few milliseconds; see the note
        // in the Phase 6 suite.
        now: () => new Date(Date.now() + 5_000),
      });

      await dispatcher.runOnce();
      expect(seen.filter((event) => event.aggregateId === bookingId)).toHaveLength(1);

      // At-least-once means this will happen for real one day. Handlers are
      // idempotent, so a second pass must simply find nothing left to do.
      const before = seen.length;
      await dispatcher.runOnce();
      expect(seen).toHaveLength(before);
    }, 30_000);
  });
});
