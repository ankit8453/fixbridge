/**
 * Every message this system is capable of sending.
 *
 * ## Why templates are code and text is not
 *
 * The **shape** of a message — which parameters it takes — is a contract that
 * must not vary between languages, so it lives here in TypeScript where a test
 * can enumerate it. The
 * **wording** lives in `core/locales/{hi,en}.json` under `notif.*`, where a
 * non-programmer can fix a clumsy sentence without touching a build.
 *
 * The two are joined by a test that walks this registry × both locales and fails
 * on the first missing key. A template with no Hindi is not a template — Hindi is
 * the primary language of this product, and an English-only message reaches
 * nobody in Jabalpur.
 *
 * ## Parameters
 *
 * `params` is exhaustive: the renderer refuses to render if one is missing, so a
 * customer can never receive "आपका काम undefined को तय हुआ". That check is worth
 * more than it looks — a missing parameter is the single most common way a
 * templating system embarrasses a company in public.
 *
 * What a parameter *is* — money, an instant, a nested translated phrase — is
 * declared where the value is produced, not here. See `params.ts`.
 */

export interface TemplateSpec {
  /** Stem under `notif.` — the real keys are `<stem>.title` and `<stem>.body`. */
  readonly stem: string;
  /** Exhaustive. A missing one is a render failure, never an `undefined`. */
  readonly params: readonly string[];
}

/**
 * Template ids, used by the routing table.
 *
 * Named for what the message *says*, not for the topic that triggers it: one
 * topic often needs two different messages because the two sides of a job need
 * to be told different things about it.
 */
export const TEMPLATES = {
  /* ---- bookings ---- */

  bookingRequested: {
    stem: 'booking.requested',
    params: ['categoryName', 'time', 'expiryMinutes'],
  },
  /**
   * Carries the start OTP. That is deliberate and it is this message's whole
   * job for a web user: there is no app to read the code out of, so the channel
   * *is* the delivery path. It is why `booking.accepted` is critical.
   */
  bookingAccepted: {
    stem: 'booking.accepted',
    params: ['providerName', 'time', 'otp'],
  },
  /**
   * The same message without the code.
   *
   * OTPs live in Redis with a TTL, and the outbox is asynchronous — if the
   * dispatcher is far enough behind, the code is gone. Sending the sentence with
   * a blank where the number should be would be worse than not mentioning it, so
   * this is a separate template rather than an optional parameter.
   */
  bookingAcceptedNoOtp: {
    stem: 'booking.acceptedNoOtp',
    params: ['providerName', 'time'],
  },
  bookingRejected: {
    stem: 'booking.rejected',
    params: ['categoryName', 'time'],
  },
  bookingExpired: {
    stem: 'booking.expired',
    params: ['categoryName', 'time'],
  },
  /** To the technician: the customer called it off. */
  bookingCancelledByCustomer: {
    stem: 'booking.cancelledByCustomer',
    params: ['categoryName', 'time'],
  },
  /** To the customer: the technician called it off. */
  bookingCancelledByProvider: {
    stem: 'booking.cancelledByProvider',
    params: ['categoryName', 'time'],
  },

  /* ---- quotations ---- */

  quotationSent: {
    stem: 'quotation.sent',
    params: ['providerName', 'total'],
  },
  quotationApproved: {
    stem: 'quotation.approved',
    params: ['total'],
  },
  quotationRejected: {
    stem: 'quotation.rejected',
    params: ['categoryName'],
  },

  /* ---- money ---- */

  paymentCapturedCustomer: {
    stem: 'payment.capturedCustomer',
    params: ['amount'],
  },
  paymentCapturedProvider: {
    stem: 'payment.capturedProvider',
    params: ['netAmount'],
  },
  /**
   * The anti-fraud message, and the reason this phase exists at all.
   *
   * Recording cash is the one thing a technician can do unilaterally about money.
   * It gets three channels, including SMS, because a customer who never sees it
   * cannot dispute it — and a charge nobody can dispute is a charge somebody will
   * eventually invent.
   */
  paymentCashRecorded: {
    stem: 'payment.cashRecorded',
    params: ['amount'],
  },
  /**
   * The mirror of the above, and it needs the same reach for the opposite
   * reason: nothing has been charged, and the customer has to know the bill is
   * back in their hands before they walk away thinking it is settled.
   */
  paymentCashNotReceived: {
    stem: 'payment.cashNotReceived',
    params: ['amount'],
  },
  payoutPaid: {
    stem: 'payout.paid',
    params: ['amount', 'utr'],
  },

  /* ---- trust ---- */

  providerSuspended: {
    stem: 'provider.suspended',
    params: ['reason', 'until'],
  },
  providerReinstated: {
    stem: 'provider.reinstated',
    params: [],
  },
  providerBadgeChanged: {
    stem: 'provider.badgeChanged',
    params: ['badge'],
  },

  /* ---- complaints ---- */

  complaintOpened: {
    stem: 'complaint.opened',
    params: ['category'],
  },
  complaintResolvedRaiser: {
    stem: 'complaint.resolvedRaiser',
    params: ['category'],
  },
  complaintResolvedAgainst: {
    stem: 'complaint.resolvedAgainst',
    params: ['category'],
  },
  complaintDismissedRaiser: {
    stem: 'complaint.dismissedRaiser',
    params: ['category'],
  },
  complaintDismissedAgainst: {
    stem: 'complaint.dismissedAgainst',
    params: ['category'],
  },
} as const satisfies Record<string, TemplateSpec>;

