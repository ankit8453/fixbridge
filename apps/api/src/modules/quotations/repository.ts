// All Prisma for quotations. The interesting parts are the two race guards.
import { Prisma } from '@prisma/client';
import type { PrismaClient, Quotation, QuotationItem, QuotationStatus } from '@prisma/client';
import { enqueueOutbox } from '../../core/outbox';
import type { BookingActor, BookingEventType } from '../bookings/state-machine';

export type QuotationWithItems = Quotation & { items: QuotationItem[] };

/** Statuses in which a quotation is the booking's live price. */
export const LIVE_QUOTATION_STATUSES: QuotationStatus[] = ['sent', 'approved'];

/** Postgres raises this when a unique index refuses a duplicate. */
export const UNIQUE_VIOLATION = 'P2002';

/**
 * Did this failure come from one of the quotation uniqueness guards?
 *
 * Both races land here and both mean the same thing to the caller — somebody
 * else got there first — so they share a detector:
 *
 *   * `quotations_booking_id_version_key` — two sends both computed the same
 *     next version number;
 *   * `quotations_one_live_per_booking_idx` — an approval left a live row where
 *     a revision expected to insert one.
 *
 * The matching is on the **columns**, not the index names. Prisma reports a
 * `P2002` as the field list (`booking_id`, `version`) and never names a partial
 * index at all, so a name-based check silently fails — which is exactly how a
 * lost race turned into a 500 rather than a 409 the first time this was written.
 * Both indexes lead with `booking_id`, so that is the reliable signal.
 */
export function isLiveQuotationConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];

    return fields.some((field) => field.includes('booking_id') || field.includes('quotations'));
  }

  // Raw SQL surfaces as P2010 with Postgres's own text buried in `meta`.
  const meta = (error as { meta?: { message?: string } }).meta;
  const text = `${error instanceof Error ? error.message : String(error)}\n${meta?.message ?? ''}`;

  return (
    text.includes('quotations_one_live_per_booking_idx') ||
    text.includes('quotations_booking_id_version_key') ||
    /Key \(booking_id(, version)?\)=.* already exists/.test(text)
  );
}

