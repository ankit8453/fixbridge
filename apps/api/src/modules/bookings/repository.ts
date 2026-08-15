// All Prisma and raw SQL for slots and bookings.
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Booking, BookingEvent, PrismaClient, Slot, SlotStatus } from '@prisma/client';
import { enqueueOutbox } from '../../core/outbox';
import type { BookingActor, BookingEventType, BookingStatus } from './state-machine';
import type { PlannedSlot } from './slot-plan';

export type BookingWithEvents = Booking & { events: BookingEvent[] };

/** Postgres raises this when the exclusion constraint refuses an overlap. */
export const EXCLUSION_VIOLATION = '23P01';

export function isDoubleBookingError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Prisma surfaces exclusion violations as P2010 with the driver code inside.
    const meta = error.meta as { code?: string } | undefined;
    if (meta?.code === EXCLUSION_VIOLATION) return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes('slots_no_double_booking') || message.includes(EXCLUSION_VIOLATION);
}

/* -------------------------------------------------------------------------- */
/* Slots                                                                      */
/* -------------------------------------------------------------------------- */

export function findSlot(prisma: PrismaClient, slotId: string): Promise<Slot | null> {
  return prisma.slot.findUnique({ where: { id: slotId } });
}

export function listProviderSlots(
  prisma: PrismaClient,
  providerId: string,
  from: Date,
  to: Date,
  statuses: SlotStatus[],
): Promise<Slot[]> {
  return prisma.slot.findMany({
    where: { providerId, startsAt: { gte: from, lt: to }, status: { in: statuses } },
    orderBy: { startsAt: 'asc' },
  });
}

export function listExistingSlotsForPlanning(
  prisma: PrismaClient,
  providerId: string,
  from: Date,
  to: Date,
): Promise<Pick<Slot, 'id' | 'startsAt' | 'endsAt' | 'status'>[]> {
  return prisma.slot.findMany({
    where: { providerId, startsAt: { gte: from, lt: to } },
    select: { id: true, startsAt: true, endsAt: true, status: true },
    orderBy: { startsAt: 'asc' },
  });
}

/**
 * Applies a reconciliation.
 *
 * Deletes are scoped to `status = 'open'` in the WHERE clause as well as being
 * pre-filtered, because "never delete a booked slot" is too important to rely on
 * the caller having got the list right.
 */
export async function applySlotPlan(
  prisma: PrismaClient,
  providerId: string,
  toCreate: PlannedSlot[],
  toDeleteIds: string[],
): Promise<{ created: number; deleted: number }> {
  return prisma.$transaction(async (tx) => {
    let deleted = 0;

    if (toDeleteIds.length > 0) {
      const result = await tx.slot.deleteMany({
        where: { id: { in: toDeleteIds }, providerId, status: 'open' },
      });
      deleted = result.count;
    }

    let created = 0;

    if (toCreate.length > 0) {
      /**
       * Raw, because Prisma refuses to generate `createMany` for a model that
       * has an `Unsupported` column — `time_range` here. Which is fine: the
       * BEFORE INSERT trigger derives it from starts_at/ends_at, so the insert
       * genuinely does not name it, and `id`/`updated_at` are supplied because
       * their Prisma defaults are client-side and a raw insert bypasses them.
       *
       * The exclusion constraint still applies. It cannot fire on `open` slots
       * (the constraint is scoped to held/booked), but if it ever did, the whole
       * transaction rolls back rather than half a horizon landing.
       */
      const values = toCreate.map(
        (slot) =>
          Prisma.sql`(${randomUUID()}::uuid, ${providerId}::uuid, ${slot.startsAt}, ${slot.endsAt}, 'open'::slot_status, ${slot.sourceTemplateId}::uuid, CURRENT_TIMESTAMP)`,
      );

      created = await tx.$executeRaw`
        INSERT INTO slots (id, provider_id, starts_at, ends_at, status, source_template_id, updated_at)
        VALUES ${Prisma.join(values)}
      `;
    }

    return { created, deleted };
  });
}

export async function setSlotStatus(
  tx: Prisma.TransactionClient,
  slotId: string,
  status: SlotStatus,
  bookingId: string | null,
): Promise<void> {
  await tx.slot.update({ where: { id: slotId }, data: { status, bookingId } });
}