export type TemplateId = keyof typeof TEMPLATES;

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export function titleKeyOf(spec: TemplateSpec): string {
  return `notif.${spec.stem}.title`;
}

export function bodyKeyOf(spec: TemplateSpec): string {
  return `notif.${spec.stem}.body`;
}

const BY_STEM = new Map<string, TemplateId>(TEMPLATE_IDS.map((id) => [TEMPLATES[id].stem, id]));

/**
 * Recovers the template from a stored `body_key`.
 *
 * A stored notification keeps its keys, not its template id — the keys are what
 * the renderer needs and what a locale file can be checked against. But a
 * *resend* (the quiet-hours release job, hours later) needs the id back, because
 * real vendors want the parameters positionally and only the template knows the
 * order.
 */
export function templateIdFromBodyKey(bodyKey: string): TemplateId | null {
  const stem = bodyKey.replace(/^notif\./, '').replace(/\.body$/, '');
  return BY_STEM.get(stem) ?? null;
}

/**
 * Keys reached **through** a parameter rather than by a template directly.
 *
 * A `{ t: 'key' }` parameter that resolves to nothing would leave a technician
 * reading "आपका खाता रोका गया है: trust.suspension.severeComplaint", which is
 * worse than silence — so the completeness test covers these too.
 */
export const TRANSLATED_PARAM_KEYS: readonly string[] = [
  // Suspension reasons, owned by the trust module and reused verbatim here.
  'trust.suspension.lowTrust',
  'trust.suspension.repeatCancellation',
  'trust.suspension.severeComplaint',
  'trust.suspension.safetyPending',
  'trust.suspension.opsManual',
  // Badge bands.
  'notif.badge.VERIFIED',
  'notif.badge.SILVER',
  'notif.badge.GOLD',
  // Stand-ins for somebody who has not filled in a name yet.
  'notif.fallback.provider',
  'notif.fallback.customer',
  // Complaint categories.
  'notif.complaintCategory.overcharge',
  'notif.complaintCategory.no_show',
  'notif.complaintCategory.quality',
  'notif.complaintCategory.behavior',
  'notif.complaintCategory.cash_dispute',
  'notif.complaintCategory.safety',
  'notif.complaintCategory.other',
];
