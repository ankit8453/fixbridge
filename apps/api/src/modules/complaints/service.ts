import type { Complaint, Prisma } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { enqueueOutbox } from '../../core/outbox';
import { suspendNow } from '../trust/service';
import { TRUST_TOPICS } from '../trust/topics';
import {
  COMPLAINABLE_BOOKING_STATUSES,
  COMPLAINT_BOOKING_EVENT,
  applyComplaintEvent,
  type ComplaintEvent,
  type ComplaintStatusName,
} from './state-machine';
import type {
  ComplaintQueueQuery,
  ComplaintQueueResponse,
  ComplaintView,
  RaiseComplaintInput,
} from './types';

/**
 * Complaints.
 *
 * Every status change lands on the **booking's** timeline as well as in this
 * table, because a dispute read six months later should be one query: what was
 * booked, what happened, what went wrong, what was decided. Splitting the story
 * across two tables joined by hand is how the version ops tell and the version
 * the technician remembers stop matching.
 */

export interface ComplaintDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: ComplaintDeps): Date => (deps.now ? deps.now() : new Date());

export function toComplaintView(complaint: Complaint): ComplaintView {
  return {
    id: complaint.id,
    bookingId: complaint.bookingId,
    category: complaint.category,
    description: complaint.description,
    status: complaint.status,
    raisedByUserId: complaint.raisedByUserId,
    againstUserId: complaint.againstUserId,
    resolutionNote: complaint.resolutionNote,
    severity: complaint.severityOnResolution,
    createdAt: complaint.createdAt.toISOString(),
    resolvedAt: complaint.resolvedAt?.toISOString() ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Raising                                                                    */
/* -------------------------------------------------------------------------- */

export async function raiseComplaint(
  deps: ComplaintDeps,
  userId: string,
  bookingId: string,
  input: RaiseComplaintInput,
): Promise<ComplaintView> {
  const { context } = deps;
  const at = nowOf(deps);

  const booking = await context.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, customerId: true, providerId: true, updatedAt: true },
  });

  const side =
    booking && booking.customerId === userId
      ? 'customer'
      : booking && booking.providerId === userId
        ? 'provider'
        : null;

  if (!booking || !side) {
    throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${bookingId} not found`, {
      messageKey: 'errors.bookings.notFound',
    });
  }

  if (!COMPLAINABLE_BOOKING_STATUSES.includes(booking.status)) {
    // Before the technician was at the door, this is a cancellation, not a
    // complaint — and calling it one would put a dispute on somebody's record
    // for a job that never started.
    throw new AppError(
      409,
      'COMPLAINT_NOT_ALLOWED',
      `A booking in ${booking.status} has nothing to complain about yet`,
      {
        messageKey: 'errors.complaints.tooEarly',
        details: { status: booking.status },
      },
    );
  }

  const windowDays = context.config.COMPLAINT_WINDOW_DAYS;
  const closesAt = new Date(booking.updatedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);

  if (at.getTime() > closesAt.getTime()) {
    throw new AppError(
      409,
      'COMPLAINT_WINDOW_CLOSED',
      `Complaints close ${windowDays} days after a job ends`,
      {
        messageKey: 'errors.complaints.windowClosed',
        details: { closedAt: closesAt.toISOString() },
      },
    );
  }

  const againstUserId = side === 'customer' ? booking.providerId : booking.customerId;

  const complaint = await context.prisma.$transaction(async (tx) => {
    const created = await tx.complaint.create({
      data: {
        bookingId,
        raisedByUserId: userId,
        againstUserId,
        category: input.category,
        description: input.description,
      },
    });

    await appendBookingEvent(tx, {
      bookingId,
      status: 'open',
      actorType: side,
      actorUserId: userId,
      payload: { complaintId: created.id, category: created.category },
    });

    await enqueueOutbox(tx, {
      topic: TRUST_TOPICS.complaintOpened,
      aggregateType: 'booking',
      aggregateId: bookingId,
      payload: {
        complaintId: created.id,
        category: created.category,
        againstUserId,
        raisedByUserId: userId,
      },
    });

    return created;
  });

  /**
   * Safety does not wait for a poll loop.
   *
   * Everything else in this system settles eventually through the outbox, which
   * is exactly right for money and exactly wrong here: if somebody says a
   * technician was unsafe in their home, that technician stops receiving
   * bookings **before this request returns**, not whenever the dispatcher next
   * runs. Ops review it and lift it if it was unfounded — a wrongly suspended
   * technician loses a day, and the alternative is somebody else opening their
   * door to a person we had already been warned about.
   *
   * Only applies when the complaint is against the technician; a customer cannot
   * be suspended, and Phase 9 does not score them at all.
   */
  if (input.category === 'safety' && side === 'customer') {
    await suspendNow(
      { context, ...(deps.now ? { now: deps.now } : {}) },
      againstUserId,
      'safety_pending_review',
      'trust.suspension.safetyPending',
    );

    context.logger.warn(
      { complaintId: complaint.id, providerId: againstUserId, bookingId },
      'safety complaint: technician suspended immediately, pending ops review',
    );
  }

  return toComplaintView(complaint);
}

/* -------------------------------------------------------------------------- */
/* Deciding                                                                   */
/* -------------------------------------------------------------------------- */

interface DecisionInput {
  event: ComplaintEvent;
  note?: string;
  severity?: 'minor' | 'major' | 'severe';
}

/**
 * Ops move a complaint. Nobody else can.
 *
 * A resolution counts against the technician; a dismissal counts for nothing at
 * all. That asymmetry is deliberate: being accused is not a record, and if it
 * were, the cheapest way to damage a competitor would be to book them once.
 */
export async function decideComplaint(
  deps: ComplaintDeps,
  opsUserId: string,
  complaintId: string,
  decision: DecisionInput,
): Promise<ComplaintView> {
  const { context } = deps;
  const at = nowOf(deps);

  const complaint = await context.prisma.complaint.findUnique({ where: { id: complaintId } });

  if (!complaint) {
    throw new AppError(404, 'COMPLAINT_NOT_FOUND', `Complaint ${complaintId} not found`, {
      messageKey: 'errors.complaints.notFound',
    });
  }

  const outcome = applyComplaintEvent(complaint.status as ComplaintStatusName, decision.event);

  if (!outcome.ok) {
    throw new AppError(
      409,
      'COMPLAINT_INVALID_TRANSITION',
      `Cannot ${decision.event} a ${complaint.status} complaint`,
      {
        messageKey:
          outcome.reason === 'terminal'
            ? 'errors.complaints.alreadyDecided'
            : 'errors.complaints.invalidTransition',
        details: { from: complaint.status },
      },
    );
  }

  const isFinal = outcome.status === 'resolved' || outcome.status === 'dismissed';

  const updated = await context.prisma.$transaction(async (tx) => {
    const moved = await tx.complaint.update({
      where: { id: complaintId },
      data: {
        status: outcome.status,
        ...(isFinal
          ? {
              resolutionNote: decision.note ?? null,
              severityOnResolution:
                outcome.status === 'resolved' ? (decision.severity ?? null) : null,
              resolvedByUserId: opsUserId,
              resolvedAt: at,
            }
          : {}),
      },
    });

    await appendBookingEvent(tx, {
      bookingId: complaint.bookingId,
      status: outcome.status,
      actorType: 'ops',
      actorUserId: opsUserId,
      payload: {
        complaintId,
        severity: moved.severityOnResolution,
        note: moved.resolutionNote,
      },
    });

    const topic =
      outcome.status === 'resolved'
        ? TRUST_TOPICS.complaintResolved
        : outcome.status === 'dismissed'
          ? TRUST_TOPICS.complaintDismissed
          : TRUST_TOPICS.complaintInReview;

    await enqueueOutbox(tx, {
      topic,
      aggregateType: 'booking',
      aggregateId: complaint.bookingId,
      payload: {
        complaintId,
        severity: moved.severityOnResolution,
        // So the trust engine rescores the right person without a lookup, and
        // never rescores a customer.
        providerId: await providerOfBooking(tx, complaint.bookingId, complaint.againstUserId),
      } satisfies Prisma.InputJsonValue,
    });

    return moved;
  });

  return toComplaintView(updated);
}

/**
 * The technician a complaint concerns, or undefined if it concerns a customer.
 *
 * Returning undefined rather than the customer's id is what stops the trust
 * engine from trying to score somebody it has no model for — customer-side data
 * is collected in v1 and scored in none of it.
 */
async function providerOfBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  againstUserId: string,
): Promise<string | undefined> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { providerId: true },
  });

  return booking?.providerId === againstUserId ? booking.providerId : undefined;
}

interface BookingEventInput {
  bookingId: string;
  status: ComplaintStatusName;
  actorType: 'customer' | 'provider' | 'ops';
  actorUserId: string;
  payload: Prisma.InputJsonValue;
}

async function appendBookingEvent(
  tx: Prisma.TransactionClient,
  input: BookingEventInput,
): Promise<void> {
  await tx.bookingEvent.create({
    data: {
      bookingId: input.bookingId,
      eventType: COMPLAINT_BOOKING_EVENT[input.status],
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      payload: input.payload,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** A party's own complaints — ones they raised, and ones against them. */
export async function listMyComplaints(
  deps: ComplaintDeps,
  userId: string,
): Promise<ComplaintView[]> {
  const complaints = await deps.context.prisma.complaint.findMany({
    where: { OR: [{ raisedByUserId: userId }, { againstUserId: userId }] },
    orderBy: { createdAt: 'desc' },
  });

  return complaints.map(toComplaintView);
}

export async function listComplaintQueue(
  deps: ComplaintDeps,
  query: ComplaintQueueQuery,
): Promise<ComplaintQueueResponse> {
  const { context } = deps;
  const where = query.status ? { status: query.status } : {};

  const [rows, total] = await Promise.all([
    context.prisma.complaint.findMany({
      where,
      // Oldest first: a queue that shows the newest first is a queue where the
      // oldest complaint is never reached.
      orderBy: { createdAt: 'asc' },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
    }),
    context.prisma.complaint.count({ where }),
  ]);

  return {
    complaints: rows.map(toComplaintView),
    page: query.page,
    pageSize: query.page_size,
    total,
  };
}

export async function getComplaint(
  deps: ComplaintDeps,
  userId: string,
  complaintId: string,
  isOps: boolean,
): Promise<ComplaintView> {
  const complaint = await deps.context.prisma.complaint.findUnique({ where: { id: complaintId } });

  const isParty =
    complaint && (complaint.raisedByUserId === userId || complaint.againstUserId === userId);

  if (!complaint || (!isOps && !isParty)) {
    throw new AppError(404, 'COMPLAINT_NOT_FOUND', `Complaint ${complaintId} not found`, {
      messageKey: 'errors.complaints.notFound',
    });
  }

  return toComplaintView(complaint);
}
