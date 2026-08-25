import { describe, expect, it } from 'vitest';
import {
  agreedLabourFor,
  assertAgreedMatches,
  assertNotBelowFloor,
  decideLabour,
  extraLabourCapFor,
  EXTRA_LABOUR_FLAT_CAP_PAISE,
  LabourRuleError,
} from './labour';

/**
 * The rule these tests defend: a technician cannot quietly charge more for
 * their time than the customer agreed to when they chose them.
 *
 * Before this module existed, `Quotation.labourPaise` was a free field and
 * nothing consulted the booking's price snapshot. A technician listed at ₹300
 * could quote ₹500, and because `computePayable` prefers an approved quotation
 * over the price card, that ₹500 became the price. The customer chose one
 * number and paid another.
 */

const RS = (rupees: number): number => rupees * 100;

describe('agreed labour comes from the snapshot, not the client', () => {
  it('locks to the amount for a fixed price card', () => {
    expect(agreedLabourFor({ priceType: 'fixed', amountPaise: RS(300) })).toBe(RS(300));
  });

  it('locks to the floor for a starting-from card', () => {
    expect(agreedLabourFor({ priceType: 'starting_from', amountPaise: RS(300) })).toBe(RS(300));
  });

  it('has no anchor for an inspection-based card', () => {
    // "Depends on the job" is not a price anybody agreed to.
    expect(agreedLabourFor({ priceType: 'inspection_based', amountPaise: RS(300) })).toBe(0);
  });

  it('has no anchor when the booking carried no price card', () => {
    expect(agreedLabourFor({ priceType: null, amountPaise: null })).toBe(0);
  });
});

describe('the exact scenario that prompted this', () => {
  it('a ₹300 technician quoting ₹500 has to declare ₹200 of it as extra, with a reason', () => {
    const anchor = { priceType: 'fixed' as const, amountPaise: RS(300) };

    const decision = decideLabour({
      anchor,
      extraLabourPaise: RS(200),
      extraLabourReason: 'Also rewired the switchboard, which was not in the original job',
    });

    expect(decision.agreedLabourPaise).toBe(RS(300));
    expect(decision.extraLabourPaise).toBe(RS(200));
    expect(decision.totalLabourPaise).toBe(RS(500));
    // ₹200 is within min(₹300, ₹5,000), so no review needed.
    expect(decision.needsReview).toBe(false);
  });

  it('refuses the same ₹200 with no explanation', () => {
    expect(() =>
      decideLabour({
        anchor: { priceType: 'fixed', amountPaise: RS(300) },
        extraLabourPaise: RS(200),
        extraLabourReason: null,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'reason_required' }));
  });

  it('refuses a reason too short to mean anything', () => {
    expect(() =>
      decideLabour({
        anchor: { priceType: 'fixed', amountPaise: RS(300) },
        extraLabourPaise: RS(200),
        extraLabourReason: 'extra',
      }),
    ).toThrowError(expect.objectContaining({ reason: 'reason_too_short' }));
  });

  it('needs no reason when nothing extra is charged', () => {
    const decision = decideLabour({
      anchor: { priceType: 'fixed', amountPaise: RS(300) },
      extraLabourPaise: 0,
      extraLabourReason: null,
    });

    expect(decision.totalLabourPaise).toBe(RS(300));
    expect(decision.extraLabourReason).toBeNull();
  });

  it('rejects a client that claims a different agreed figure than the booking holds', () => {
    // Either the app is out of date or it is lying. Both deserve an error
    // rather than being silently overwritten.
    expect(() => assertAgreedMatches({ priceType: 'fixed', amountPaise: RS(300) }, RS(500))).toThrow(
      LabourRuleError,
    );

    expect(() =>
      assertAgreedMatches({ priceType: 'fixed', amountPaise: RS(300) }, RS(300)),
    ).not.toThrow();
  });
});

describe('the cap on extra labour', () => {
  it('is the agreed amount itself on a small job', () => {
    // A ₹300 job cannot quietly become ₹900.
    expect(extraLabourCapFor(RS(300))).toBe(RS(300));
  });

  it('is the flat ₹5,000 ceiling on a large one', () => {
    // Without this, a ₹20,000 job could gain another ₹20,000 and still pass a
    // percentage-only test.
    expect(extraLabourCapFor(RS(20_000))).toBe(EXTRA_LABOUR_FLAT_CAP_PAISE);
  });

  it('flags rather than refuses when the cap is exceeded', () => {
    const decision = decideLabour({
      anchor: { priceType: 'fixed', amountPaise: RS(300) },
      extraLabourPaise: RS(400),
      extraLabourReason: 'Rewired the whole room, far beyond the original request',
    });

    // Still a valid quote the customer can see and approve — blocking it would
    // push a genuinely large job off-platform, where nobody is protected.
    expect(decision.totalLabourPaise).toBe(RS(700));
    expect(decision.needsReview).toBe(true);
  });

  it('does not flag exactly at the cap', () => {
    const decision = decideLabour({
      anchor: { priceType: 'fixed', amountPaise: RS(300) },
      extraLabourPaise: RS(300),
      extraLabourReason: 'Second fan installed at the same visit, agreed on site',
    });

    expect(decision.needsReview).toBe(false);
  });
});

describe('starting_from is a floor, not a price', () => {
  const anchor = { priceType: 'starting_from' as const, amountPaise: RS(300) };

  it('allows a job that turns out bigger than the floor', () => {
    // The mirror-image bug would be treating this like `fixed` and forbidding
    // the honest, expected case.
    expect(() => assertNotBelowFloor(anchor, RS(450))).not.toThrow();
  });

  it('refuses labour below the number the customer chose them on', () => {
    expect(() => assertNotBelowFloor(anchor, RS(250))).toThrowError(
      expect.objectContaining({ reason: 'below_floor', expectedPaise: RS(300) }),
    );
  });

  it('allows exactly the floor', () => {
    expect(() => assertNotBelowFloor(anchor, RS(300))).not.toThrow();
  });

  it('does not constrain a fixed or inspection-based card', () => {
    expect(() => assertNotBelowFloor({ priceType: 'fixed', amountPaise: RS(300) }, 1)).not.toThrow();
    expect(() =>
      assertNotBelowFloor({ priceType: 'inspection_based', amountPaise: null }, 1),
    ).not.toThrow();
  });
});

describe('inspection_based has no anchor', () => {
  const anchor = { priceType: 'inspection_based' as const, amountPaise: null };

  it('lets the technician set the whole figure, but still demands an explanation', () => {
    const decision = decideLabour({
      anchor,
      extraLabourPaise: RS(800),
      extraLabourReason: 'Traced and replaced a shorted length of concealed wiring',
    });

    expect(decision.agreedLabourPaise).toBe(0);
    expect(decision.totalLabourPaise).toBe(RS(800));
  });

  it('refuses an unexplained figure, because nobody quoted it in advance', () => {
    expect(() =>
      decideLabour({ anchor, extraLabourPaise: RS(800), extraLabourReason: null }),
    ).toThrowError(expect.objectContaining({ reason: 'reason_required' }));
  });
});

describe('rejects nonsense outright', () => {
  it.each([[-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'refuses %p as an extra amount',
    (value) => {
      expect(() =>
        decideLabour({
          anchor: { priceType: 'fixed', amountPaise: RS(300) },
          extraLabourPaise: value,
          extraLabourReason: 'A perfectly reasonable explanation of extra work',
        }),
      ).toThrowError(expect.objectContaining({ reason: 'negative_extra' }));
    },
  );
});
