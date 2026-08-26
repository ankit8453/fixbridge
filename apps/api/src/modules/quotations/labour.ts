import type { PriceType } from '@prisma/client';

/**
 * What a technician may charge for their own time, and why it is not their
 * choice alone.
 *
 * ## The bug this exists to close
 *
 * A booking snapshots the price card the customer actually saw
 * (`bookings.price_card_amount_paise` / `price_card_type`) — deliberately, so a
 * technician editing their rate afterwards cannot change a job already agreed.
 * That part was always right.
 *
 * But `Quotation.labourPaise` was a free field and this module did not exist:
 * nothing compared the quoted labour against the snapshot. A technician listed
 * at ₹300 could quote ₹500 and the system accepted it in silence. Worse,
 * `computePayable` prefers `basis: 'approved_quotation'` over the price card,
 * so the quotation did not merely contradict the agreed price — it replaced it.
 *
 * ## The shape
 *
 * Labour is now two numbers rather than one:
 *
 *   - **agreed** — derived from the snapshot, not accepted from the client.
 *   - **extra** — additional work found on site, which needs a reason a
 *     customer can read before they approve it.
 *
 * Extra work is a real thing. Somebody books a fan and then asks about the
 * switchboard, and refusing to price that on the spot just pushes the
 * transaction off-platform, where nobody is protected. What is not acceptable
 * is an unexplained number: "₹200 extra" with no reason is how a marketplace
 * loses the trust it sells.
 *
 * ## Three price types, three different promises
 *
 * | shown to the customer | rule                                    |
 * | --------------------- | --------------------------------------- |
 * | `fixed` "₹300"        | agreed labour is exactly ₹300           |
 * | `starting_from` "₹300+"| a floor — may exceed, never go below    |
 * | `inspection_based`    | no anchor; labour is free but must be   |
 * |                       | explained                               |
 *
 * Reading `starting_from` as a fixed price would be the mirror-image bug: it
 * would forbid the honest, expected case of a job that turns out bigger than
 * the floor advertised.
 */

/**
 * The ceiling on extra labour: the smaller of the agreed labour itself, or
 * ₹5,000.
 *
 * Both halves matter. Without the percentage, a ₹300 job could quietly become
 * ₹5,300. Without the flat cap, a ₹20,000 job could gain another ₹20,000 of
 * "extra" and still pass a percentage test.
 *
 * Above this the quote is NOT refused — it is flagged for ops review. Blocking
 * it would push a genuinely large job off-platform, which is a worse outcome
 * than a human looking at it.
 */
export const EXTRA_LABOUR_FLAT_CAP_PAISE = 50_00_00;

/** Enough characters to be a sentence, not a shrug. */
export const EXTRA_REASON_MIN_LENGTH = 10;
export const EXTRA_REASON_MAX_LENGTH = 300;

export interface PriceAnchor {
  priceType: PriceType | null;
  amountPaise: number | null;
}

export type LabourRejectionReason =
  'below_floor' | 'agreed_mismatch' | 'reason_required' | 'reason_too_short' | 'negative_extra';

export class LabourRuleError extends Error {
  constructor(
    message: string,
    readonly reason: LabourRejectionReason,
    /** Filled where the client can usefully show the number it should have used. */
    readonly expectedPaise?: number,
  ) {
    super(message);
    this.name = 'LabourRuleError';
  }
}

export interface LabourDecision {
  /** What the customer already agreed to. Zero when there was no anchor. */
  agreedLabourPaise: number;
  /** Additional work found on site. */
  extraLabourPaise: number;
  /** Required whenever `extraLabourPaise` is above zero. */
  extraLabourReason: string | null;
  /** `agreed + extra` — what the rest of the pipeline treats as labour. */
  totalLabourPaise: number;
  /**
   * True when the extra exceeds the cap. The quote is still valid and still
   * reaches the customer; ops get to look at it.
   */
  needsReview: boolean;
}

/**
 * The agreed portion, derived from the booking snapshot rather than trusted
 * from the client.
 *
 * Returns 0 for `inspection_based` and for any booking with no usable anchor —
 * an estimate is not an agreement, so there is nothing to lock to.
 */
export function agreedLabourFor(anchor: PriceAnchor): number {
  if (anchor.amountPaise === null || anchor.amountPaise < 0) return 0;
  if (anchor.priceType === 'fixed' || anchor.priceType === 'starting_from') {
    return anchor.amountPaise;
  }
  return 0;
}

