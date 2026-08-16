/**
 * Quotation arithmetic. Integers in paise, and nothing else.
 *
 * ## Why `int4` and not `int8`
 *
 * A Postgres `integer` tops out at 2,147,483,647 paise — **₹2,14,74,836**. A
 * doorstep repair quotation that reaches ₹2 crore is not a large job, it is a
 * bug or a fraud, and neither is made safer by a wider column. `int4` halves the
 * storage on the two hottest money columns and, more usefully, gives us a hard
 * ceiling the database itself will enforce: Postgres **raises** on integer
 * overflow rather than wrapping, so a runaway multiplication fails loudly.
 *
 * We do not rely on that, though. The caps below keep every intermediate value
 * three orders of magnitude clear of the ceiling, so the overflow path is a
 * backstop that should never fire — and there is a test that proves it fires
 * anyway if it ever has to.
 */

/** ₹50,000 for one unit of anything. Above this, someone typed an extra zero. */
export const MAX_UNIT_PAISE = 50_00_000;

/** 999 of anything at a doorstep job. */
export const MAX_QTY = 999;

/** ₹2,00,000 for one line. */
export const MAX_LINE_TOTAL_PAISE = 200_00_000;

/** ₹2,00,000 for the whole quotation. */
export const MAX_QUOTATION_TOTAL_PAISE = 200_00_000;

/**
 * 50 lines is already an unreadable quote on a phone.
 *
 * With the caps above this also bounds the worst case at
 * 50 × ₹2,00,000 = ₹1,00,00,000 — comfortably inside `int4`, so the sum can
 * never overflow before the total cap rejects it.
 */
export const MAX_ITEMS = 50;

export interface QuotationLineInput {
  qty: number;
  unitPaise: number;
}

export interface QuotationTotals {
  lineTotals: number[];
  partsTotalPaise: number;
  totalPaise: number;
}

export class QuotationMathError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'empty'
      | 'too_many_items'
      | 'bad_qty'
      | 'bad_unit'
      | 'line_too_large'
      | 'total_too_large'
      | 'bad_labour',
  ) {
    super(message);
    this.name = 'QuotationMathError';
  }
}

/**
 * The single place a quotation total is computed.
 *
 * The service writes what this returns and the database re-checks it with
 * `total_paise = labour_paise + parts_total_paise` and
 * `line_total_paise = qty * unit_paise`. Two independent statements of the same
 * arithmetic: if they ever disagree, the write fails instead of a customer being
 * shown a total that is not the sum of what is above it.
 */
export function computeQuotationTotals(
  labourPaise: number,
  items: readonly QuotationLineInput[],
): QuotationTotals {
  if (!Number.isSafeInteger(labourPaise) || labourPaise < 0) {
    throw new QuotationMathError(
      'labour must be a whole number of paise, zero or more',
      'bad_labour',
    );
  }

  if (items.length > MAX_ITEMS) {
    throw new QuotationMathError(
      `a quotation may have at most ${MAX_ITEMS} lines`,
      'too_many_items',
    );
  }

  const lineTotals: number[] = [];

  for (const item of items) {
    if (!Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) {
      throw new QuotationMathError(
        `quantity must be a whole number from 1 to ${MAX_QTY}`,
        'bad_qty',
      );
    }

    if (
      !Number.isSafeInteger(item.unitPaise) ||
      item.unitPaise < 1 ||
      item.unitPaise > MAX_UNIT_PAISE
    ) {
      throw new QuotationMathError(
        `unit price must be a whole number of paise from 1 to ${MAX_UNIT_PAISE}`,
        'bad_unit',
      );
    }

    const lineTotal = item.qty * item.unitPaise;

    if (lineTotal > MAX_LINE_TOTAL_PAISE) {
      throw new QuotationMathError(
        `a single line may not exceed ${MAX_LINE_TOTAL_PAISE} paise`,
        'line_too_large',
      );
    }

    lineTotals.push(lineTotal);
  }

  const partsTotalPaise = lineTotals.reduce((sum, line) => sum + line, 0);
  const totalPaise = labourPaise + partsTotalPaise;

  // A pure-labour quote is legal — plenty of jobs are only someone's time. An
  // empty one is not: "₹0, please approve" is not a price.
  if (totalPaise <= 0) {
    throw new QuotationMathError('a quotation must come to more than zero', 'empty');
  }

  if (totalPaise > MAX_QUOTATION_TOTAL_PAISE) {
    throw new QuotationMathError(
      `a quotation may not exceed ${MAX_QUOTATION_TOTAL_PAISE} paise`,
      'total_too_large',
    );
  }

  return { lineTotals, partsTotalPaise, totalPaise };
}
