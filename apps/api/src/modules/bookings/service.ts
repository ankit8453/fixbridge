import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { maskPhone } from '../auth/phone';
import { createBookingOtpStore, type BookingOtpKind } from './otp';
import * as repo from './repository';
import {
  applyBookingEvent,
  projectBookingStatus,
  topicFor,
  type BookingActor,
  type BookingEventType,
  type BookingStatus,
} from './state-machine';
import type {
  BookingDetail,
  BookingEventView,
  CancelBookingInput,
  CreateBookingInput,
  RejectBookingInput,
  SubmitOtpInput,
} from './types';

export interface BookingDeps {
  context: AppContext;
  now?: () => Date;
}

const nowOf = (deps: BookingDeps): Date => (deps.now ? deps.now() : new Date());

const notFound = (id: string): AppError =>
  new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${id} not found`, {
    messageKey: 'errors.bookings.notFound',
  });

/* -------------------------------------------------------------------------- */
/* Transitions                                                                */
/* -------------------------------------------------------------------------- */

interface TransitionOptions {
  bookingId: string;
  eventType: BookingEventType;
  actorType: BookingActor;
  actorUserId: string | null;
  payload?: Prisma.InputJsonValue;
  slot?: { id: string; status: 'open' | 'held' | 'booked' | 'blocked'; bookingId: string | null };
}

/**
 * The single funnel for every state change.
 *
 * Reprojects from the event log before deciding, so the cached `status` column
 * is never what a transition is judged against — if the two ever disagree, the
 * log wins.
 */
async function transition(
  deps: BookingDeps,
  options: TransitionOptions,
): Promise<repo.BookingWithEvents> {
  const { context } = deps;
  const booking = await repo.findBooking(context.prisma, options.bookingId);
  if (!booking) throw notFound(options.bookingId);

  const current = projectBookingStatus(
    booking.events.map((event) => ({
      eventType: event.eventType as BookingEventType,
      actorType: event.actorType as BookingActor,
    })),
  );

  const outcome = applyBookingEvent(current, options.eventType, options.actorType);

  if (!outcome.ok) {
    const status = outcome.reason === 'wrong_actor' ? 403 : 409;

    throw new AppError(
      status,
      outcome.reason === 'wrong_actor' ? 'BOOKING_WRONG_ACTOR' : 'BOOKING_INVALID_TRANSITION',
      `${options.eventType} by ${options.actorType} is not valid from ${current} (${outcome.reason})`,
      {
        messageKey:
          outcome.reason === 'terminal'
            ? 'errors.bookings.alreadyFinished'
            : outcome.reason === 'wrong_actor'
              ? 'errors.bookings.notYours'
              : 'errors.bookings.invalidTransition',
        details: { from: current, event: options.eventType },
      },
    );
  }

  const updated = await repo.applyTransition(context.prisma, {
    bookingId: options.bookingId,
    eventType: options.eventType,
    actorType: options.actorType,
    actorUserId: options.actorUserId,
    payload: options.payload ?? {},
    nextStatus: outcome.status,
    ...(options.slot ? { slot: options.slot } : {}),
    topic: topicFor(options.eventType),
  });

  context.logger.info(
    {
      bookingId: options.bookingId,
      event: options.eventType,
      actor: options.actorType,
      from: current,
      to: outcome.status,
    },
    'booking transition',
  );

  return updated;
}

/* -------------------------------------------------------------------------- */
/* Access control                                                             */
/* -------------------------------------------------------------------------- */

type Side = 'customer' | 'provider';

/**
 * A booking is only visible to its two parties.
 *
 * 404 rather than 403 for a stranger: confirming that a booking exists tells
 * them something about two people they have nothing to do with.
 */
function sideOf(booking: { customerId: string; providerId: string }, userId: string): Side {
  if (booking.customerId === userId) return 'customer';
  if (booking.providerId === userId) return 'provider';
  throw notFound('requested');
}

async function loadOwnBooking(
  deps: BookingDeps,
  bookingId: string,
  userId: string,
): Promise<{ booking: repo.BookingWithEvents; side: Side }> {
  const booking = await repo.findBooking(deps.context.prisma, bookingId);
  if (!booking) throw notFound(bookingId);

  return { booking, side: sideOf(booking, userId) };
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Books a slot.
 *
 * Everything the search gates check is **re-checked here**. A result card can be
 * minutes old, and in that time the technician may have been blocked, delisted
 * or had their badge withdrawn. Booking off a stale card would put a customer in
 * front of someone the platform has already decided not to vouch for.
 */
export async function createBooking(
  deps: BookingDeps,
  customerId: string,
  input: CreateBookingInput,
): Promise<BookingDetail> {
  const { context } = deps;

  const slot = await repo.findSlot(context.prisma, input.slotId);

  if (!slot || slot.status !== 'open') {
    throw new AppError(409, 'SLOT_UNAVAILABLE', 'That time is no longer available', {
      messageKey: 'errors.bookings.slotUnavailable',
    });
  }

  if (slot.startsAt.getTime() <= nowOf(deps).getTime()) {
    throw AppError.badRequest('That time has already passed', {
      messageKey: 'errors.bookings.slotInPast',
    });
  }

  const provider = await context.prisma.providerProfile.findUnique({
    where: { userId: slot.providerId },
    include: {
      user: { select: { status: true } },
      verification: true,
      skills: { select: { categoryId: true } },
    },
  });

  const bookable =
    provider &&
    provider.isListed &&
    provider.user.status === 'active' &&
    provider.verification !== null &&
    provider.verification.badge !== 'NONE';

  if (!bookable) {
    throw new AppError(409, 'PROVIDER_UNAVAILABLE', 'That technician cannot take bookings', {
      messageKey: 'errors.bookings.providerUnavailable',
    });
  }

  if (!provider.skills.some((skill) => skill.categoryId === input.categoryId)) {
    throw AppError.badRequest('That technician does not offer this service', {
      messageKey: 'errors.bookings.categoryNotOffered',
    });
  }

  // The address must be the customer's own, and is snapshotted because they may
  // edit or delete it later — the technician needs where they were sent.
  const address = await context.prisma.$queryRaw<
    {
      id: string;
      addressText: string;
      landmark: string | null;
      lat: number;
      lng: number;
      cityId: number;
    }[]
  >`
    SELECT id, address_text AS "addressText", landmark, city_id AS "cityId",
           ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM addresses WHERE id = ${input.addressId}::uuid AND user_id = ${customerId}::uuid
  `;

  const chosen = address[0];
  if (!chosen) {
    throw new AppError(404, 'ADDRESS_NOT_FOUND', 'That address is not yours', {
      messageKey: 'errors.customers.addressNotFound',
    });
  }

  const bookingId = randomUUID();
  const payload = {
    slotId: slot.id,
    categoryId: input.categoryId,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
  } satisfies Prisma.InputJsonValue;

  /**
   * A Redis lock around the transaction is a **courtesy**, not the guarantee:
   * it turns the common race into a fast 409 instead of a constraint violation.
   * The exclusion constraint remains the wall, and the catch below proves it.
   */
  const lockKey = `booking:slot:lock:${slot.id}`;
  const lock = await context.redis.set(lockKey, bookingId, 'PX', 5_000, 'NX');

  try {
    if (lock !== 'OK') {
      throw new AppError(409, 'SLOT_UNAVAILABLE', 'That time is being booked right now', {
        messageKey: 'errors.bookings.slotUnavailable',
      });
    }

    const booking = await repo.createBookingWithHold(
      context.prisma,
      {
        id: bookingId,
        customerId,
        providerId: slot.providerId,
        categoryId: input.categoryId,
        priceCardId: input.priceCardId ?? null,
        addressId: chosen.id,
        addressSnapshot: {
          addressText: chosen.addressText,
          landmark: chosen.landmark,
          cityId: chosen.cityId,
          lat: chosen.lat,
          lng: chosen.lng,
        },
        slotId: slot.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        problemNote: input.problemNote ?? null,
        visitFeePaise: context.config.BOOKING_VISIT_FEE_PAISE,
      },
      topicFor('requested'),
      payload,
    );

    return toDetail(deps, booking, 'customer', null);
  } catch (error) {
    if (error instanceof repo.SlotUnavailableError || repo.isDoubleBookingError(error)) {
      throw new AppError(409, 'SLOT_UNAVAILABLE', 'That time was just taken', {
        messageKey: 'errors.bookings.slotUnavailable',
      });
    }
    throw error;
  } finally {
    if (lock === 'OK') {
      const holder = await context.redis.get(lockKey);
      if (holder === bookingId) await context.redis.del(lockKey);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Provider actions                                                           */
/* -------------------------------------------------------------------------- */

export async function acceptBooking(
  deps: BookingDeps,
  providerId: string,
  bookingId: string,
): Promise<BookingDetail> {
  const { booking } = await loadOwnBooking(deps, bookingId, providerId);
  const slot = await repo.findSlotForBooking(deps.context.prisma, bookingId);

  const updated = await transition(deps, {
    bookingId,
    eventType: 'accepted',
    actorType: 'provider',
    actorUserId: providerId,
    ...(slot ? { slot: { id: slot.id, status: 'booked' as const, bookingId } } : {}),
  });

  // Handshake codes exist from acceptance, but the end code stays hidden until
  // work is actually under way — see `toDetail`.
  const ttlSeconds = Math.max(
    3_600,
    Math.ceil((booking.endsAt.getTime() - nowOf(deps).getTime()) / 1000) + 24 * 3_600,
  );
  await createBookingOtpStore(deps.context.redis, deps.context.config).issue(bookingId, ttlSeconds);

  return toDetail(deps, updated, 'provider', null);
}

export async function rejectBooking(
  deps: BookingDeps,
  providerId: string,
  bookingId: string,
  input: RejectBookingInput,
): Promise<BookingDetail> {
  await loadOwnBooking(deps, bookingId, providerId);
  const slot = await repo.findSlotForBooking(deps.context.prisma, bookingId);

  const updated = await transition(deps, {
    bookingId,
    eventType: 'rejected',
    actorType: 'provider',
    actorUserId: providerId,
    payload: { reason: input.reason, note: input.note ?? null },
    // The hour goes straight back on sale.
    ...(slot ? { slot: { id: slot.id, status: 'open' as const, bookingId: null } } : {}),
  });

  return toDetail(deps, updated, 'provider', null);
}

export async function markEnRoute(
  deps: BookingDeps,
  providerId: string,
  bookingId: string,
): Promise<BookingDetail> {
  await loadOwnBooking(deps, bookingId, providerId);

  const updated = await transition(deps, {
    bookingId,
    eventType: 'en_route',
    actorType: 'provider',
    actorUserId: providerId,
  });

  return toDetail(deps, updated, 'provider', null);
}

/**
 * The start handshake.
 *
 * A correct code moves the booking through ARRIVED and straight into
 * IN_PROGRESS — two events, because the history should show that arrival was
 * proven, not just that work began.
 */
export async function submitStartOtp(
  deps: BookingDeps,
  providerId: string,
  bookingId: string,
  input: SubmitOtpInput,
): Promise<BookingDetail> {
  await loadOwnBooking(deps, bookingId, providerId);
  await checkHandshake(deps, bookingId, providerId, 'start', input.otp);

  await transition(deps, {
    bookingId,
    eventType: 'arrived',
    actorType: 'provider',
    actorUserId: providerId,
  });

  const updated = await transition(deps, {
    bookingId,
    eventType: 'work_started',
    actorType: 'provider',
    actorUserId: providerId,
  });

  return toDetail(deps, updated, 'provider', null);
}

export async function submitEndOtp(
  deps: BookingDeps,
  providerId: string,
  bookingId: string,
  input: SubmitOtpInput,
): Promise<BookingDetail> {
  await loadOwnBooking(deps, bookingId, providerId);
  await checkHandshake(deps, bookingId, providerId, 'end', input.otp);

  const updated = await transition(deps, {
    bookingId,
    eventType: 'work_done',
    actorType: 'provider',
    actorUserId: providerId,
  });

  return toDetail(deps, updated, 'provider', null);
}

/**
 * Verifies a handshake code, recording every failure in the booking's history.
 *
 * A wrong code is evidence worth keeping — five of them is a story ops need to
 * see — so failures append `otp_failed` events without moving the booking.
 */
async function checkHandshake(
  deps: BookingDeps,
  bookingId: string,
  providerId: string,
  kind: BookingOtpKind,
  otp: string,
): Promise<void> {
  const store = createBookingOtpStore(deps.context.redis, deps.context.config);
  const result = await store.check(bookingId, kind, otp);

  if (result.outcome === 'ok') return;

  if (result.outcome === 'missing') {
    throw new AppError(409, 'BOOKING_OTP_MISSING', 'No handshake code is active for this booking', {
      messageKey: 'errors.bookings.otpMissing',
    });
  }

  if (result.outcome === 'locked') {
    // Locked stays locked. Reissuing would defeat the point of proving presence.
    await transition(deps, {
      bookingId,
      eventType: 'otp_locked',
      actorType: 'provider',
      actorUserId: providerId,
      payload: { kind, attempts: result.attempts },
    }).catch(() => undefined);

    throw new AppError(
      423,
      'BOOKING_OTP_LOCKED',
      'Too many wrong codes; support must unlock this booking',
      { messageKey: 'errors.bookings.otpLocked' },
    );
  }

  await transition(deps, {
    bookingId,
    eventType: 'otp_failed',
    actorType: 'provider',
    actorUserId: providerId,
    payload: { kind, attempts: result.attempts, remaining: result.remaining },
  });

  throw new AppError(401, 'BOOKING_OTP_INVALID', 'That code is not correct', {
    messageKey: 'errors.bookings.otpInvalid',
    details: { remaining: result.remaining },
  });
}

/* -------------------------------------------------------------------------- */
/* Cancellation                                                               */
/* -------------------------------------------------------------------------- */

export async function cancelBooking(
  deps: BookingDeps,
  userId: string,
  bookingId: string,
  input: CancelBookingInput,
): Promise<BookingDetail> {
  const { side } = await loadOwnBooking(deps, bookingId, userId);
  const slot = await repo.findSlotForBooking(deps.context.prisma, bookingId);

  const updated = await transition(deps, {
    bookingId,
    eventType: side === 'customer' ? 'cancelled_by_customer' : 'cancelled_by_provider',
    actorType: side,
    actorUserId: userId,
    payload: { reason: input.reason, note: input.note ?? null },
    ...(slot ? { slot: { id: slot.id, status: 'open' as const, bookingId: null } } : {}),
  });

  await createBookingOtpStore(deps.context.redis, deps.context.config).clear(bookingId);

  return toDetail(deps, updated, side, null);
}

/** Requests nobody answered. Fired by the expiry job with an injected clock. */
export async function expireBooking(deps: BookingDeps, bookingId: string): Promise<void> {
  const slot = await repo.findSlotForBooking(deps.context.prisma, bookingId);

  await transition(deps, {
    bookingId,
    eventType: 'expired',
    actorType: 'system',
    actorUserId: null,
    payload: { expiredAt: nowOf(deps).toISOString() },
    ...(slot ? { slot: { id: slot.id, status: 'open' as const, bookingId: null } } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** Statuses from which both parties genuinely need to phone each other. */
const PHONE_VISIBLE_FROM: readonly BookingStatus[] = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'WORK_DONE',
];

async function toDetail(
  deps: BookingDeps,
  booking: repo.BookingWithEvents,
  side: Side,
  _unused: null,
): Promise<BookingDetail> {
  const { context } = deps;
  const store = createBookingOtpStore(context.redis, context.config);

  const [customer, providerProfile] = await Promise.all([
    context.prisma.user.findUnique({
      where: { id: booking.customerId },
      select: { phone: true, name: true },
    }),
    context.prisma.providerProfile.findUnique({
      where: { userId: booking.providerId },
      select: { displayName: true, user: { select: { phone: true } } },
    }),
  ]);

  const status = booking.status as BookingStatus;
  /**
   * Phones unmask at ACCEPTED and not before.
   *
   * Before acceptance there is nothing to coordinate and a rejected request
   * should not hand a stranger someone's number. After it, both sides genuinely
   * need to call each other — a technician who cannot find the gate will phone,
   * and pretending otherwise just pushes them onto WhatsApp.
   */
  const revealPhones = PHONE_VISIBLE_FROM.includes(status);

  const counterpartPhone =
    side === 'customer' ? (providerProfile?.user.phone ?? null) : (customer?.phone ?? null);

  const events: BookingEventView[] = booking.events.map((event) => ({
    id: event.id,
    eventType: event.eventType as BookingEventType,
    actorType: event.actorType as BookingActor,
    // Reason codes and attempt counts are fine; nothing internal lives here yet.
    payload: event.payload ?? null,
    createdAt: event.createdAt.toISOString(),
  }));

  const startOtp =
    side === 'customer' && revealPhones ? await store.peek(booking.id, 'start') : null;

  // The end code is the customer's sign-off, so it appears only once work is
  // actually under way. Revealing it at acceptance would let it be handed over
  // before anything had been done.
  const endOtp =
    side === 'customer' && status === 'IN_PROGRESS' ? await store.peek(booking.id, 'end') : null;

  return {
    id: booking.id,
    status,
    categoryId: booking.categoryId,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    problemNote: booking.problemNote,
    visitFeePaise: booking.visitFeePaise,
    // Snapshot, not the live address — the technician needs where they were sent.
    address: side === 'customer' || revealPhones ? booking.addressSnapshot : null,
    counterpart: {
      name: side === 'customer' ? (providerProfile?.displayName ?? null) : (customer?.name ?? null),
      phone: counterpartPhone
        ? revealPhones
          ? counterpartPhone
          : maskPhone(counterpartPhone)
        : null,
      phoneRevealed: revealPhones,
    },
    startOtp,
    endOtp,
    events,
    createdAt: booking.createdAt.toISOString(),
  };
}

export async function getBooking(
  deps: BookingDeps,
  userId: string,
  bookingId: string,
): Promise<BookingDetail> {
  const { booking, side } = await loadOwnBooking(deps, bookingId, userId);
  return toDetail(deps, booking, side, null);
}

export async function listMyBookings(
  deps: BookingDeps,
  userId: string,
  side: Side,
): Promise<BookingDetail[]> {
  const rows =
    side === 'customer'
      ? await repo.listBookingsForCustomer(deps.context.prisma, userId)
      : await repo.listBookingsForProvider(deps.context.prisma, userId);

  return Promise.all(rows.map((booking) => toDetail(deps, booking, side, null)));
}
