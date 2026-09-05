import { BOOKING_TOPICS } from '../bookings/state-machine';
import { PAYMENT_TOPICS } from '../payments/state-machine';
import { TRUST_TOPICS } from '../trust/topics';
import type { TemplateId } from './templates';

/**
 * The routing table: what happened → who hears about it, where, and how loudly.
 *
 * This is **data, not code**, and that is the point. Adding a notification is a
 * row here plus two strings in each locale file — no new handler, no new
 * subscriber, no change to the consumer. There is a test that registers a
 * synthetic topic at runtime and proves an unknown-to-the-codebase message goes
 * out end to end.
 *
 * A topic with no row here is not an error. Most of what the system publishes is
 * for projections, not people: `booking.en_route` moves a status, `review.hidden`
 * moves a score, and neither is worth a buzz. Unroutable topics are logged at
 * debug and dropped.
 *
 * ## Choosing channels
 *
 * `in_app` is on everything, always. It costs nothing, it is the only channel
 * that can hold a long message, and it is the record a dispute is settled from.
 *
 * `whatsapp` goes on anything a person is waiting for. It is cheap, it renders
 * properly in Hindi, and it sits outside the DLT regime.
 *
 * `sms` appears exactly twice — cash recorded, and suspension. Both are things a
 * person must find out even with no data connection, and both are things that
 * cost them money if they do not. Every other SMS is a rupee spent on a message
 * WhatsApp would have delivered better.
 */

export type NotificationChannelName = 'in_app' | 'whatsapp' | 'sms';
export type CriticalityName = 'critical' | 'standard';

/**
 * Who a message is for, resolved against the aggregate rather than named.
 *
 * `customer` and `provider` are the two sides of a booking. The complaint roles
 * are separate because "the person who complained" and "the person complained
 * about" are not the customer and the technician in any fixed order — a
 * technician can raise one too.
 */
export type AudienceRole = 'customer' | 'provider' | 'complaintRaiser' | 'complaintAgainst';

export interface AudienceRoute {
  readonly role: AudienceRole;
  readonly channels: readonly NotificationChannelName[];
  readonly template: TemplateId;
  /**
   * Used when the primary template needs a parameter the event could not
   * supply — currently only the accepted-booking OTP, which can expire before an
   * asynchronous consumer reaches it. Declarative on purpose: the alternative is
   * an `if` in the consumer for every template that might degrade.
   */
  readonly fallbackTemplate?: TemplateId;
  /** Route hint for the apps, interpolated from the same parameters. */
  readonly deepLink?: string;
}

export interface NotificationRoute {
  readonly criticality: CriticalityName;
  readonly audiences: readonly AudienceRoute[];
}

const BOOKING_LINK = 'booking/{{bookingId}}';

