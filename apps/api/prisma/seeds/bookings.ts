import type { Prisma, PrismaClient } from '@prisma/client';
import { computeAcceptanceRate } from '../../src/modules/bookings/stats';
import {
  planSlots,
  type AvailabilityTemplateLike,
  type PlannedSlot,
} from '../../src/modules/bookings/slot-plan';
import {
  isBillableBooking,
  projectBookingStatus,
  type BookingActor,
  type BookingEventType,
} from '../../src/modules/bookings/state-machine';
import { resolveVisitFee } from '../../src/modules/bookings/fees';
import { computeQuotationTotals } from '../../src/modules/quotations/money';
import { computePayable } from '../../src/modules/quotations/payable';
import { deterministicUuid } from './deterministic-id';
import { SEED_CUSTOMER_PHONE } from './customer';

/**
 * Slots and bookings for local development.
 *
 * Two properties matter more than the data itself:
 *
 *   1. **Idempotent.** Slots are diffed the same way the nightly job diffs them.
 *      Bookings are skipped wholesale if they already exist, because
 *      `booking_events` is append-only — a rerun cannot "update" a history, and
 *      trying would hit the trigger that refuses it.
 *   2. **Replayable.** Every seeded history is fed through the real projector
 *      before it is written. A fixture the state machine would reject is a
 *      fixture that will make a test lie, so the seed refuses to create one.
 */

/** Matches the config defaults. The seed does not load app config. */
const SLOT_INCREMENT_MINUTES = 60;
const SLOT_HORIZON_DAYS = 14;
/** Only the last rung of the chain — `fee_config` supplies the rest. */
const DEFAULT_VISIT_FEE_PAISE = 4_900;

/* -------------------------------------------------------------------------- */
/* Slots                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Materialises the horizon for every listed provider.
 *
 * The insert is raw and `ON CONFLICT DO NOTHING` on the deterministic id: same
 * provider, same hour, same id, so a rerun writes nothing and — critically —
 * cannot disturb a slot a seeded booking is already holding.
 */
async function seedSlots(prisma: PrismaClient, now: Date): Promise<number> {
  const providers = await prisma.providerProfile.findMany({
    where: { isListed: true },
    select: { userId: true },
  });

  let created = 0;

  for (const provider of providers) {
    const templates = (await prisma.providerAvailabilityTemplate.findMany({
      where: { providerId: provider.userId, isActive: true },
    })) as AvailabilityTemplateLike[];

    const planned = planSlots(templates, {
      from: now,
      horizonDays: SLOT_HORIZON_DAYS,
      incrementMinutes: SLOT_INCREMENT_MINUTES,
      notBefore: now,
    });

    for (const slot of planned) {
      created += await insertSlot(prisma, provider.userId, slot);
    }
  }

  console.log(`slots ready: ${created} new across ${providers.length} listed technicians`);

  return created;
}

function slotId(providerId: string, startsAt: Date): string {
  return deterministicUuid(`slot:${providerId}:${startsAt.toISOString()}`);
}

