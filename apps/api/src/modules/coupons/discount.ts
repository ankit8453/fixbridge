/**
 * Coupon arithmetic and eligibility. Integers in paise, and nothing else.
 *
 * ## The rule this whole module exists to protect
 *
 * > A coupon is **funded by the platform's commission, never by the
 * > technician's earnings.**
 *
 * The technician is paid on the **pre-discount** amount, always. The customer
 * pays less; the difference comes out of our cut. This is not a preference, it
 * is the only version of a discount that is honest: a technician who quoted
 * ₹1,000 and did ₹1,000 of work did not agree to fund our marketing, and a
 * marketplace that quietly makes them do so is one they leave.
 *
 * That rule is why `computeDiscount` below returns the discount **and** the
 * untouched provider-facing gross as two separate numbers. Callers that only
 * take the new customer total, and re-derive the technician's share from it,
 * are the bug this shape is designed to make hard to write.
 *
 * ## Why online-only, enforced here
 *
 * On cash the technician collects the discounted amount **in their hand**, while
 * our commission is computed on the full price — so the discount would come
 * straight out of the technician's pocket, which is precisely rule #1 inverted.
 * There is no way to net that back out: the money never touches the platform.
 * So a coupon on a cash booking is refused, in this pure function, rather than
 * only being hidden in the UI. A validation that lives only in a screen is a
 * validation that a second client, a replayed request or a curl will not have.
 *
 * ## Why every coupon must be capped
 *
 * A percentage with no ceiling is an unbounded liability: `20% off` is ₹200 on a
 * routine job and ₹40,000 on a commercial rewiring quote. `maxDiscountPaise` is
 * required by the schema, by the database CHECK, and re-applied here.
 */

/** Percent coupons are whole percents. 1–100, and the DB CHECKs the same range. */
export const MIN_PERCENT = 1;
export const MAX_PERCENT = 100;

/**
 * ₹20,000 off a single doorstep job.
 *
 * Not a business rule so much as a blast radius. Every cap above this is a typo
 * or a compromised console account, and the cheapest place to find that out is
 * before the row is written rather than after a month of redemptions.
 */
export const MAX_CAP_PAISE = 200_00_000;

export type DiscountType = 'percent' | 'flat';

export type CouponStatus = 'active' | 'paused' | 'expired';

/** How the customer intends to pay. Only `online` may carry a coupon. */
export type PaymentMethodChoice = 'online' | 'cash';

/**
 * The coupon as the validator needs it — a plain value, deliberately not a
 * Prisma row, so this module can be unit-tested without a database and reused
 * from anywhere.
 */
export interface CouponTerms {
  code: string;
  discountType: DiscountType;
  /** Whole percent for `percent`; paise for `flat`. */
  value: number;
  /** The required ceiling. Always applies, including to a flat coupon. */
  maxDiscountPaise: number;
  minOrderPaise: number;
  validFrom: Date;
  validUntil: Date;
  status: CouponStatus;
  /** Null means "every city". */
  cityId: number | null;
  /** Null means "every category". */
  categoryId: number | null;
  /** Null means "no global ceiling on redemptions". */
  totalUsageLimit: number | null;
  perCustomerLimit: number;
}

/** The booking the coupon is being applied to, and who is applying it. */
export interface RedemptionContext {
  /** The pre-discount amount the customer would otherwise pay. */
  orderPaise: number;
  paymentMethod: PaymentMethodChoice;
  cityId: number;
  categoryId: number;
  /** Redemptions of this coupon by everybody, so far. */
  totalRedemptions: number;
  /** Redemptions of this coupon by this customer, so far. */
  customerRedemptions: number;
  at: Date;
}

/**
 * Why a coupon was refused, as a closed set.
 *
 * A `reason` rather than only a message because two different audiences read
 * it: the customer gets a translated sentence chosen by this code, and ops get
 * a value they can count. "It didn't work" is not a support ticket anybody can
 * act on.
 */
