import { describe, expect, it } from 'vitest';
import {
  BPS_DENOMINATOR,
  resolveCommissionRate,
  splitCommission,
  splitRefund,
  type CommissionConfigRow,
} from './commission';

/** Fridge repair (leaf) under Cooling & Appliances (cluster). */
const SCOPE = { categoryId: 42, parentCategoryId: 7 };
const AT = new Date('2026-08-16T00:00:00.000Z');

const row = (
  overrides: Partial<CommissionConfigRow> & { rateBps: number },
): CommissionConfigRow => ({
  categoryId: null,
  isActive: true,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('splitCommission', () => {
  it('takes the stated percentage', () => {
    // 12% of ₹1,450 is ₹174 exactly.
    expect(splitCommission(145_000, 1_200)).toEqual({
      grossPaise: 145_000,
      commissionPaise: 17_400,
      providerPaise: 127_600,
      rateBps: 1_200,
    });
  });

  it('always adds back up to the gross', () => {
    // The property that makes the capture journal balance by construction.
    for (const gross of [1, 7, 99, 100, 12_345, 999_999, 22_900, 62_900]) {
      for (const bps of [0, 1, 250, 1_000, 1_200, 3_333, 10_000]) {
        const split = splitCommission(gross, bps);
        expect(split.commissionPaise + split.providerPaise).toBe(gross);
      }
    }
  });

  /**
   * The rounding rule, stated as a test because it is a promise to technicians:
   * the fraction of a paisa always goes to them, never to us.
   */
  it('rounds the fraction of a paisa to the technician, never to the platform', () => {
    // 12% of ₹1.01 is 12.12 paise. We take 12, they get 89.
    expect(splitCommission(101, 1_200)).toMatchObject({
      commissionPaise: 12,
      providerPaise: 89,
    });

    // 33.33% of ₹0.07 is 2.33 paise. We take 2.
    expect(splitCommission(7, 3_333)).toMatchObject({ commissionPaise: 2, providerPaise: 5 });
  });

  it('never rounds up, at any rate or amount', () => {
    for (let gross = 1; gross <= 400; gross += 1) {
      for (const bps of [1, 137, 1_200, 2_500, 9_999]) {
        const split = splitCommission(gross, bps);
        const exact = (gross * bps) / BPS_DENOMINATOR;

        expect(split.commissionPaise).toBeLessThanOrEqual(exact);
        expect(exact - split.commissionPaise).toBeLessThan(1);
      }
    }
  });

  it('handles the two ends of the range', () => {
    expect(splitCommission(50_000, 0)).toMatchObject({ commissionPaise: 0, providerPaise: 50_000 });
    expect(splitCommission(50_000, BPS_DENOMINATOR)).toMatchObject({
      commissionPaise: 50_000,
      providerPaise: 0,
    });
  });

  it('refuses an amount or a rate that is not a whole, sane number', () => {
    expect(() => splitCommission(0, 1_200)).toThrow(/positive whole amount/);
    expect(() => splitCommission(-500, 1_200)).toThrow(/positive whole amount/);
    expect(() => splitCommission(12.5, 1_200)).toThrow(/positive whole amount/);
    expect(() => splitCommission(1_000, -1)).toThrow(/0–10000 bps/);
    expect(() => splitCommission(1_000, 10_001)).toThrow(/0–10000 bps/);
  });
});

describe('splitRefund', () => {
  it('reverses in the same proportion the money went in', () => {
    // ₹500 back on a job billed at 12%: ₹60 from us, ₹440 from the technician.
    expect(splitRefund(50_000, 1_200)).toMatchObject({
      commissionPaise: 6_000,
      providerPaise: 44_000,
    });
  });

  it('never lets a refund become a transfer between the two pockets', () => {
    // If the shares did not sum to the refund, one side would be quietly
    // subsidising the other on every partial refund.
    for (const amount of [1, 999, 50_000, 145_000]) {
      const back = splitRefund(amount, 1_200);
      expect(back.commissionPaise + back.providerPaise).toBe(amount);
    }
  });
});

describe('resolveCommissionRate — the chain', () => {
  it('falls back to the global default', () => {
    expect(resolveCommissionRate([], SCOPE, 1_200, AT)).toEqual({
      rateBps: 1_200,
      source: 'global',
    });
  });

  it('prefers a cluster rate over the city default', () => {
    // The seeded case: motors and gensets at 10% where the city is 12%.
    const rows = [row({ rateBps: 1_200 }), row({ categoryId: 7, rateBps: 1_000 })];

    expect(resolveCommissionRate(rows, SCOPE, 1_200, AT)).toEqual({
      rateBps: 1_000,
      source: 'cluster',
    });
  });

  it('prefers an exact service rate over its cluster', () => {
    const rows = [
      row({ rateBps: 1_200 }),
      row({ categoryId: 7, rateBps: 1_000 }),
      row({ categoryId: 42, rateBps: 800 }),
    ];

    expect(resolveCommissionRate(rows, SCOPE, 1_200, AT)).toEqual({
      rateBps: 800,
      source: 'category',
    });
  });

  it('ignores a rate that has not come into effect yet', () => {
    const rows = [
      row({ rateBps: 1_200 }),
      row({ rateBps: 1_500, effectiveFrom: new Date('2026-12-01T00:00:00.000Z') }),
    ];

    expect(resolveCommissionRate(rows, SCOPE, 1_200, AT).rateBps).toBe(1_200);
  });

  it('ignores a deactivated rate', () => {
    const rows = [row({ categoryId: 42, rateBps: 500, isActive: false }), row({ rateBps: 1_200 })];

    expect(resolveCommissionRate(rows, SCOPE, 1_200, AT)).toEqual({
      rateBps: 1_200,
      source: 'city',
    });
  });

  it('decides specificity before recency', () => {
    // A cluster rate set in January still beats a city default changed yesterday.
    const rows = [
      row({ categoryId: 7, rateBps: 1_000, effectiveFrom: new Date('2026-01-01T00:00:00.000Z') }),
      row({ rateBps: 1_500, effectiveFrom: new Date('2026-08-15T00:00:00.000Z') }),
    ];

    expect(resolveCommissionRate(rows, SCOPE, 1_200, AT)).toEqual({
      rateBps: 1_000,
      source: 'cluster',
    });
  });
});
