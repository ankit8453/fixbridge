import { describe, expect, it } from 'vitest';
import { resolveVisitFee, type FeeConfigRow } from './fees';

const GLOBAL = 4_900;

const AT = new Date('2026-08-16T00:00:00.000Z');

const row = (overrides: Partial<FeeConfigRow> & { visitFeePaise: number }): FeeConfigRow => ({
  categoryId: null,
  isActive: true,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

/** Fridge repair (leaf) under Cooling & Appliances (cluster). */
const SCOPE = { categoryId: 42, parentCategoryId: 7 };

describe('resolveVisitFee — the chain', () => {
  it('falls back to the global default when nothing is configured', () => {
    expect(resolveVisitFee([], SCOPE, GLOBAL, AT)).toEqual({
      visitFeePaise: GLOBAL,
      source: 'global',
    });
  });

  it('uses the city default when only that exists', () => {
    const rows = [row({ visitFeePaise: 5_900 })];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT)).toEqual({
      visitFeePaise: 5_900,
      source: 'city',
    });
  });

  /**
   * The rung that makes the table worth having: ops price a whole trade with one
   * row rather than one per service, which is how four rows end up disagreeing
   * with each other by the second month.
   */
  it('prefers a cluster row over the city default', () => {
    const rows = [row({ visitFeePaise: 4_900 }), row({ categoryId: 7, visitFeePaise: 9_900 })];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT)).toEqual({
      visitFeePaise: 9_900,
      source: 'cluster',
    });
  });

  it('prefers an exact service row over its cluster and the city', () => {
    const rows = [
      row({ visitFeePaise: 4_900 }),
      row({ categoryId: 7, visitFeePaise: 9_900 }),
      row({ categoryId: 42, visitFeePaise: 7_900 }),
    ];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT)).toEqual({
      visitFeePaise: 7_900,
      source: 'category',
    });
  });

  it('does not treat a cluster booking as its own child', () => {
    // Booking a cluster directly is not something the API allows, but the
    // resolver must not read `parentCategoryId: null` as "matches everything".
    const rows = [row({ categoryId: 42, visitFeePaise: 7_900 }), row({ visitFeePaise: 4_900 })];

    expect(resolveVisitFee(rows, { categoryId: 7, parentCategoryId: null }, GLOBAL, AT)).toEqual({
      visitFeePaise: 4_900,
      source: 'city',
    });
  });
});

describe('resolveVisitFee — time and activation', () => {
  it('ignores a row that is not yet effective', () => {
    // Scheduling a price change is the point of `effective_from`. It must not
    // affect today's bookings.
    const rows = [
      row({ visitFeePaise: 4_900 }),
      row({ visitFeePaise: 6_900, effectiveFrom: new Date('2026-12-01T00:00:00.000Z') }),
    ];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT).visitFeePaise).toBe(4_900);
  });

  it('takes the most recent row that has come into effect', () => {
    const rows = [
      row({ visitFeePaise: 4_900, effectiveFrom: new Date('2026-01-01T00:00:00.000Z') }),
      row({ visitFeePaise: 5_900, effectiveFrom: new Date('2026-06-01T00:00:00.000Z') }),
      row({ visitFeePaise: 6_900, effectiveFrom: new Date('2026-12-01T00:00:00.000Z') }),
    ];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT).visitFeePaise).toBe(5_900);
  });

  it('honours a row effective at this exact instant', () => {
    const rows = [row({ visitFeePaise: 8_900, effectiveFrom: AT })];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT).visitFeePaise).toBe(8_900);
  });

  it('ignores deactivated rows', () => {
    const rows = [
      row({ categoryId: 42, visitFeePaise: 9_900, isActive: false }),
      row({ visitFeePaise: 4_900 }),
    ];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT)).toEqual({
      visitFeePaise: 4_900,
      source: 'city',
    });
  });

  it('falls all the way through when every row is deactivated', () => {
    const rows = [row({ visitFeePaise: 5_900, isActive: false })];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT).source).toBe('global');
  });

  it('never lets a specific-but-older row lose to a general-but-newer one', () => {
    // Specificity is decided before recency. A cluster price set in January
    // still beats a city default changed yesterday.
    const rows = [
      row({
        categoryId: 7,
        visitFeePaise: 9_900,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      }),
      row({ visitFeePaise: 5_900, effectiveFrom: new Date('2026-08-15T00:00:00.000Z') }),
    ];

    expect(resolveVisitFee(rows, SCOPE, GLOBAL, AT)).toEqual({
      visitFeePaise: 9_900,
      source: 'cluster',
    });
  });
});