export type CouponRejectionReason =
  | 'not_found'
  | 'not_active'
  | 'not_started'
  | 'expired'
  | 'below_min_order'
  | 'usage_limit_reached'
  | 'per_customer_limit_reached'
  | 'city_not_eligible'
  | 'category_not_eligible'
  | 'cash_not_eligible'
  | 'nothing_to_discount';

export class CouponRejectedError extends Error {
  constructor(
    message: string,
    readonly reason: CouponRejectionReason,
  ) {
    super(message);
    this.name = 'CouponRejectedError';
  }
}

/** Coupon terms that are internally impossible — a bug, not a customer's problem. */
export class CouponTermsError extends Error {
  constructor(
    message: string,
    readonly reason: 'bad_percent' | 'bad_flat' | 'bad_cap' | 'bad_min_order' | 'bad_window',
  ) {
    super(message);
    this.name = 'CouponTermsError';
  }
}

/**
 * Codes are stored and compared uppercase.
 *
 * A customer typing `diwali50` off a poster that reads `DIWALI50` has entered
 * the right code, and telling them otherwise is a self-inflicted support
 * ticket. Normalising in one exported function — rather than sprinkling
 * `.toUpperCase()` at each call site — is what keeps the write path and the
 * lookup path agreeing, which is the only way the unique index means anything.
 */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Validates the terms themselves, independently of any booking.
 *
 * Called on create and on edit, before anything is written. The database CHECKs
 * assert the same invariants — deliberately, and in the same spirit as
 * `quotations/money.ts`: two independent statements of one rule, so a write that
 * slips past the application still cannot land.
 */
export function assertValidTerms(terms: {
  discountType: DiscountType;
  value: number;
  maxDiscountPaise: number;
  minOrderPaise: number;
  validFrom: Date;
  validUntil: Date;
}): void {
  if (terms.discountType === 'percent') {
    if (
      !Number.isSafeInteger(terms.value) ||
      terms.value < MIN_PERCENT ||
      terms.value > MAX_PERCENT
    ) {
      throw new CouponTermsError(
        `a percent coupon must be a whole ${MIN_PERCENT}–${MAX_PERCENT}, got ${terms.value}`,
        'bad_percent',
      );
    }
  } else if (!Number.isSafeInteger(terms.value) || terms.value < 1) {
    throw new CouponTermsError(
      `a flat coupon must be a positive whole number of paise, got ${terms.value}`,
      'bad_flat',
    );
  }

  if (
    !Number.isSafeInteger(terms.maxDiscountPaise) ||
    terms.maxDiscountPaise < 1 ||
    terms.maxDiscountPaise > MAX_CAP_PAISE
  ) {
    throw new CouponTermsError(
      `the discount cap must be a whole number of paise from 1 to ${MAX_CAP_PAISE}`,
      'bad_cap',
    );
  }

  if (!Number.isSafeInteger(terms.minOrderPaise) || terms.minOrderPaise < 0) {
    throw new CouponTermsError(
      'the minimum order must be a whole number of paise, zero or more',
      'bad_min_order',
    );
  }

  if (terms.validUntil.getTime() <= terms.validFrom.getTime()) {
    throw new CouponTermsError('a coupon must expire after it starts', 'bad_window');
  }
}

export interface DiscountResult {
  /** What comes off the customer's bill. Always ≥ 1 and ≤ the order. */
  discountPaise: number;
  /** What the customer now pays. */
  payablePaise: number;
  /**
   * The pre-discount amount, restated.
   *
   * **This is the number the technician is paid on**, and it is returned
   * explicitly so no caller has to remember to keep it — a payout derived from
   * `payablePaise` is the failure this whole module exists to prevent.
   */
  providerGrossPaise: number;
  /** True when the cap, not the percentage, decided the amount. Ops care. */
  cappedByMax: boolean;
}

/**
 * The discount for one booking, or a `CouponRejectedError` explaining why not.
 *
 * Pure: every input is passed in, including `at` and both redemption counts, so
 * the whole decision table can be tested against hand-computed fixtures. The
 * checks run in a deliberate order — the reasons a customer can *act on*
 * (wrong payment method, order too small) come before the ones they cannot
 * (exhausted, out of scope), because the first is a nudge and the second is a
 * dead end, and telling somebody the dead end first wastes the nudge.
 */