/** Provider blocking or unblocking their own time. Only `open` ↔ `blocked`. */
export async function toggleSlotBlocked(
  prisma: PrismaClient,
  providerId: string,
  slotId: string,
  blocked: boolean,
): Promise<Slot | null> {
  const result = await prisma.slot.updateMany({
    where: { id: slotId, providerId, status: blocked ? 'open' : 'blocked' },
    data: { status: blocked ? 'blocked' : 'open' },
  });

  if (result.count === 0) return null;
  return prisma.slot.findUnique({ where: { id: slotId } });
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

export function findBooking(prisma: PrismaClient, id: string): Promise<BookingWithEvents | null> {
  return prisma.booking.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
}

export function listBookingsForCustomer(
  prisma: PrismaClient,
  customerId: string,
): Promise<BookingWithEvents[]> {
  return prisma.booking.findMany({
    where: { customerId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
}

export function listBookingsForProvider(
  prisma: PrismaClient,
  providerId: string,
): Promise<BookingWithEvents[]> {
  return prisma.booking.findMany({
    where: { providerId },
    include: { events: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
}

export interface CreateBookingInput {
  id: string;
  customerId: string;
  providerId: string;
  categoryId: number;
  priceCardId: string | null;
  addressId: string | null;
  addressSnapshot: Prisma.InputJsonValue;
  slotId: string;
  startsAt: Date;
  endsAt: Date;
  problemNote: string | null;
  visitFeePaise: number;
}

/**
 * Creates the booking, holds the slot, writes the first event and the outbox row
 * — all in one transaction.
 *
 * If any of those four fails, none of them happened. That is the whole point of
 * the outbox: there is no window in which the slot is held but nobody knows, or
 * an event exists for a booking that was rolled back.
 *
 * The slot update is guarded by `status = 'open'`: two racers both reading an
 * open slot will still have one of them update zero rows, and the exclusion
 * constraint catches anything that slips past even that.
 *
 * The booking is written **before** the slot is claimed, because `slots.booking_id`
 * is a plain (non-deferrable) foreign key — claiming first would point at a row
 * that does not exist yet. Ordering costs nothing: a losing racer's booking is
 * rolled back with everything else when the claim comes back empty.
 */
export async function createBookingWithHold(
  prisma: PrismaClient,
  input: CreateBookingInput,
  topic: string,
  payload: Prisma.InputJsonValue,
): Promise<BookingWithEvents> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        id: input.id,
        customerId: input.customerId,
        providerId: input.providerId,
        categoryId: input.categoryId,
        priceCardId: input.priceCardId,
        addressId: input.addressId,
        addressSnapshot: input.addressSnapshot,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        problemNote: input.problemNote,
        visitFeePaise: input.visitFeePaise,
        status: 'REQUESTED',
        events: {
          create: {
            eventType: 'requested',
            actorType: 'customer',
            actorUserId: input.customerId,
            payload,
          },
        },
      },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });

    const claimed = await tx.slot.updateMany({
      where: { id: input.slotId, status: 'open' },
      data: { status: 'held', bookingId: booking.id },
    });

    if (claimed.count === 0) {
      throw new SlotUnavailableError(input.slotId);
    }

    await enqueueOutbox(tx, {
      topic,
      aggregateType: 'booking',
      aggregateId: booking.id,
      payload,
    });

    return booking;
  });
}

/** Thrown when the slot was taken between reading it and claiming it. */
export class SlotUnavailableError extends Error {
  constructor(readonly slotId: string) {
    super(`Slot ${slotId} is no longer available`);
    this.name = 'SlotUnavailableError';
  }
}

export interface TransitionInput {
  bookingId: string;
  eventType: BookingEventType;
  actorType: BookingActor;
  actorUserId: string | null;
  payload: Prisma.InputJsonValue;
  nextStatus: BookingStatus;
  /** What the slot should become, if anything. */
  slot?: { id: string; status: SlotStatus; bookingId: string | null };
  topic: string;
}

/**
 * One transition: event row, status projection, slot change and outbox row, in a
 * single transaction. Every state change in this module goes through here.
 */
export async function applyTransition(
  prisma: PrismaClient,
  input: TransitionInput,
): Promise<BookingWithEvents> {
  return prisma.$transaction(async (tx) => {
    await tx.bookingEvent.create({
      data: {
        bookingId: input.bookingId,
        eventType: input.eventType,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        payload: input.payload,
      },
    });

    await tx.booking.update({
      where: { id: input.bookingId },
      data: { status: input.nextStatus },
    });

    if (input.slot) {
      await setSlotStatus(tx, input.slot.id, input.slot.status, input.slot.bookingId);
    }

    await enqueueOutbox(tx, {
      topic: input.topic,
      aggregateType: 'booking',
      aggregateId: input.bookingId,
      payload: input.payload,
    });

    const updated = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });

    if (!updated) throw new Error(`booking ${input.bookingId} vanished mid-transaction`);
    return updated;
  });
}