/** Thrown when a quote moved under us between reading it and deciding it. */
export class QuotationRaceLostError extends Error {
  constructor(readonly quotationId: string) {
    super(`Quotation ${quotationId} was decided by someone else first`);
    this.name = 'QuotationRaceLostError';
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

const withItems = { items: { orderBy: { createdAt: 'asc' } } } as const;

export function findQuotation(
  prisma: PrismaClient,
  id: string,
): Promise<QuotationWithItems | null> {
  return prisma.quotation.findUnique({ where: { id }, include: withItems });
}

export function listQuotationsForBooking(
  prisma: PrismaClient,
  bookingId: string,
): Promise<QuotationWithItems[]> {
  return prisma.quotation.findMany({
    where: { bookingId },
    include: withItems,
    orderBy: { version: 'asc' },
  });
}

/** The live quote, whatever state it is in. At most one exists, by index. */
export function findLiveQuotation(
  prisma: PrismaClient,
  bookingId: string,
): Promise<QuotationWithItems | null> {
  return prisma.quotation.findFirst({
    where: { bookingId, status: { in: LIVE_QUOTATION_STATUSES } },
    include: withItems,
  });
}

export interface LiveQuotationSummary {
  pendingId: string | null;
  approvedId: string | null;
  approvedTotalPaise: number | null;
}

/**
 * Everything the WORK_DONE guards need, in one query.
 *
 * Returned as a summary rather than a row so the guard reads as a question about
 * the booking ("is a price still being argued about?") rather than as a lookup.
 */
export async function summariseLiveQuotation(
  prisma: PrismaClient,
  bookingId: string,
): Promise<LiveQuotationSummary> {
  const live = await prisma.quotation.findFirst({
    where: { bookingId, status: { in: LIVE_QUOTATION_STATUSES } },
    select: { id: true, status: true, totalPaise: true },
  });

  if (!live) return { pendingId: null, approvedId: null, approvedTotalPaise: null };

  return live.status === 'approved'
    ? { pendingId: null, approvedId: live.id, approvedTotalPaise: live.totalPaise }
    : { pendingId: live.id, approvedId: null, approvedTotalPaise: null };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateQuotationRow {
  bookingId: string;
  createdById: string;
  labourPaise: number;
  partsTotalPaise: number;
  totalPaise: number;
  note: string | null;
  items: {
    kind: 'part' | 'labour_extra';
    description: string;
    qty: number;
    unitPaise: number;
    lineTotalPaise: number;
  }[];
}

export interface QuotationEventInput {
  eventType: BookingEventType;
  actorType: BookingActor;
  actorUserId: string;
  topic: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Sends a revision: supersede whatever was live, insert the new version, write
 * the booking event and the outbox row — all in one transaction.
 *
 * The version number is read inside the transaction and the insert is guarded by
 * `(booking_id, version)` unique, so two concurrent sends cannot both claim v2.
 * The partial one-live index then catches the case where the previous quote was
 * approved rather than superseded. Neither guard is trusted alone.
 */
export async function createQuotationWithSupersede(
  prisma: PrismaClient,
  input: CreateQuotationRow,
  event: (quotation: Quotation) => QuotationEventInput,
): Promise<QuotationWithItems> {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.quotation.findFirst({
      where: { bookingId: input.bookingId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const version = (previous?.version ?? 0) + 1;

    // Only a `sent` quote is superseded. An `approved` one is left alone so the
    // insert below collides with it — an approved price is final, and refusing
    // loudly is better than silently overwriting it.
    await tx.quotation.updateMany({
      where: { bookingId: input.bookingId, status: 'sent' },
      data: { status: 'superseded', decidedAt: new Date() },
    });

    const created = await tx.quotation.create({
      data: {
        bookingId: input.bookingId,
        version,
        status: 'sent',
        labourPaise: input.labourPaise,
        partsTotalPaise: input.partsTotalPaise,
        totalPaise: input.totalPaise,
        note: input.note,
        createdById: input.createdById,
        items: { create: input.items },
      },
      include: withItems,
    });

    const details = event(created);

    await tx.bookingEvent.create({
      data: {
        bookingId: input.bookingId,
        eventType: details.eventType,
        actorType: details.actorType,
        actorUserId: details.actorUserId,
        payload: details.payload,
      },
    });

    await enqueueOutbox(tx, {
      topic: details.topic,
      aggregateType: 'booking',
      aggregateId: input.bookingId,
      payload: details.payload,
    });

    return created;
  });
}

/**
 * Moves a quotation out of `sent`, with the event and outbox row alongside it.
 *
 * The `status: 'sent'` guard in the WHERE is the optimistic lock: a customer
 * approving a quote the provider has just superseded updates zero rows and gets
 * a 409 rather than resurrecting a dead price. The database trigger refuses the
 * same move independently, so a bug here cannot rewrite history either.
 */
export async function decideQuotation(
  prisma: PrismaClient,
  quotationId: string,
  next: Exclude<QuotationStatus, 'sent'>,
  decisionNote: string | null,
  event: QuotationEventInput & { bookingId: string },
  decidedAt: Date = new Date(),
): Promise<QuotationWithItems> {
  return prisma.$transaction(async (tx) => {
    const moved = await tx.quotation.updateMany({
      where: { id: quotationId, status: 'sent' },
      data: { status: next, decidedAt, decisionNote },
    });

    if (moved.count === 0) throw new QuotationRaceLostError(quotationId);

    await tx.bookingEvent.create({
      data: {
        bookingId: event.bookingId,
        eventType: event.eventType,
        actorType: event.actorType,
        actorUserId: event.actorUserId,
        payload: event.payload,
      },
    });

    await enqueueOutbox(tx, {
      topic: event.topic,
      aggregateType: 'booking',
      aggregateId: event.bookingId,
      payload: event.payload,
    });

    const reloaded = await tx.quotation.findUnique({
      where: { id: quotationId },
      include: withItems,
    });

    if (!reloaded) throw new QuotationRaceLostError(quotationId);
    return reloaded;
  });
}

/* -------------------------------------------------------------------------- */
/* Fee config                                                                 */
/* -------------------------------------------------------------------------- */

export interface FeeConfigCandidate {
  categoryId: number | null;
  visitFeePaise: number;
  isActive: boolean;
  effectiveFrom: Date;
}

/**
 * Every row that could price this booking's visit: the exact service, its
 * cluster, and the city default. Resolution happens in a pure function.
 */
export function listFeeConfig(
  prisma: PrismaClient,
  cityId: number,
  categoryIds: number[],
): Promise<FeeConfigCandidate[]> {
  return prisma.feeConfig.findMany({
    where: {
      cityId,
      isActive: true,
      OR: [{ categoryId: null }, { categoryId: { in: categoryIds } }],
    },
    select: { categoryId: true, visitFeePaise: true, isActive: true, effectiveFrom: true },
  });
}

export { Prisma };