export function computeDiscount(terms: CouponTerms, context: RedemptionContext): DiscountResult {
  assertValidTerms(terms);

  if (!Number.isSafeInteger(context.orderPaise) || context.orderPaise <= 0) {
    throw new CouponRejectedError(
      'there is nothing to discount on this booking',
      'nothing_to_discount',
    );
  }

  /**
   * Cash first, and refused outright.
   *
   * See the module header: on cash the discount would be funded by the
   * technician, not by us. This is checked before the coupon's own state so the
   * customer is told the actionable thing ("pay online to use this") rather
   * than being sent away over a paused coupon they could not have fixed either.
   */
  if (context.paymentMethod !== 'online') {
    throw new CouponRejectedError(
      'coupons apply to online payments only',
      'cash_not_eligible',
    );
  }

  if (terms.status !== 'active') {
    throw new CouponRejectedError(`coupon ${terms.code} is ${terms.status}`, 'not_active');
  }

  const now = context.at.getTime();

  if (now < terms.validFrom.getTime()) {
    throw new CouponRejectedError(`coupon ${terms.code} has not started yet`, 'not_started');
  }

  // The window is half-open: valid *until* means the instant it stops working.
  if (now >= terms.validUntil.getTime()) {
    throw new CouponRejectedError(`coupon ${terms.code} has expired`, 'expired');
  }

  if (context.orderPaise < terms.minOrderPaise) {
    throw new CouponRejectedError(
      `this coupon needs an order of at least ${terms.minOrderPaise} paise`,
      'below_min_order',
    );
  }

  if (terms.cityId !== null && terms.cityId !== context.cityId) {
    throw new CouponRejectedError(
      `coupon ${terms.code} is not available in this city`,
      'city_not_eligible',
    );
  }

  if (terms.categoryId !== null && terms.categoryId !== context.categoryId) {
    throw new CouponRejectedError(
      `coupon ${terms.code} does not apply to this service`,
      'category_not_eligible',
    );
  }

  if (terms.totalUsageLimit !== null && context.totalRedemptions >= terms.totalUsageLimit) {
    throw new CouponRejectedError(
      `coupon ${terms.code} has been fully redeemed`,
      'usage_limit_reached',
    );
  }

  if (context.customerRedemptions >= terms.perCustomerLimit) {
    throw new CouponRejectedError(
      `you have already used coupon ${terms.code}`,
      'per_customer_limit_reached',
    );
  }

  const discountPaise = discountAmount(terms, context.orderPaise);

  return {
    discountPaise,
    payablePaise: context.orderPaise - discountPaise,
    // Restated, never derived from the discounted figure. See `DiscountResult`.
    providerGrossPaise: context.orderPaise,
    cappedByMax: discountPaise === terms.maxDiscountPaise,
  };
}

/**
 * The amount itself, once eligibility is settled.
 *
 * **Rounds down.** A percentage of a paise-denominated amount is rarely whole —
 * 10% of ₹1,234.57 is 12345.7 paise — and the fraction has to go somewhere. It
 * goes to the platform, the same direction `splitCommission` rounds, so that
 * "we never round in our own favour" stays true from the *technician's* side,
 * which is the side that rule was written to protect. The customer's exposure is
 * at most one paisa on a discount, and rounding a discount *up* would let a
 * 100%-off coupon on an odd amount produce a payable of −1.
 *
 * Three ceilings apply, in this order, and the smallest wins:
 *   1. the coupon's own value (a percentage of the order, or the flat amount);
 *   2. `maxDiscountPaise`, the required cap;
 *   3. the order itself — a discount may never exceed the bill and create a
 *      negative payable, which is a refund with extra steps.
 */
function discountAmount(terms: CouponTerms, orderPaise: number): number {
  const raw =
    terms.discountType === 'percent'
      ? Math.floor((orderPaise * terms.value) / 100)
      : terms.value;

  return Math.max(0, Math.min(raw, terms.maxDiscountPaise, orderPaise));
}