export function findSlotForBooking(prisma: PrismaClient, bookingId: string): Promise<Slot | null> {
  return prisma.slot.findFirst({ where: { bookingId } });
}

/** Requests nobody answered in time. Driven by the expiry job's injected clock. */
export function findExpiredRequests(
  prisma: PrismaClient,
  olderThan: Date,
  limit: number,
): Promise<Booking[]> {
  return prisma.booking.findMany({
    where: { status: 'REQUESTED', createdAt: { lt: olderThan } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

/* -------------------------------------------------------------------------- */
/* Provider stats                                                             */
/* -------------------------------------------------------------------------- */

export interface DecidedCounts {
  acceptedCount: number;
  rejectedCount: number;
  expiredCount: number;
  cancelledByProviderCount: number;
}

/**
 * Recounts a provider's outcomes from the event log for a rolling window.
 *
 * Recomputed rather than incremented: at pilot volume this is a cheap indexed
 * count, and it means the numbers can never drift from the log they describe.
 * When volume makes it expensive, the fix is a materialised view or incremental
 * counters *with* a periodic reconciliation — not trusting increments alone.
 */
export async function countDecidedRequests(
  prisma: PrismaClient,
  providerId: string,
  since: Date,
): Promise<DecidedCounts> {
  const rows = await prisma.$queryRaw<{ eventType: string; count: bigint }[]>`
    SELECT e.event_type AS "eventType", COUNT(*)::bigint AS count
    FROM booking_events e
    JOIN bookings b ON b.id = e.booking_id
    WHERE b.provider_id = ${providerId}::uuid
      AND e.created_at >= ${since}
      AND e.event_type IN ('accepted', 'rejected', 'expired', 'cancelled_by_provider')
    GROUP BY e.event_type
  `;

  const byType = new Map(rows.map((row) => [row.eventType, Number(row.count)]));

  return {
    acceptedCount: byType.get('accepted') ?? 0,
    rejectedCount: byType.get('rejected') ?? 0,
    expiredCount: byType.get('expired') ?? 0,
    cancelledByProviderCount: byType.get('cancelled_by_provider') ?? 0,
  };
}

export async function saveProviderStats(
  prisma: PrismaClient,
  providerId: string,
  counts: DecidedCounts,
  acceptanceRate: number | null,
  windowDays: number,
): Promise<void> {
  await prisma.providerStats.upsert({
    where: { providerId },
    update: { ...counts, acceptanceRate, windowDays },
    create: { providerId, ...counts, acceptanceRate, windowDays },
  });
}

/**
 * Erasure path for bookings, mirroring the verification one.
 *
 * `booking_events` refuses DELETE, so teardown and DPDP erasure both have to
 * announce themselves with the session flag.
 */
export async function purgeBookingData(prisma: PrismaClient, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL "fixbridge.allow_kyc_purge" = 'on'`);
    // Slots reference bookings; release them before the bookings disappear.
    await tx.$executeRaw`
      UPDATE slots SET status = 'open', booking_id = NULL
      WHERE booking_id IN (
        SELECT id FROM bookings WHERE customer_id = ANY(${userIds}::uuid[]) OR provider_id = ANY(${userIds}::uuid[])
      )
    `;
    await tx.booking.deleteMany({
      where: { OR: [{ customerId: { in: userIds } }, { providerId: { in: userIds } }] },
    });
    await tx.slot.deleteMany({ where: { providerId: { in: userIds } } });
    await tx.providerStats.deleteMany({ where: { providerId: { in: userIds } } });
    await tx.outboxEvent.deleteMany({ where: { aggregateId: { in: userIds } } });
  });
}

export { Prisma };