async function insertSlot(
  prisma: PrismaClient,
  providerId: string,
  slot: PlannedSlot,
): Promise<number> {
  // `time_range` is filled by the BEFORE INSERT trigger, so it is not named here.
  return prisma.$executeRaw`
    INSERT INTO slots (id, provider_id, starts_at, ends_at, status, source_template_id, updated_at)
    VALUES (
      ${slotId(providerId, slot.startsAt)}::uuid,
      ${providerId}::uuid,
      ${slot.startsAt},
      ${slot.endsAt},
      'open'::slot_status,
      ${slot.sourceTemplateId}::uuid,
      NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

interface EventSeed {
  eventType: BookingEventType;
  actorType: BookingActor;
  /** Minutes after the booking was created. Keeps histories in a sane order. */
  offsetMinutes: number;
  payload?: Prisma.InputJsonObject;
}

interface QuoteItemSeed {
  kind: 'part' | 'labour_extra';
  description: string;
  qty: number;
  unitPaise: number;
}

interface QuoteSeed {
  labourPaise: number;
  items: QuoteItemSeed[];
  note?: string;
  /** Where this version ended up. `sent` means still awaiting the customer. */
  status: 'sent' | 'approved' | 'rejected' | 'superseded' | 'withdrawn';
  decisionNote?: string;
  /** Minutes after the booking was created. */
  offsetMinutes: number;
}

interface BookingSeed {
  key: string;
  providerPhone: string;
  /**
   * How long ago the request was made, in hours.
   *
   * A live booking's appointment is not taken from this — it is taken from a
   * real open slot, because a booking that claims an hour no template ever
   * produced is a fixture the rest of the system cannot reason about. Only
   * finished bookings get a synthetic past time, which is exactly right: their
   * slot is long gone.
   */
  requestedHoursAgo: number;
  /**
   * Which of the technician's price cards this was booked against.
   *
   * It decides the pricing path: a `fixed` card can go straight to WORK_DONE,
   * while `inspection_based` cannot be finished without an approved quotation.
   * `null` books against a bare skill with no card at all.
   */
  priceCardType: 'fixed' | 'starting_from' | 'inspection_based' | null;
  events: EventSeed[];
  /** Quotation history, oldest first. */
  quotes?: QuoteSeed[];
}

/**
 * Ten bookings covering the whole spectrum.
 *
 * Deliberately weighted towards `+919000000001`: the acceptance rate needs at
 * least five decided requests before it reports anything at all, so one
 * technician has to cross that floor or the ranking signal is untestable
 * locally. The others sit below it on purpose, which is what a real young
 * marketplace looks like.
 */
const BOOKING_SEEDS: BookingSeed[] = [
  {
    key: 'requested-open',
    providerPhone: '+919000000001',
    requestedHoursAgo: 1,
    priceCardType: 'fixed',
    events: [{ eventType: 'requested', actorType: 'customer', offsetMinutes: 0 }],
  },
  {
    key: 'accepted-upcoming',
    providerPhone: '+919000000001',
    requestedHoursAgo: 2,
    priceCardType: 'fixed',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 3 },
    ],
  },
  {
    key: 'en-route',
    providerPhone: '+919000000001',
    requestedHoursAgo: 3,
    priceCardType: 'fixed',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 2 },
      { eventType: 'en_route', actorType: 'provider', offsetMinutes: 55 },
    ],
  },
  {
    key: 'in-progress',
    providerPhone: '+919000000007',
    requestedHoursAgo: 4,
    priceCardType: 'inspection_based',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 4 },
      { eventType: 'en_route', actorType: 'provider', offsetMinutes: 40 },
      { eventType: 'arrived', actorType: 'provider', offsetMinutes: 58 },
      { eventType: 'work_started', actorType: 'provider', offsetMinutes: 60 },
      { eventType: 'quote_sent', actorType: 'provider', offsetMinutes: 72 },
    ],
    // Sitting with the customer right now: the fridge is open, the price is not.
    quotes: [
      {
        labourPaise: 60_000,
        items: [
          { kind: 'part', description: 'Relay and overload protector', qty: 1, unitPaise: 45_000 },
          { kind: 'part', description: 'Refrigerant gas top-up (grams)', qty: 120, unitPaise: 300 },
        ],
        note: 'Compressor is fine. Relay has burnt out and gas is low.',
        status: 'sent',
        offsetMinutes: 72,
      },
    ],
  },
  {
    key: 'completed',
    providerPhone: '+919000000001',
    requestedHoursAgo: 48,
    priceCardType: 'fixed',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 6 },
      { eventType: 'en_route', actorType: 'provider', offsetMinutes: 35 },
      { eventType: 'arrived', actorType: 'provider', offsetMinutes: 52 },
      { eventType: 'work_started', actorType: 'provider', offsetMinutes: 55 },
      { eventType: 'work_done', actorType: 'provider', offsetMinutes: 130 },
    ],
  },
  {
    key: 'completed-after-otp-retry',
    providerPhone: '+919000000007',
    requestedHoursAgo: 72,
    priceCardType: 'fixed',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 2 },
      { eventType: 'arrived', actorType: 'provider', offsetMinutes: 48 },
      // Evidence, not a transition: the machine leaves the status alone.
      {
        eventType: 'otp_failed',
        actorType: 'provider',
        offsetMinutes: 49,
        payload: { kind: 'start', attempt: 1 },
      },
      { eventType: 'work_started', actorType: 'provider', offsetMinutes: 51 },
      { eventType: 'work_done', actorType: 'provider', offsetMinutes: 120 },
    ],
  },
  {
    /**
     * The quotation path, straight through: quoted, agreed, done.
     *
     * The visit fee is waived into the bill, so the payable is the quote total
     * alone — the case the whole fee-waiver rule exists for.
     */
    key: 'completed-via-quote',
    providerPhone: '+919000000007',
    requestedHoursAgo: 96,
    priceCardType: 'inspection_based',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 3 },
      { eventType: 'en_route', actorType: 'provider', offsetMinutes: 30 },
      { eventType: 'arrived', actorType: 'provider', offsetMinutes: 47 },
      { eventType: 'work_started', actorType: 'provider', offsetMinutes: 50 },
      { eventType: 'quote_sent', actorType: 'provider', offsetMinutes: 58 },
      { eventType: 'quote_approved', actorType: 'customer', offsetMinutes: 64 },
      { eventType: 'work_done', actorType: 'provider', offsetMinutes: 145 },
    ],
    quotes: [
      {
        labourPaise: 45_000,
        items: [{ kind: 'part', description: 'Door gasket', qty: 1, unitPaise: 85_000 }],
        note: 'Gasket perished; door not sealing.',
        status: 'approved',
        offsetMinutes: 58,
      },
    ],
  },
  {
    /**
     * Haggling, which is how this actually goes.
     *
     * v1 was too expensive, the technician dropped the imported part for a local
     * one, and v2 was agreed. Both versions survive — that is the point of
     * versioning rather than editing.
     */
    key: 'completed-after-revision',
    providerPhone: '+919000000007',
    requestedHoursAgo: 120,
    priceCardType: 'inspection_based',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 4 },
      { eventType: 'arrived', actorType: 'provider', offsetMinutes: 44 },
      { eventType: 'work_started', actorType: 'provider', offsetMinutes: 46 },
      { eventType: 'quote_sent', actorType: 'provider', offsetMinutes: 55 },
      {
        eventType: 'quote_rejected',
        actorType: 'customer',
        offsetMinutes: 62,
        payload: { reason: 'Too expensive, please suggest a cheaper part' },
      },
      { eventType: 'quote_sent', actorType: 'provider', offsetMinutes: 70 },
      { eventType: 'quote_approved', actorType: 'customer', offsetMinutes: 76 },
      { eventType: 'work_done', actorType: 'provider', offsetMinutes: 160 },
    ],
    quotes: [
      {
        labourPaise: 50_000,
        items: [{ kind: 'part', description: 'Imported thermostat', qty: 1, unitPaise: 190_000 }],
        status: 'rejected',
        decisionNote: 'Too expensive, please suggest a cheaper part',
        offsetMinutes: 55,
      },
      {
        labourPaise: 50_000,
        items: [
          {
            kind: 'part',
            description: 'Local thermostat (6 month warranty)',
            qty: 1,
            unitPaise: 95_000,
          },
        ],
        note: 'Local part, six month warranty instead of two years.',
        status: 'approved',
        offsetMinutes: 70,
      },
    ],
  },
  {
    /**
     * The customer heard the price and sent the technician away.
     *
     * The visit happened, so the visit fee is payable and nothing else is. Note
     * the two steps: the quote was rejected, and then — separately — the job was
     * declined. A rejection alone would have invited a revision.
     */
    key: 'declined-after-quote',
    providerPhone: '+919000000003',
    requestedHoursAgo: 144,
    priceCardType: 'inspection_based',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 5 },
      { eventType: 'arrived', actorType: 'provider', offsetMinutes: 50 },
      { eventType: 'work_started', actorType: 'provider', offsetMinutes: 52 },
      { eventType: 'quote_sent', actorType: 'provider', offsetMinutes: 61 },
      {
        eventType: 'quote_rejected',
        actorType: 'customer',
        offsetMinutes: 70,
        payload: { reason: 'Will get a second opinion' },
      },
      {
        eventType: 'work_declined',
        actorType: 'customer',
        offsetMinutes: 74,
        payload: { note: 'Getting another quote first' },
      },
    ],
    quotes: [
      {
        labourPaise: 120_000,
        items: [
          {
            kind: 'part',
            description: 'Submersible pump winding wire (kg)',
            qty: 3,
            unitPaise: 78_000,
          },
          {
            kind: 'labour_extra',
            description: 'Pump extraction from borewell',
            qty: 1,
            unitPaise: 150_000,
          },
        ],
        note: 'Winding is fully burnt; the pump has to come out.',
        status: 'rejected',
        decisionNote: 'Will get a second opinion',
        offsetMinutes: 61,
      },
    ],
  },
  {
    key: 'rejected-too-far',
    providerPhone: '+919000000001',
    requestedHoursAgo: 96,
    priceCardType: 'fixed',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      {
        eventType: 'rejected',
        actorType: 'provider',
        offsetMinutes: 8,
        payload: { reason: 'too_far' },
      },
    ],
  },
  {
    key: 'expired-unanswered',
    providerPhone: '+919000000001',
    requestedHoursAgo: 120,
    priceCardType: 'fixed',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'expired', actorType: 'system', offsetMinutes: 15 },
    ],
  },
  {
    key: 'cancelled-by-customer',
    providerPhone: '+919000000001',
    requestedHoursAgo: 144,
    priceCardType: 'fixed',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 5 },
      {
        eventType: 'cancelled_by_customer',
        actorType: 'customer',
        offsetMinutes: 90,
        payload: { reason: 'found_other' },
      },
    ],
  },
  {
    key: 'cancelled-by-provider',
    providerPhone: '+919000000009',
    requestedHoursAgo: 168,
    priceCardType: 'fixed',
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 3 },
      {
        eventType: 'cancelled_by_provider',
        actorType: 'provider',
        offsetMinutes: 200,
        payload: { reason: 'vehicle_issue' },
      },
    ],
  },
];

/** Statuses in which the booking still holds its slot. */
const HOLDING_STATUSES = ['REQUESTED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] as const;

const quoteTotal = (quote: QuoteSeed): number =>
  computeQuotationTotals(quote.labourPaise, quote.items).totalPaise;

/** The API's own resolution chain, over the API's own pure function. */
async function resolveSeedVisitFee(
  prisma: PrismaClient,
  cityId: number,
  categoryId: number,
): Promise<number> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { parentId: true },
  });

  const parentCategoryId = category?.parentId ?? null;

  const rows = await prisma.feeConfig.findMany({
    where: {
      cityId,
      isActive: true,
      OR: [
        { categoryId: null },
        { categoryId: { in: [categoryId, ...(parentCategoryId ? [parentCategoryId] : [])] } },
      ],
    },
    select: { categoryId: true, visitFeePaise: true, isActive: true, effectiveFrom: true },
  });

  return resolveVisitFee(rows, { categoryId, parentCategoryId }, DEFAULT_VISIT_FEE_PAISE)
    .visitFeePaise;
}

export interface BookingSeedSummary {
  slots: number;
  bookings: number;
  skipped: number;
}

export async function seedBookings(
  prisma: PrismaClient,
  cityId: number,
  now: Date = new Date(),
): Promise<BookingSeedSummary> {
  const slots = await seedSlots(prisma, now);

  const customer = await prisma.user.findUnique({
    where: { phone: SEED_CUSTOMER_PHONE },
    select: { id: true },
  });

  if (!customer)
    throw new Error('booking seed needs the seeded customer; run the customer seed first');

  const address = await prisma.address.findFirst({
    where: { userId: customer.id, isDefault: true },
    select: { id: true, addressText: true, landmark: true, label: true },
  });

  if (!address) throw new Error('booking seed needs the customer to have a default address');

  let created = 0;
  let skipped = 0;

  for (const seed of BOOKING_SEEDS) {
    const bookingId = deterministicUuid(`booking:${seed.key}`);

    // Append-only history: a booking that exists is already correct, and there
    // is no honest way to rewrite it.
    const existing = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    const provider = await prisma.user.findUnique({
      where: { phone: seed.providerPhone },
      select: { id: true },
    });

    if (!provider)
      throw new Error(`booking seed refers to unknown technician ${seed.providerPhone}`);

    /**
     * The price card decides the pricing path, so it decides the category too.
     *
     * A booking made against a `fixed` card can finish without a quotation; one
     * made against `inspection_based` cannot. Picking the card first and taking
     * its category means the fixture always exercises the path it claims to.
     */
    const priceCard = seed.priceCardType
      ? await prisma.providerPriceCard.findFirst({
          where: { providerId: provider.id, priceType: seed.priceCardType, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, categoryId: true, priceType: true, amountPaise: true },
        })
      : null;

    if (seed.priceCardType && !priceCard) {
      throw new Error(
        `technician ${seed.providerPhone} has no ${seed.priceCardType} price card for seed "${seed.key}"`,
      );
    }

    const skill = priceCard
      ? { categoryId: priceCard.categoryId }
      : await prisma.providerSkill.findFirst({
          where: { providerId: provider.id },
          select: { categoryId: true },
        });

    if (!skill) throw new Error(`technician ${seed.providerPhone} has no skill to book`);

    // Replay before writing. A fixture the machine rejects would make every
    // test that reads it meaningless.
    const status = projectBookingStatus(
      seed.events.map((event) => ({ eventType: event.eventType, actorType: event.actorType })),
    );

    const createdAt = new Date(now.getTime() - seed.requestedHoursAgo * 60 * 60 * 1000);
    const holdsSlot = (HOLDING_STATUSES as readonly string[]).includes(status);

    /**
     * A live booking takes the technician's next free hour; a finished one gets
     * a synthetic past time. Claiming the *earliest* open slot each time also
     * means the seeded bookings pile up at the front of the calendar, which is
     * what makes the double-booking constraint worth anything locally — the
     * next seed run has to route around them.
     */
    const claimed = holdsSlot
      ? await prisma.slot.findFirst({
          where: { providerId: provider.id, status: 'open', startsAt: { gt: now } },
          orderBy: { startsAt: 'asc' },
          select: { id: true, startsAt: true, endsAt: true },
        })
      : null;

    if (holdsSlot && !claimed) {
      throw new Error(
        `technician ${seed.providerPhone} has no open slot left for seed "${seed.key}"`,
      );
    }

    const startsAt = claimed?.startsAt ?? createdAt;
    const endsAt =
      claimed?.endsAt ?? new Date(startsAt.getTime() + SLOT_INCREMENT_MINUTES * 60 * 1000);

    // Resolved exactly as the API resolves it, so a seeded booking and a
    // booked-through-the-app one can never disagree about the visit fee.
    const visitFeePaise = await resolveSeedVisitFee(prisma, cityId, skill.categoryId);

    const quotes = seed.quotes ?? [];
    const approved = quotes.find((quote) => quote.status === 'approved');
    const approvedTotal = approved ? quoteTotal(approved) : null;

    /**
     * The bill, computed by the same pure function the API freezes.
     *
     * Only billable endings get one: a rejected or cancelled booking owes
     * nothing and must not acquire a payable just because it is terminal.
     */
    const payable = isBillableBooking(status)
      ? computePayable({
          outcome: status,
          visitFeePaise,
          approvedQuoteTotalPaise: approvedTotal,
          priceCard: priceCard
            ? { priceType: priceCard.priceType, amountPaise: priceCard.amountPaise }
            : null,
        })
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.booking.create({
        data: {
          id: bookingId,
          customerId: customer.id,
          providerId: provider.id,
          categoryId: skill.categoryId,
          priceCardId: priceCard?.id ?? null,
          addressId: address.id,
          addressSnapshot: {
            label: address.label,
            addressText: address.addressText,
            landmark: address.landmark,
            cityId,
          },
          startsAt,
          endsAt,
          problemNote: `Seeded booking: ${seed.key.replace(/-/g, ' ')}`,
          visitFeePaise,
          status,
          createdAt,
          ...(payable
            ? {
                payablePaise: payable.payablePaise,
                payableBreakdown: payable as unknown as Prisma.InputJsonObject,
              }
            : {}),
        },
      });

      for (const [index, quote] of quotes.entries()) {
        const totals = computeQuotationTotals(quote.labourPaise, quote.items);
        const decidedAt =
          quote.status === 'sent'
            ? null
            : new Date(createdAt.getTime() + (quote.offsetMinutes + 5) * 60 * 1000);

        await tx.quotation.create({
          data: {
            id: deterministicUuid(`quotation:${seed.key}:${index}`),
            bookingId,
            version: index + 1,
            status: quote.status,
            labourPaise: quote.labourPaise,
            partsTotalPaise: totals.partsTotalPaise,
            totalPaise: totals.totalPaise,
            note: quote.note ?? null,
            createdById: provider.id,
            decidedAt,
            decisionNote: quote.status === 'rejected' ? (quote.decisionNote ?? null) : null,
            createdAt: new Date(createdAt.getTime() + quote.offsetMinutes * 60 * 1000),
            items: {
              create: quote.items.map((item, itemIndex) => ({
                id: deterministicUuid(`quotation-item:${seed.key}:${index}:${itemIndex}`),
                kind: item.kind,
                description: item.description,
                qty: item.qty,
                unitPaise: item.unitPaise,
                lineTotalPaise: totals.lineTotals[itemIndex] as number,
              })),
            },
          },
        });
      }

      for (const [index, event] of seed.events.entries()) {
        await tx.bookingEvent.create({
          data: {
            id: deterministicUuid(`booking-event:${seed.key}:${index}`),
            bookingId,
            eventType: event.eventType,
            actorType: event.actorType,
            actorUserId:
              event.actorType === 'customer'
                ? customer.id
                : event.actorType === 'provider'
                  ? provider.id
                  : null,
            payload: event.payload ?? {},
            createdAt: new Date(createdAt.getTime() + event.offsetMinutes * 60 * 1000),
          },
        });
      }

      /**
       * The claim goes through the exclusion constraint like any other write,
       * so a seed that accidentally double-booked a technician fails loudly here
       * rather than producing a database no test could trust. Guarding on
       * `status: 'open'` means a slot taken since the read is left alone and the
       * count comes back zero — which the check below turns into an error.
       */
      if (claimed) {
        const taken = await tx.slot.updateMany({
          where: { id: claimed.id, status: 'open' },
          data: { status: status === 'REQUESTED' ? 'held' : 'booked', bookingId },
        });

        if (taken.count === 0) {
          throw new Error(`slot ${claimed.id} was taken while seeding "${seed.key}"`);
        }
      }
    });

    created += 1;
  }

  await seedProviderStats(prisma, now);

  console.log(`bookings ready: ${created} created, ${skipped} already present`);

  return { slots, bookings: created, skipped };
}

/* -------------------------------------------------------------------------- */
/* Provider stats                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Recomputes the acceptance-rate counters from the seeded event log.
 *
 * The same recompute-don't-increment rule the projector follows, for the same
 * reason: the numbers have to be derivable from the log, or a rerun would drift
 * away from it.
 */
async function seedProviderStats(prisma: PrismaClient, now: Date): Promise<void> {
  const windowDays = 30;
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const providerIds = [...new Set(BOOKING_SEEDS.map((seed) => seed.providerPhone))];

  for (const phone of providerIds) {
    const provider = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (!provider) continue;

    const counts = await countFromLog(prisma, provider.id, since);
    const acceptanceRate = computeAcceptanceRate(counts);

    await prisma.providerStats.upsert({
      where: { providerId: provider.id },
      update: { ...counts, acceptanceRate, windowDays },
      create: { providerId: provider.id, ...counts, acceptanceRate, windowDays },
    });
  }
}

async function countFromLog(
  prisma: PrismaClient,
  providerId: string,
  since: Date,
): Promise<{
  acceptedCount: number;
  rejectedCount: number;
  expiredCount: number;
  cancelledByProviderCount: number;
}> {
  const rows = await prisma.bookingEvent.groupBy({
    by: ['eventType'],
    where: {
      createdAt: { gte: since },
      booking: { providerId },
      eventType: { in: ['accepted', 'rejected', 'expired', 'cancelled_by_provider'] },
    },
    _count: { _all: true },
  });

  const of = (type: string): number => rows.find((row) => row.eventType === type)?._count._all ?? 0;

  return {
    acceptedCount: of('accepted'),
    rejectedCount: of('rejected'),
    expiredCount: of('expired'),
    cancelledByProviderCount: of('cancelled_by_provider'),
  };
}
