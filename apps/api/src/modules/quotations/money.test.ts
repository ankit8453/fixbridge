import { describe, expect, it } from 'vitest';
import {
  MAX_ITEMS,
  MAX_LINE_TOTAL_PAISE,
  MAX_QTY,
  MAX_QUOTATION_TOTAL_PAISE,
  MAX_UNIT_PAISE,
  QuotationMathError,
  computeQuotationTotals,
} from './money';

const line = (qty: number, unitPaise: number) => ({ qty, unitPaise });

describe('computeQuotationTotals', () => {
  it('adds labour to the sum of the lines', () => {
    // ₹500 labour + (2 × ₹120) + (1 × ₹80) = ₹820
    const totals = computeQuotationTotals(50_000, [line(2, 12_000), line(1, 8_000)]);

    expect(totals.lineTotals).toEqual([24_000, 8_000]);
    expect(totals.partsTotalPaise).toBe(32_000);
    expect(totals.totalPaise).toBe(82_000);
  });

  it('allows a pure-labour quote', () => {
    // Plenty of jobs are only somebody's time.
    const totals = computeQuotationTotals(35_000, []);

    expect(totals).toEqual({ lineTotals: [], partsTotalPaise: 0, totalPaise: 35_000 });
  });

  it('allows a parts-only quote', () => {
    const totals = computeQuotationTotals(0, [line(3, 15_000)]);

    expect(totals.totalPaise).toBe(45_000);
  });

  it('rejects an empty quotation', () => {
    // "₹0, please approve" is not a price.
    expect(() => computeQuotationTotals(0, [])).toThrowError(
      expect.objectContaining({ reason: 'empty' }),
    );
  });

  it('rejects a negative or fractional labour charge', () => {
    expect(() => computeQuotationTotals(-1, [line(1, 100)])).toThrowError(
      expect.objectContaining({ reason: 'bad_labour' }),
    );
    expect(() => computeQuotationTotals(12.5, [line(1, 100)])).toThrowError(
      expect.objectContaining({ reason: 'bad_labour' }),
    );
  });

  it.each([0, -3, 1.5, MAX_QTY + 1])('rejects quantity %s', (qty) => {
    expect(() => computeQuotationTotals(0, [line(qty, 10_000)])).toThrowError(
      expect.objectContaining({ reason: 'bad_qty' }),
    );
  });

  it.each([0, -100, 99.5, MAX_UNIT_PAISE + 1])('rejects unit price %s', (unitPaise) => {
    expect(() => computeQuotationTotals(0, [line(1, unitPaise)])).toThrowError(
      expect.objectContaining({ reason: 'bad_unit' }),
    );
  });

  it('rejects more lines than a phone screen can show', () => {
    const items = Array.from({ length: MAX_ITEMS + 1 }, () => line(1, 100));

    expect(() => computeQuotationTotals(0, items)).toThrowError(
      expect.objectContaining({ reason: 'too_many_items' }),
    );
  });

  it('accepts exactly the maximum number of lines', () => {
    const items = Array.from({ length: MAX_ITEMS }, () => line(1, 100));

    expect(computeQuotationTotals(0, items).totalPaise).toBe(MAX_ITEMS * 100);
  });

  /**
   * The overflow guard.
   *
   * `int4` tops out at 2,147,483,647. Both caps below sit three orders of
   * magnitude under that, so the arithmetic is refused long before Postgres
   * would have to raise — the database ceiling is a backstop, not the plan.
   */
  it('refuses a line that would run away, well before int4 could overflow', () => {
    const enormous = computeQuotationTotals.bind(null, 0, [line(MAX_QTY, MAX_UNIT_PAISE)]);

    expect(enormous).toThrowError(expect.objectContaining({ reason: 'line_too_large' }));

    // What the caps would have permitted, had nothing stopped them.
    expect(MAX_QTY * MAX_UNIT_PAISE).toBeGreaterThan(2_147_483_647);
    // What they actually permit.
    expect(MAX_ITEMS * MAX_LINE_TOTAL_PAISE).toBeLessThan(2_147_483_647);
  });

  it('refuses a total above the quotation cap', () => {
    const justOver = MAX_QUOTATION_TOTAL_PAISE + 1;

    expect(() => computeQuotationTotals(justOver, [])).toThrowError(
      expect.objectContaining({ reason: 'total_too_large' }),
    );
  });

  it('accepts a total exactly at the cap', () => {
    expect(computeQuotationTotals(MAX_QUOTATION_TOTAL_PAISE, []).totalPaise).toBe(
      MAX_QUOTATION_TOTAL_PAISE,
    );
  });

  it('reports a typed reason so the API can localise it', () => {
    try {
      computeQuotationTotals(0, []);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(QuotationMathError);
      expect((error as QuotationMathError).reason).toBe('empty');
    }
  });

  it('never produces a fractional paise', () => {
    // Integers in, integers out — there is no path through this that divides.
    const totals = computeQuotationTotals(33_333, [line(7, 14_285), line(3, 9_999)]);

    for (const value of [...totals.lineTotals, totals.partsTotalPaise, totals.totalPaise]) {
      expect(Number.isInteger(value)).toBe(true);
    }

    expect(totals.totalPaise).toBe(33_333 + 7 * 14_285 + 3 * 9_999);
  });
});
