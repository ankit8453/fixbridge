import { describe, expect, it } from 'vitest';
import {
  CouponRejectedError,
  CouponTermsError,
  MAX_CAP_PAISE,
  assertValidTerms,
  computeDiscount,
  normalizeCode,
  type CouponTerms,
  type RedemptionContext,
} from './discount';

/**
 * The discount rules, against hand-computed fixtures.
 *
 * The arithmetic here decides what a customer pays and — by staying out of it —
 * what a technician earns, so it is tested the same way `quotations/money.ts`
 * is: exhaustively, in paise, with the expected number written out rather than
 * recomputed by the test.
 */

const FROM = new Date('2026-08-01T00:00:00.000Z');
const UNTIL = new Date('2026-09-01T00:00:00.000Z');
const AT = new Date('2026-08-15T12:00:00.000Z');

const terms = (overrides: Partial<CouponTerms> = {}): CouponTerms => ({
  code: 'DIWALI20',
  discountType: 'percent',
  value: 20,
  maxDiscountPaise: 50_000, // ₹500
  minOrderPaise: 0,
  validFrom: FROM,
  validUntil: UNTIL,
  status: 'active',
  cityId: null,
  categoryId: null,
  totalUsageLimit: null,
  perCustomerLimit: 1,
  ...overrides,
});

const context = (overrides: Partial<RedemptionContext> = {}): RedemptionContext => ({
  orderPaise: 100_000, // ₹1,000
  paymentMethod: 'online',
  cityId: 1,
  categoryId: 10,
  totalRedemptions: 0,
  customerRedemptions: 0,
  at: AT,
  ...overrides,
});

describe('normalizeCode', () => {
  it('uppercases and trims, so a poster and a keyboard agree', () => {
    expect(normalizeCode('  diwali20 ')).toBe('DIWALI20');
  });
});

describe('computeDiscount — the money', () => {
  it('takes a percentage off the order', () => {
    // 20% of ₹1,000 = ₹200, under the ₹500 cap.
    const result = computeDiscount(terms(), context());

    expect(result.discountPaise).toBe(20_000);
    expect(result.payablePaise).toBe(80_000);
    expect(result.cappedByMax).toBe(false);
  });

  it('takes a flat amount off the order', () => {
    const result = computeDiscount(
      terms({ discountType: 'flat', value: 15_000, maxDiscountPaise: 20_000 }),
      context(),
    );

    expect(result.discountPaise).toBe(15_000);
    expect(result.payablePaise).toBe(85_000);
  });

  /**
   * The reason the cap is mandatory. Without it this same coupon takes ₹4,000
   * off a ₹20,000 job — the unbounded-loss case the product owner ruled out.
   */
  it('never exceeds the cap, however large the order', () => {
    const result = computeDiscount(terms(), context({ orderPaise: 20_00_000 }));

    expect(result.discountPaise).toBe(50_000);
    expect(result.payablePaise).toBe(19_50_000);
    expect(result.cappedByMax).toBe(true);
  });

  it('caps a flat coupon too', () => {
    // A flat coupon worth more than its own ceiling is a misconfiguration the
    // cap still contains rather than honours.
    const result = computeDiscount(
      terms({ discountType: 'flat', value: 90_000, maxDiscountPaise: 25_000 }),
      context(),
    );

    expect(result.discountPaise).toBe(25_000);
  });

  it('never discounts more than the bill itself', () => {
    // A ₹500 flat coupon against a ₹300 order is ₹300 off, not ₹500 — a
    // negative payable is a refund with extra steps.
    const result = computeDiscount(
      terms({ discountType: 'flat', value: 50_000, maxDiscountPaise: 50_000 }),
      context({ orderPaise: 30_000 }),
    );

    expect(result.discountPaise).toBe(30_000);
    expect(result.payablePaise).toBe(0);
  });

  it('rounds a fractional percentage down, in the platform’s direction', () => {
    // 10% of 123457 paise = 12345.7 → 12345. The stray fraction stays with the
    // platform so "we never round against the technician" holds without an
    // asterisk, and a 100% coupon can never produce a payable of −1.
    const result = computeDiscount(
      terms({ value: 10, maxDiscountPaise: MAX_CAP_PAISE }),
      context({ orderPaise: 123_457 }),
    );

    expect(result.discountPaise).toBe(12_345);
    expect(result.payablePaise).toBe(111_112);
    expect(result.discountPaise + result.payablePaise).toBe(123_457);
  });

  /**
   * The single most important property in the module.
   *
   * The technician is paid on the pre-discount amount, so the discount must
   * never appear in `providerGrossPaise` — whatever the coupon does to the
   * customer's side.
   */
  it('leaves the provider gross at the pre-discount amount', () => {
    const result = computeDiscount(terms(), context({ orderPaise: 100_000 }));

    expect(result.providerGrossPaise).toBe(100_000);
    expect(result.providerGrossPaise).not.toBe(result.payablePaise);
  });

  it('always adds back up: discount + payable = the original order', () => {
    for (const orderPaise of [1, 999, 100_000, 123_457, 20_00_000]) {
      const result = computeDiscount(terms(), context({ orderPaise }));

      expect(result.discountPaise + result.payablePaise).toBe(orderPaise);
      expect(result.providerGrossPaise).toBe(orderPaise);
    }
  });
});

