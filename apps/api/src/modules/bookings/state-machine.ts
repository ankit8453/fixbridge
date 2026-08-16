/**
 * The booking lifecycle — a transition **table**, not a switch statement.
 *
 * Phases 8 and 9 extend this machine with payment and review states. Encoding
 * the rules as data means those phases add rows here and nothing has to find
 * every `case` in a service; encoding them as control flow would guarantee one
 * gets missed.
 *
 * Same discipline as verification: the event log is the truth, `bookings.status`
 * is a projection of it, and the projector throws on a log it cannot replay.
 */

export const BOOKING_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'WORK_DONE',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'CLOSED_QUOTE_DECLINED',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_EVENT_TYPES = [
  'requested',
  'accepted',
  'rejected',
  'expired',
  'en_route',
  'arrived',
  'work_started',
  'work_done',
  'cancelled_by_customer',
  'cancelled_by_provider',
  'otp_failed',
  'otp_locked',
  'quote_sent',
  'quote_withdrawn',
  'quote_approved',
  'quote_rejected',
  'work_declined',
] as const;

export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

export type BookingActor = 'customer' | 'provider' | 'system' | 'ops';

/** Nothing follows these. A job that ended, ended. */
export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
  'REJECTED',
  'EXPIRED',
  'WORK_DONE',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'CLOSED_QUOTE_DECLINED',
];

/**
 * Terminal statuses that leave a bill behind.
 *
 * The distinction is not cosmetic: these are exactly the endings where Phase 7
 * freezes a `payable_paise`, and therefore exactly the ones Phase 8 will collect
 * against. A booking that was rejected, expired or cancelled owes nothing and
 * must never acquire a payable.
 */
export const BILLABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  'WORK_DONE',
  'CLOSED_QUOTE_DECLINED',
];

export function isBillableBooking(status: BookingStatus): boolean {
  return BILLABLE_BOOKING_STATUSES.includes(status);
}

export function isTerminalBooking(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}

/**
 * Events that record something without moving the booking.
 *
 * A mistyped handshake code is evidence — it belongs in the history so a dispute
 * can see it — but it is not a state change. The quote events are here for a
 * different reason: agreeing a price is a negotiation that happens *while* the
 * job stays IN_PROGRESS, and it can go round more than once. Only the customer
 * walking away (`work_declined`) ends anything.
 *
 * These are permitted from any non-terminal status by the machine; the narrower
 * rule — quotes exist only from IN_PROGRESS — belongs to the quotations service,
 * because it is about pricing, not about the lifecycle.
 */
export const NON_TRANSITIONING_EVENTS: readonly BookingEventType[] = [
  'otp_failed',
  'otp_locked',
  'quote_sent',
  'quote_withdrawn',
  'quote_approved',
  'quote_rejected',
];

export interface TransitionRule {
  from: BookingStatus;
  event: BookingEventType;
  to: BookingStatus;
  /** Who is allowed to fire it. */
  actors: readonly BookingActor[];
}

/**
 * Every legal move, exhaustively.
 *
 * Note what is absent: **nothing cancels after ARRIVED**. Once a technician is
 * standing at the door, "I changed my mind" is a dispute, not a cancellation,
 * and disputes are Phase 9's complaint flow. Letting either side cancel at that
 * point would erase a visit that actually happened.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  // A technician answers, or the clock does it for them.
  { from: 'REQUESTED', event: 'accepted', to: 'ACCEPTED', actors: ['provider'] },
  { from: 'REQUESTED', event: 'rejected', to: 'REJECTED', actors: ['provider'] },
  { from: 'REQUESTED', event: 'expired', to: 'EXPIRED', actors: ['system'] },
  {
    from: 'REQUESTED',
    event: 'cancelled_by_customer',
    to: 'CANCELLED_BY_CUSTOMER',
    actors: ['customer'],
  },

  // On the way.
  { from: 'ACCEPTED', event: 'en_route', to: 'EN_ROUTE', actors: ['provider'] },
  { from: 'ACCEPTED', event: 'arrived', to: 'ARRIVED', actors: ['provider'] },
  {
    from: 'ACCEPTED',
    event: 'cancelled_by_customer',
    to: 'CANCELLED_BY_CUSTOMER',
    actors: ['customer'],
  },
  {
    from: 'ACCEPTED',
    event: 'cancelled_by_provider',
    to: 'CANCELLED_BY_PROVIDER',
    actors: ['provider'],
  },

  { from: 'EN_ROUTE', event: 'arrived', to: 'ARRIVED', actors: ['provider'] },
  {
    from: 'EN_ROUTE',
    event: 'cancelled_by_customer',
    to: 'CANCELLED_BY_CUSTOMER',
    actors: ['customer'],
  },
  {
    from: 'EN_ROUTE',
    event: 'cancelled_by_provider',
    to: 'CANCELLED_BY_PROVIDER',
    actors: ['provider'],
  },

  // Arrival is proven by the start OTP, and work begins immediately after.
  { from: 'ARRIVED', event: 'work_started', to: 'IN_PROGRESS', actors: ['provider', 'system'] },
  { from: 'IN_PROGRESS', event: 'work_done', to: 'WORK_DONE', actors: ['provider'] },

  /**
   * Phase 7. The customer heard the price and chose not to go ahead.
   *
   * Deliberately the customer's own action and not an automatic consequence of
   * rejecting a quote: a rejection is "not at that price", which the technician
   * may answer with a revision. Ending the job is a separate, explicit decision,
   * and the visit fee is payable because the visit genuinely happened.
   */
  {
    from: 'IN_PROGRESS',
    event: 'work_declined',
    to: 'CLOSED_QUOTE_DECLINED',
    actors: ['customer'],
  },
];

