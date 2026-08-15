import type { Prisma, PrismaClient } from '@prisma/client';
import { computeAcceptanceRate } from '../../src/modules/bookings/stats';
import {
  planSlots,
  type AvailabilityTemplateLike,
  type PlannedSlot,
} from '../../src/modules/bookings/slot-plan';
import {
  projectBookingStatus,
  type BookingActor,
  type BookingEventType,
} from '../../src/modules/bookings/state-machine';
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

/** Matches the config default. The seed does not load app config. */
const SLOT_INCREMENT_MINUTES = 60;
const SLOT_HORIZON_DAYS = 14;
const VISIT_FEE_PAISE = 4_900;

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
  events: EventSeed[];
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
    events: [{ eventType: 'requested', actorType: 'customer', offsetMinutes: 0 }],
  },
  {
    key: 'accepted-upcoming',
    providerPhone: '+919000000001',
    requestedHoursAgo: 2,
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 3 },
    ],
  },
  {
    key: 'en-route',
    providerPhone: '+919000000001',
    requestedHoursAgo: 3,
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
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'accepted', actorType: 'provider', offsetMinutes: 4 },
      { eventType: 'en_route', actorType: 'provider', offsetMinutes: 40 },
      { eventType: 'arrived', actorType: 'provider', offsetMinutes: 58 },
      { eventType: 'work_started', actorType: 'provider', offsetMinutes: 60 },
    ],
  },
  {
    key: 'completed',
    providerPhone: '+919000000001',
    requestedHoursAgo: 48,
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
    key: 'rejected-too-far',
    providerPhone: '+919000000001',
    requestedHoursAgo: 96,
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
    events: [
      { eventType: 'requested', actorType: 'customer', offsetMinutes: 0 },
      { eventType: 'expired', actorType: 'system', offsetMinutes: 15 },
    ],
  },
  {
    key: 'cancelled-by-customer',
    providerPhone: '+919000000001',
    requestedHoursAgo: 144,
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

    const skill = await prisma.providerSkill.findFirst({
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

    await prisma.$transaction(async (tx) => {
      await tx.booking.create({
        data: {
          id: bookingId,
          customerId: customer.id,
          providerId: provider.id,
          categoryId: skill.categoryId,
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
          visitFeePaise: VISIT_FEE_PAISE,
          status,
          createdAt,
        },
      });

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