describe('computeDiscount — eligibility', () => {
  const rejects = (
    reason: string,
    overrides: { terms?: Partial<CouponTerms>; context?: Partial<RedemptionContext> } = {},
  ) => {
    expect(() => computeDiscount(terms(overrides.terms), context(overrides.context))).toThrowError(
      expect.objectContaining({ reason }),
    );
  };

  /**
   * The rule the product owner made non-negotiable, and the reason it is
   * enforced in a pure function rather than in a screen: on cash the technician
   * collects the discounted amount by hand while commission is computed on the
   * full price, so the discount would come out of *their* pocket.
   */
  it('refuses a cash booking', () => {
    rejects('cash_not_eligible', { context: { paymentMethod: 'cash' } });
  });

  it('refuses cash even when the coupon is otherwise perfect', () => {
    // Ordered before the coupon's own state on purpose: "pay online to use
    // this" is actionable, "this coupon is paused" is not.
    rejects('cash_not_eligible', {
      terms: { status: 'paused' },
      context: { paymentMethod: 'cash' },
    });
  });

  it('refuses a paused or expired coupon', () => {
    rejects('not_active', { terms: { status: 'paused' } });
    rejects('not_active', { terms: { status: 'expired' } });
  });

  it('refuses a coupon that has not started', () => {
    rejects('not_started', { context: { at: new Date('2026-07-31T23:59:59.000Z') } });
  });

  it('refuses a coupon past its window', () => {
    rejects('expired', { context: { at: new Date('2026-09-01T00:00:01.000Z') } });
  });

  it('treats validUntil as the instant it stops working', () => {
    // Half-open window: valid *until* 1 Sep means 1 Sep 00:00:00.000 is out.
    rejects('expired', { context: { at: UNTIL } });

    expect(() =>
      computeDiscount(terms(), context({ at: new Date(UNTIL.getTime() - 1) })),
    ).not.toThrow();
  });

  it('refuses an order below the minimum', () => {
    rejects('below_min_order', {
      terms: { minOrderPaise: 100_000 },
      context: { orderPaise: 99_999 },
    });

    // Exactly at the minimum is in.
    expect(() =>
      computeDiscount(terms({ minOrderPaise: 100_000 }), context({ orderPaise: 100_000 })),
    ).not.toThrow();
  });

  it('honours a city scope', () => {
    rejects('city_not_eligible', { terms: { cityId: 2 }, context: { cityId: 1 } });

    expect(() => computeDiscount(terms({ cityId: 1 }), context({ cityId: 1 }))).not.toThrow();
  });

  it('honours a category scope', () => {
    rejects('category_not_eligible', { terms: { categoryId: 99 }, context: { categoryId: 10 } });
  });

  it('refuses once the global usage limit is reached', () => {
    rejects('usage_limit_reached', {
      terms: { totalUsageLimit: 100 },
      context: { totalRedemptions: 100 },
    });

    // One left.
    expect(() =>
      computeDiscount(terms({ totalUsageLimit: 100 }), context({ totalRedemptions: 99 })),
    ).not.toThrow();
  });

  it('lets an unlimited coupon keep going', () => {
    expect(() =>
      computeDiscount(terms({ totalUsageLimit: null }), context({ totalRedemptions: 10_000 })),
    ).not.toThrow();
  });

  it('refuses a customer who has already used it', () => {
    rejects('per_customer_limit_reached', { context: { customerRedemptions: 1 } });

    expect(() =>
      computeDiscount(terms({ perCustomerLimit: 3 }), context({ customerRedemptions: 2 })),
    ).not.toThrow();
  });

  it('refuses a booking with nothing to discount', () => {
    rejects('nothing_to_discount', { context: { orderPaise: 0 } });
  });

  it('carries a reason on the error, for ops to count', () => {
    try {
      computeDiscount(terms(), context({ paymentMethod: 'cash' }));
      expect.unreachable('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(CouponRejectedError);
      expect((error as CouponRejectedError).reason).toBe('cash_not_eligible');
    }
  });
});

describe('assertValidTerms', () => {
  const base = {
    discountType: 'percent' as const,
    value: 20,
    maxDiscountPaise: 50_000,
    minOrderPaise: 0,
    validFrom: FROM,
    validUntil: UNTIL,
  };

  it('accepts sane terms', () => {
    expect(() => assertValidTerms(base)).not.toThrow();
  });

  it('rejects a percentage outside 1–100', () => {
    for (const value of [0, -5, 101, 1.5]) {
      expect(() => assertValidTerms({ ...base, value })).toThrowError(
        expect.objectContaining({ reason: 'bad_percent' }),
      );
    }
  });

  it('rejects a non-positive flat amount', () => {
    expect(() => assertValidTerms({ ...base, discountType: 'flat', value: 0 })).toThrowError(
      expect.objectContaining({ reason: 'bad_flat' }),
    );
  });

  /** The cap is required, so zero and null-shaped values are terms errors. */
  it('rejects a missing or absurd cap', () => {
    expect(() => assertValidTerms({ ...base, maxDiscountPaise: 0 })).toThrowError(
      expect.objectContaining({ reason: 'bad_cap' }),
    );
    expect(() => assertValidTerms({ ...base, maxDiscountPaise: MAX_CAP_PAISE + 1 })).toThrowError(
      expect.objectContaining({ reason: 'bad_cap' }),
    );
  });

  it('rejects a negative minimum order', () => {
    expect(() => assertValidTerms({ ...base, minOrderPaise: -1 })).toThrowError(
      expect.objectContaining({ reason: 'bad_min_order' }),
    );
  });

  it('rejects a window that ends before it starts', () => {
    expect(() => assertValidTerms({ ...base, validFrom: UNTIL, validUntil: FROM })).toThrowError(
      expect.objectContaining({ reason: 'bad_window' }),
    );

    // Zero-length is also refused: a coupon valid for no time is a bug.
    expect(() => assertValidTerms({ ...base, validFrom: FROM, validUntil: FROM })).toThrowError(
      CouponTermsError,
    );
  });

  it('is re-checked by computeDiscount, so bad terms cannot pay out', () => {
    expect(() => computeDiscount(terms({ value: 150 }), context())).toThrowError(CouponTermsError);
  });
});