export type TransitionOutcome =
  | { ok: true; status: BookingStatus }
  | { ok: false; reason: 'terminal' | 'not_allowed' | 'wrong_actor' };

function findRule(from: BookingStatus, event: BookingEventType): TransitionRule | undefined {
  return TRANSITIONS.find((rule) => rule.from === from && rule.event === event);
}

/**
 * Whether `event`, fired by `actor`, may be appended to a booking in `from` —
 * and where it leaves it.
 *
 * The actor check is part of the machine rather than the service, because "only
 * this booking's technician may mark it done" is a rule about the lifecycle, not
 * about HTTP.
 */
export function applyBookingEvent(
  from: BookingStatus,
  event: BookingEventType,
  actor: BookingActor,
): TransitionOutcome {
  if (isTerminalBooking(from)) return { ok: false, reason: 'terminal' };

  if (event === 'requested') {
    // Only ever a booking's first event; a retry is a new booking.
    return { ok: false, reason: 'not_allowed' };
  }

  if (NON_TRANSITIONING_EVENTS.includes(event)) {
    // Recorded as evidence wherever it happens, leaving the status alone.
    return { ok: true, status: from };
  }

  const rule = findRule(from, event);
  if (!rule) return { ok: false, reason: 'not_allowed' };

  // Ops are deliberately absent from every rule: intervention is Phase 11, and
  // silently allowing it now would let an ops action look like a provider's.
  if (!rule.actors.includes(actor)) return { ok: false, reason: 'wrong_actor' };

  return { ok: true, status: rule.to };
}

export function canApplyBookingEvent(
  from: BookingStatus,
  event: BookingEventType,
  actor: BookingActor,
): boolean {
  return applyBookingEvent(from, event, actor).ok;
}

/** Every (status, event, actor) combination the table permits. */
export function legalTransitions(): TransitionRule[] {
  return [...TRANSITIONS];
}

/**
 * Folds an event log into the current status.
 *
 * Throws on a log that could not have happened — if that ever fires on real
 * data, something wrote around the state machine, and failing loudly beats
 * quietly reporting a status nobody can account for.
 */
export function projectBookingStatus(
  events: readonly { eventType: BookingEventType; actorType: BookingActor }[],
): BookingStatus {
  const [first, ...rest] = events;

  if (!first) {
    throw new Error('cannot project booking status: a booking must have its requested event');
  }

  if (first.eventType !== 'requested') {
    throw new Error(
      `cannot project booking status: first event is ${first.eventType}, expected requested`,
    );
  }

  let status: BookingStatus = 'REQUESTED';

  for (const event of rest) {
    const result = applyBookingEvent(status, event.eventType, event.actorType);

    if (!result.ok) {
      throw new Error(
        `cannot project booking status: ${event.eventType} by ${event.actorType} is not valid from ${status} (${result.reason})`,
      );
    }

    status = result.status;
  }

  return status;
}

/* -------------------------------------------------------------------------- */
/* Reason codes                                                               */
/* -------------------------------------------------------------------------- */

/** Why a technician turned a job down. Phase 9 reads these. */
export const REJECTION_REASONS = ['too_far', 'busy', 'wrong_skill', 'other'] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const CUSTOMER_CANCEL_REASONS = [
  'changed_mind',
  'found_other',
  'emergency',
  'provider_delay',
  'other',
] as const;
export type CustomerCancelReason = (typeof CUSTOMER_CANCEL_REASONS)[number];

/**
 * Why a technician abandoned an accepted job.
 *
 * This is the reliability signal Phase 9 punishes, so the payload has to be
 * precise: "vehicle_issue" and "wrong_skill" say very different things about
 * whether the platform matched badly or the technician let someone down.
 */
export const PROVIDER_CANCEL_REASONS = [
  'emergency',
  'vehicle_issue',
  'wrong_skill',
  'other',
] as const;
export type ProviderCancelReason = (typeof PROVIDER_CANCEL_REASONS)[number];

/* -------------------------------------------------------------------------- */
/* Outbox topics                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The contract Phases 9 and 10 subscribe to. Topic names are public API for
 * other modules — renaming one silently breaks a consumer.
 */
export const BOOKING_TOPICS = {
  requested: 'booking.requested',
  accepted: 'booking.accepted',
  rejected: 'booking.rejected',
  expired: 'booking.expired',
  en_route: 'booking.en_route',
  arrived: 'booking.arrived',
  work_started: 'booking.work_started',
  work_done: 'booking.work_done',
  cancelled_by_customer: 'booking.cancelled_by_customer',
  cancelled_by_provider: 'booking.cancelled_by_provider',
  otp_failed: 'booking.otp_failed',
  otp_locked: 'booking.otp_locked',
  /**
   * Quote events publish under `quotation.*`, not `booking.*`.
   *
   * They travel through the booking's event log because the timeline is one
   * narrative, but a subscriber that cares about pricing should not have to
   * filter booking events to find them.
   */
  quote_sent: 'quotation.sent',
  quote_withdrawn: 'quotation.withdrawn',
  quote_approved: 'quotation.approved',
  quote_rejected: 'quotation.rejected',
  work_declined: 'booking.work_declined',
} as const satisfies Record<BookingEventType, string>;

export function topicFor(event: BookingEventType): string {
  return BOOKING_TOPICS[event];
}