export const NOTIFICATION_ROUTES: Record<string, NotificationRoute> = {
  /* ---------------------------------------------------------------- bookings */

  /**
   * Critical, because the whole booking dies if it is not seen. A request a
   * mistri never heard about expires in fifteen minutes and the customer
   * concludes the platform is empty.
   */
  [BOOKING_TOPICS.requested]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'provider',
        channels: ['in_app', 'whatsapp'],
        template: 'bookingRequested',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  [BOOKING_TOPICS.accepted]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'customer',
        channels: ['in_app', 'whatsapp'],
        template: 'bookingAccepted',
        fallbackTemplate: 'bookingAcceptedNoOtp',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  /**
   * A rejection and an expiry read the same to a customer — nobody is coming —
   * so both point at search rather than at the dead booking.
   */
  [BOOKING_TOPICS.rejected]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'customer',
        channels: ['in_app', 'whatsapp'],
        template: 'bookingRejected',
        deepLink: 'search',
      },
    ],
  },

  [BOOKING_TOPICS.expired]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'customer',
        channels: ['in_app', 'whatsapp'],
        template: 'bookingExpired',
        deepLink: 'search',
      },
    ],
  },

  /** Each cancellation tells the *other* side. Nobody needs telling what they did. */
  [BOOKING_TOPICS.cancelled_by_customer]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'provider',
        channels: ['in_app', 'whatsapp'],
        template: 'bookingCancelledByCustomer',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  [BOOKING_TOPICS.cancelled_by_provider]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'customer',
        channels: ['in_app', 'whatsapp'],
        template: 'bookingCancelledByProvider',
        deepLink: 'search',
      },
    ],
  },

  /* -------------------------------------------------------------- quotations */

  /** A quote nobody looks at is a job that does not happen. */
  [BOOKING_TOPICS.quote_sent]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'customer',
        channels: ['in_app', 'whatsapp'],
        template: 'quotationSent',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  [BOOKING_TOPICS.quote_approved]: {
    criticality: 'standard',
    audiences: [
      {
        role: 'provider',
        channels: ['in_app'],
        template: 'quotationApproved',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  [BOOKING_TOPICS.quote_rejected]: {
    criticality: 'standard',
    audiences: [
      {
        role: 'provider',
        channels: ['in_app'],
        template: 'quotationRejected',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  /* ------------------------------------------------------------------- money */

  /** Both sides, different facts: the customer sees a receipt, the technician a credit. */
  [PAYMENT_TOPICS.captured]: {
    criticality: 'standard',
    audiences: [
      {
        role: 'customer',
        channels: ['in_app'],
        template: 'paymentCapturedCustomer',
        deepLink: BOOKING_LINK,
      },
      {
        role: 'provider',
        channels: ['in_app'],
        template: 'paymentCapturedProvider',
        deepLink: 'wallet',
      },
    ],
  },

  /**
   * Three channels, and the only place SMS earns its cost besides suspension.
   *
   * This is the sunlight. A technician marking cash collected is the single
   * unilateral money action in the product; the customer being told, on a channel
   * that works without data, is what makes disputing it possible.
   */
  [PAYMENT_TOPICS.cashRecorded]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'customer',
        channels: ['in_app', 'whatsapp', 'sms'],
        template: 'paymentCashRecorded',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  /**
   * The technician says the cash never arrived.
   *
   * Goes to the customer, but **not** over SMS — unlike the collection notice
   * it mirrors. That one buys the ability to dispute a charge, which has to
   * reach a phone with no data. This one charges nothing: it hands the choice
   * back, and the ordinary case is a mistap while both people are still
   * standing next to each other. WhatsApp and the inbox reach that person.
   */
  [PAYMENT_TOPICS.cashNotReceived]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'customer',
        channels: ['in_app', 'whatsapp'],
        template: 'paymentCashNotReceived',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  [PAYMENT_TOPICS.payoutPaid]: {
    criticality: 'standard',
    audiences: [
      {
        role: 'provider',
        channels: ['in_app', 'whatsapp'],
        template: 'payoutPaid',
        deepLink: 'wallet',
      },
    ],
  },

  /* ------------------------------------------------------------------- trust */

  /**
   * Mandatory, and the one route this phase would be a failure without.
   *
   * A technician whose work silently stops does not file a support ticket; they
   * conclude the platform is broken and go back to the shop that phones them.
   * Reason and route to ops, on every channel we have.
   */
  [TRUST_TOPICS.providerSuspended]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'provider',
        channels: ['in_app', 'whatsapp', 'sms'],
        template: 'providerSuspended',
        deepLink: 'trust',
      },
    ],
  },

  /** The other half of the same courtesy. Critical: it is money they can earn today. */
  [TRUST_TOPICS.providerReinstated]: {
    criticality: 'critical',
    audiences: [
      {
        role: 'provider',
        channels: ['in_app', 'whatsapp'],
        template: 'providerReinstated',
        deepLink: 'trust',
      },
    ],
  },

  /** Retention, not information. Reaching SILVER should feel like something. */
  'provider.badge_changed': {
    criticality: 'standard',
    audiences: [
      {
        role: 'provider',
        channels: ['in_app', 'whatsapp'],
        template: 'providerBadgeChanged',
        deepLink: 'trust',
      },
    ],
  },

  /* -------------------------------------------------------------- complaints */

  /**
   * In-app only, deliberately.
   *
   * Being complained about is not an emergency and it is not yet a finding —
   * ops have not looked at it. A WhatsApp at 9pm saying somebody has accused you
   * of something, with no decision attached, would do more harm than good.
   */
  [TRUST_TOPICS.complaintOpened]: {
    criticality: 'standard',
    audiences: [
      {
        role: 'complaintAgainst',
        channels: ['in_app'],
        template: 'complaintOpened',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  [TRUST_TOPICS.complaintResolved]: {
    criticality: 'standard',
    audiences: [
      {
        role: 'complaintRaiser',
        channels: ['in_app'],
        template: 'complaintResolvedRaiser',
        deepLink: BOOKING_LINK,
      },
      {
        role: 'complaintAgainst',
        channels: ['in_app'],
        template: 'complaintResolvedAgainst',
        deepLink: BOOKING_LINK,
      },
    ],
  },

  /** A dismissal is a result too, and the person cleared should hear it said. */
  [TRUST_TOPICS.complaintDismissed]: {
    criticality: 'standard',
    audiences: [
      {
        role: 'complaintRaiser',
        channels: ['in_app'],
        template: 'complaintDismissedRaiser',
        deepLink: BOOKING_LINK,
      },
      {
        role: 'complaintAgainst',
        channels: ['in_app'],
        template: 'complaintDismissedAgainst',
        deepLink: BOOKING_LINK,
      },
    ],
  },
};

/** Topic emitted when a technician's badge band moves. Consumed only here. */
export const BADGE_CHANGED_TOPIC = 'provider.badge_changed';

export function routedTopics(): string[] {
  return Object.keys(NOTIFICATION_ROUTES);
}

export function routeFor(topic: string): NotificationRoute | undefined {
  return NOTIFICATION_ROUTES[topic];
}

/**
 * Registers a route at runtime.
 *
 * Exists for one reason: the test that proves adding a notification needs no
 * code. It registers a topic this codebase has never heard of, publishes an
 * event, and asserts the message arrives — which is the only honest way to check
 * that claim, because any route already in the table above was written by
 * somebody who could also have edited the consumer.
 */
export function registerRoute(topic: string, route: NotificationRoute): void {
  NOTIFICATION_ROUTES[topic] = route;
}

export function unregisterRoute(topic: string): void {
  delete NOTIFICATION_ROUTES[topic];
}
