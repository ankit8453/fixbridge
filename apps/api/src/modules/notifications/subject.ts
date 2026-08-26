import type { AppContext } from '../../core/context';
import type { DeliveredEvent } from '../../core/outbox';
import { createBookingOtpStore } from '../bookings/otp';
import { BOOKING_TOPICS } from '../bookings/state-machine';
import { PAYMENT_TOPICS } from '../payments/state-machine';
import { TRUST_TOPICS } from '../trust/topics';
import { P, type NotificationParams } from './params';
import { firstNameOf } from './render';
import type { AudienceRole } from './routing';

/**
 * Turning "something happened" into "these people, and these facts".
 *
 * ## Why one bag of parameters per event, not one per route
 *
 * The routing table's promise is that adding a notification needs no code. That
 * holds only if the parameters a new template might want are *already there* —
 * so this builds everything an event could reasonably say, once, and each
 * template takes the subset it declares. Adding "tell the customer the category
 * too" is then a word in a locale file, not a pull request.
 *
 * The cost is a handful of parameters assembled and never used. At pilot volume
 * that is one extra join on an event that fires a few thousand times a day, and
 * the alternative — a per-route builder function — puts code back in the middle
 * of the thing that was supposed to be data.
 *
 * ## What never goes in
 *
 * No full phone numbers, ever. The apps are where unmasking lives, behind a
 * booking that is actually in progress. No card or UPI details, and no KYC
 * facts. A notification travels over channels the recipient does not control —
 * a forwarded WhatsApp outlives everything — and there is a whole-suite sweep
 * that fails the build if a ten-digit number appears in any rendered message.
 */

export interface NotificationSubject {
  recipients: Partial<Record<AudienceRole, string>>;
  params: NotificationParams;
}

type EventPayload = Record<string, unknown> | null;

const payloadOf = (event: DeliveredEvent): EventPayload =>
  event.payload !== null && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : null;

const numberFrom = (payload: EventPayload, key: string): number | null => {
  const value = payload?.[key];
  return typeof value === 'number' ? value : null;
};

const stringFrom = (payload: EventPayload, key: string): string | null => {
  const value = payload?.[key];
  return typeof value === 'string' ? value : null;
};

/** A first name, or a translated noun when there is no name on file yet. */
const nameParam = (name: string | null, fallbackKey: string) => {
  const first = firstNameOf(name, '');
  return first.length > 0 ? P.text(first) : P.key(fallbackKey);
};

export async function resolveSubject(
  context: AppContext,
  event: DeliveredEvent,
): Promise<NotificationSubject | null> {
  if (event.aggregateType === 'booking') return resolveBookingSubject(context, event);
  if (event.aggregateType === 'provider') return resolveProviderSubject(context, event);

  return null;
}

/* -------------------------------------------------------------------------- */
/* Booking-shaped events                                                      */
/* -------------------------------------------------------------------------- */