/** The cap for a given agreed amount — see `EXTRA_LABOUR_FLAT_CAP_PAISE`. */
export function extraLabourCapFor(agreedLabourPaise: number): number {
  return Math.min(agreedLabourPaise, EXTRA_LABOUR_FLAT_CAP_PAISE);
}

/**
 * Validates a technician's labour figures against what the customer agreed to.
 *
 * Called by the service before anything is written. The client is expected to
 * enforce the same rules for a decent experience, but this is the one that
 * counts — a partner app is not a trust boundary.
 */
export function decideLabour(input: {
  anchor: PriceAnchor;
  extraLabourPaise: number;
  extraLabourReason: string | null;
  /**
   * Only consulted when there is no anchor (`inspection_based`, or a booking
   * made with no price card). Ignored otherwise, because the agreed portion is
   * derived, never supplied.
   */
  unanchoredLabourPaise?: number;
}): LabourDecision {
  const { anchor, extraLabourPaise } = input;
  const reason = input.extraLabourReason?.trim() ?? null;

  if (!Number.isSafeInteger(extraLabourPaise) || extraLabourPaise < 0) {
    throw new LabourRuleError(
      'extra labour must be a whole number of paise, zero or more',
      'negative_extra',
    );
  }

  const agreed = agreedLabourFor(anchor);

  /**
   * No anchor: `inspection_based`, or a booking with no price card at all.
   * There is nothing to lock to, so the whole figure is the technician's to
   * set — but it travels as `extra`, which means the reason requirement below
   * still applies. A price nobody quoted in advance is exactly the one that
   * needs explaining.
   */
  if (agreed === 0) {
    const quoted = input.unanchoredLabourPaise ?? extraLabourPaise;

    if (!Number.isSafeInteger(quoted) || quoted < 0) {
      throw new LabourRuleError(
        'labour must be a whole number of paise, zero or more',
        'negative_extra',
      );
    }

    requireReasonIfCharging(quoted, reason);

    return {
      agreedLabourPaise: 0,
      extraLabourPaise: quoted,
      extraLabourReason: quoted > 0 ? reason : null,
      totalLabourPaise: quoted,
      // Nothing to measure a cap against, so nothing to flag on that basis.
      needsReview: false,
    };
  }

  requireReasonIfCharging(extraLabourPaise, reason);

  return {
    agreedLabourPaise: agreed,
    extraLabourPaise,
    extraLabourReason: extraLabourPaise > 0 ? reason : null,
    totalLabourPaise: agreed + extraLabourPaise,
    needsReview: extraLabourPaise > extraLabourCapFor(agreed),
  };
}

/**
 * A separate check for the `starting_from` case, where the client sends a whole
 * labour figure rather than a delta.
 *
 * The floor is a promise: "from ₹300" may become ₹450 when the job turns out
 * bigger, but it may never become ₹250 — that would mean the number the
 * customer chose this technician on was not real.
 */
export function assertNotBelowFloor(anchor: PriceAnchor, totalLabourPaise: number): void {
  if (anchor.priceType !== 'starting_from' || anchor.amountPaise === null) return;

  if (totalLabourPaise < anchor.amountPaise) {
    throw new LabourRuleError(
      'labour may not be below the starting price the customer saw',
      'below_floor',
      anchor.amountPaise,
    );
  }
}

/**
 * A `fixed` price card means exactly that number.
 *
 * Split out from `decideLabour` so the service can call it with whatever the
 * client claimed the agreed portion was, and refuse a mismatch loudly rather
 * than silently overwriting it. A client sending a different agreed figure is
 * either out of date or lying, and both are worth an error.
 */
export function assertAgreedMatches(anchor: PriceAnchor, claimedAgreedPaise: number): void {
  const expected = agreedLabourFor(anchor);

  if (claimedAgreedPaise !== expected) {
    throw new LabourRuleError(
      'the agreed labour does not match what the customer booked',
      'agreed_mismatch',
      expected,
    );
  }
}

function requireReasonIfCharging(amountPaise: number, reason: string | null): void {
  if (amountPaise <= 0) return;

  if (!reason) {
    throw new LabourRuleError(
      'extra labour needs a reason the customer can read',
      'reason_required',
    );
  }

  if (reason.length < EXTRA_REASON_MIN_LENGTH) {
    throw new LabourRuleError(
      `the reason must be at least ${EXTRA_REASON_MIN_LENGTH} characters`,
      'reason_too_short',
    );
  }
}
