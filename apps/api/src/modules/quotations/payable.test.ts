import { describe, expect, it } from 'vitest';
import {
  NoAgreedPriceError,
  NotBillableError,
  assertBreakdownAddsUp,
  computePayable,
  type PayableInput,
} from './payable';
import { BOOKING_STATUSES, isBillableBooking } from '../bookings/state-machine';

/**
 * Hand-computed fixtures throughout. This function decides what a person pays,
 * so every expected number below was worked out on paper first and none of them
 * is derived from the code under test.
 */

const VISIT_FEE = 4_900; // ₹49

const input = (overrides: Partial<PayableInput> = {}): PayableInput => ({
  outcome: 'WORK_DONE',
  visitFeePaise: VISIT_FEE,
  approvedQuoteTotalPaise: null,
  priceCard: { priceType: 'fixed', amountPaise: 18_000 },
  ...overrides,
});

describe('computePayable — the fixed price-card path', () => {
  it('charges the listed price plus the visit fee', () => {
    // ₹180 listed + ₹49 visit = ₹229
    const result = computePayable(input());

    expect(result.payablePaise).toBe(22_900);
    expect(result.visitFeeCharged).toBe(true);
    expect(result.basis).toBe('price_card');
    expect(result.components).toEqual([
      { kind: 'price_card', labelKey: 'payable.priceCard', amountPaise: 18_000 },
      { kind: 'visit_fee', labelKey: 'payable.visitFee', amountPaise: 4_900 },
    ]);
  });

  it('handles a zero visit fee without inventing one', () => {
    const result = computePayable(input({ visitFeePaise: 0 }));

    expect(result.payablePaise).toBe(18_000);
    // Still "charged" — it was applied, it just happened to be nothing.
    expect(result.visitFeeCharged).toBe(true);
  });

  it.each(['starting_from', 'inspection_based'] as const)(
    'refuses to bill a %s card with no approved quote',
    (priceType) => {
      // An estimate is not an agreement. The WORK_DONE guard should have caught
      // this upstream; reaching here at all is a bug, so it throws.
      expect(() =>
        computePayable(input({ priceCard: { priceType, amountPaise: 50_000 } })),
      ).toThrow(NoAgreedPriceError);
    },
  );

  it('refuses a fixed card with no amount, and a booking with no card at all', () => {
    expect(() =>
      computePayable(input({ priceCard: { priceType: 'fixed', amountPaise: null } })),
    ).toThrow(NoAgreedPriceError);

    expect(() => computePayable(input({ priceCard: null }))).toThrow(NoAgreedPriceError);
  });
});

describe('computePayable — the approved quotation path', () => {
  it('charges the quote total and waives the visit fee', () => {
    // ₹1,300 quoted; the trip is already inside that number.
    const result = computePayable(input({ approvedQuoteTotalPaise: 130_000 }));

    expect(result.payablePaise).toBe(130_000);
    expect(result.visitFeeCharged).toBe(false);
    expect(result.basis).toBe('approved_quotation');
  });

  it('shows the waived fee as a zero line rather than hiding it', () => {
    // A customer who was told there is a visit charge should be able to see
    // that it was not added, not have to infer it from arithmetic.
    const result = computePayable(input({ approvedQuoteTotalPaise: 130_000 }));

    expect(result.components).toEqual([
      { kind: 'quotation', labelKey: 'payable.approvedQuotation', amountPaise: 130_000 },
      { kind: 'visit_fee', labelKey: 'payable.visitFee', amountPaise: 0, waived: true },
    ]);
  });

  it('lets the quotation win over a fixed price card', () => {
    // Booked at a flat rate, then the job turned out to need more. The agreed
    // number is what was agreed — the card is history.
    const result = computePayable(
      input({
        approvedQuoteTotalPaise: 250_000,
        priceCard: { priceType: 'fixed', amountPaise: 18_000 },
      }),
    );

    expect(result.payablePaise).toBe(250_000);
    expect(result.basis).toBe('approved_quotation');
  });
});

describe('computePayable — the declined path', () => {
  it('charges the visit fee and nothing else', () => {
    const result = computePayable(
      input({ outcome: 'CLOSED_QUOTE_DECLINED', visitFeePaise: 9_900 }),
    );

    expect(result.payablePaise).toBe(9_900);
    expect(result.visitFeeCharged).toBe(true);
    expect(result.basis).toBe('visit_fee_only');
    expect(result.components).toEqual([
      { kind: 'visit_fee', labelKey: 'payable.visitFee', amountPaise: 9_900 },
    ]);
  });

  it('ignores the price card entirely — nothing was done', () => {
    const result = computePayable(
      input({
        outcome: 'CLOSED_QUOTE_DECLINED',
        priceCard: { priceType: 'fixed', amountPaise: 500_000 },
      }),
    );

    expect(result.payablePaise).toBe(VISIT_FEE);
  });
});

describe('computePayable — endings that owe nothing', () => {
  const owesNothing = BOOKING_STATUSES.filter((status) => !isBillableBooking(status));

  it.each(owesNothing)('refuses to price %s', (status) => {
    expect(() => computePayable(input({ outcome: status }))).toThrow(NotBillableError);
  });

  it('covers every status: each one is either billable or refused', () => {
    // Guards against a future status quietly acquiring no pricing rule at all.
    for (const status of BOOKING_STATUSES) {
      if (isBillableBooking(status)) {
        expect(() =>
          computePayable(input({ outcome: status, approvedQuoteTotalPaise: 1_000 })),
        ).not.toThrow();
      } else {
        expect(() => computePayable(input({ outcome: status }))).toThrow(NotBillableError);
      }
    }
  });
});

describe('assertBreakdownAddsUp', () => {
  it('passes for every breakdown the function produces', () => {
    const cases: PayableInput[] = [
      input(),
      input({ approvedQuoteTotalPaise: 130_000 }),
      input({ outcome: 'CLOSED_QUOTE_DECLINED' }),
      input({ visitFeePaise: 0 }),
    ];

    for (const each of cases) {
      expect(() => assertBreakdownAddsUp(computePayable(each))).not.toThrow();
    }
  });

  it('catches a breakdown whose parts do not sum to the total', () => {
    const tampered = computePayable(input());
    tampered.payablePaise += 1;

    expect(() => assertBreakdownAddsUp(tampered)).toThrow(/does not add up/);
  });
});