async function resolveBookingSubject(
  context: AppContext,
  event: DeliveredEvent,
): Promise<NotificationSubject | null> {
  const booking = await context.prisma.booking.findUnique({
    where: { id: event.aggregateId },
    select: {
      id: true,
      startsAt: true,
      customerId: true,
      providerId: true,
      customer: { select: { name: true } },
      provider: { select: { displayName: true } },
      category: { select: { nameKey: true } },
    },
  });

  if (!booking) return null;

  const payload = payloadOf(event);

  const params: NotificationParams = {
    bookingId: P.text(booking.id),
    time: P.time(booking.startsAt),
    /**
     * A key, not a name. Categories are stored as i18n keys because "AC repair"
     * and "एसी रिपेयर" are the same category, and a technician's notification
     * should say the trade in the language they read it in.
     */
    categoryName: P.key(booking.category.nameKey),
    /**
     * What we *ask* for, not when the booking dies.
     *
     * The two parted company when the acceptance window was widened for the
     * pilot: a technician is still asked to reply within fifteen minutes, but
     * missing that no longer destroys the job. Telling him the real TTL would
     * turn the nudge into "you have an hour", which is not the habit worth
     * teaching.
     */
    expiryMinutes: P.num(context.config.BOOKING_RESPONSE_PROMPT_MINUTES),
    /**
     * First names only, on both sides. A full name plus a time and a trade is
     * enough to find somebody, and these messages leave our control the moment
     * they are delivered.
     *
     * A missing name falls back to a translated noun rather than a hardcoded
     * one — "आपका कारीगर" is a user-facing string like any other.
     */
    providerName: nameParam(booking.provider.displayName, 'notif.fallback.provider'),
    customerName: nameParam(booking.customer.name, 'notif.fallback.customer'),
  };

  const recipients: Partial<Record<AudienceRole, string>> = {
    customer: booking.customerId,
    provider: booking.providerId,
  };

  /**
   * The start OTP, read live from Redis rather than carried in the event.
   *
   * It has a TTL and this consumer is asynchronous, so it may simply be gone —
   * which is why the accepted route declares a fallback template rather than
   * sending a sentence with a hole in it.
   */
  if (event.topic === BOOKING_TOPICS.accepted) {
    const otp = await createBookingOtpStore(context.redis, context.config).peek(
      booking.id,
      'start',
    );

    if (otp) params.otp = P.text(otp);
  }

  const totalPaise = numberFrom(payload, 'totalPaise');
  if (totalPaise !== null) params.total = P.money(totalPaise);

  const amountPaise = numberFrom(payload, 'amountPaise');
  if (amountPaise !== null) params.amount = P.money(amountPaise);

  const providerPaise = numberFrom(payload, 'providerPaise');
  if (providerPaise !== null) params.netAmount = P.money(providerPaise);

  /**
   * `payment.cash_recorded` carries the gross and the commission but not the
   * technician's share, and the customer's message is about the gross anyway.
   */
  if (event.topic === PAYMENT_TOPICS.cashRecorded && amountPaise !== null) {
    params.amount = P.money(amountPaise);
  }

  const complaintId = stringFrom(payload, 'complaintId');

  if (complaintId) {
    const complaint = await context.prisma.complaint.findUnique({
      where: { id: complaintId },
      select: { id: true, category: true, raisedByUserId: true, againstUserId: true },
    });

    if (complaint) {
      params.complaintId = P.text(complaint.id);
      params.category = P.key(`notif.complaintCategory.${complaint.category}`);
      recipients.complaintRaiser = complaint.raisedByUserId;
      recipients.complaintAgainst = complaint.againstUserId;
    }
  }

  return { recipients, params };
}

/* -------------------------------------------------------------------------- */
/* Provider-shaped events                                                     */
/* -------------------------------------------------------------------------- */

async function resolveProviderSubject(
  context: AppContext,
  event: DeliveredEvent,
): Promise<NotificationSubject | null> {
  const profile = await context.prisma.providerProfile.findUnique({
    where: { userId: event.aggregateId },
    select: { userId: true, displayName: true, suspendedUntil: true },
  });

  if (!profile) return null;

  const payload = payloadOf(event);

  const params: NotificationParams = {
    providerId: P.text(profile.userId),
    providerName: nameParam(profile.displayName, 'notif.fallback.provider'),
  };

  if (event.topic === TRUST_TOPICS.providerSuspended) {
    /**
     * The reason arrives as an i18n key because the trust engine decided it
     * hours ago, in no language. It becomes Hindi or English when the technician
     * reads it — which is the entire reason parameters are stored tagged.
     */
    const reasonKey = stringFrom(payload, 'reasonKey') ?? 'trust.suspension.opsManual';
    params.reason = P.key(reasonKey);

    const until = stringFrom(payload, 'until');
    const untilDate = until ? new Date(until) : profile.suspendedUntil;
    if (untilDate) params.until = P.time(untilDate);
  }

  const badge = stringFrom(payload, 'badge');
  if (badge) params.badge = P.key(`notif.badge.${badge}`);

  if (event.topic === PAYMENT_TOPICS.payoutPaid) {
    const payoutId = stringFrom(payload, 'payoutId');

    const payout = payoutId
      ? await context.prisma.payout.findUnique({
          where: { id: payoutId },
          select: { amountPaise: true, utrRef: true },
        })
      : null;

    const amountPaise = payout?.amountPaise ?? numberFrom(payload, 'amountPaise');
    if (amountPaise !== null && amountPaise !== undefined) params.amount = P.money(amountPaise);

    /**
     * The UTR is read from the row rather than the event because it is set in
     * the same transaction that publishes — and it is the number a technician
     * quotes at their bank when the money has not landed.
     */
    if (payout?.utrRef) params.utr = P.text(payout.utrRef);
  }

  return { recipients: { provider: profile.userId }, params };
}
