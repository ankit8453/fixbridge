/**
 * Client-side mirror of `apps/api/src/modules/quotations/money.ts`.
 *
 * Not imported directly — `apps/api` and `apps/web` are separate deployables
 * with no shared runtime package for domain logic (see `lib/types.ts`'s
 * header for why). Duplicating the four caps and the running-total formula
 * here means the quote builder can show "line too large" the instant a
 * mistri types an extra zero, on a slow connection, rather than waiting a
 * round trip to be told the same thing the server was always going to say.
 * The server re-checks everything regardless — this is UX, not the source of
 * truth.
 */

export const MAX_UNIT_PAISE = 50_00_000;
export const MAX_QTY = 999;
export const MAX_LINE_TOTAL_PAISE = 200_00_000;
export const MAX_QUOTATION_TOTAL_PAISE = 200_00_000;
export const MAX_ITEMS = 50;

export type QuoteMathReason =
  | 'empty'
  | 'too_many_items'
  | 'bad_qty'
  | 'bad_unit'
  | 'line_too_large'
  | 'total_too_large'
  | 'bad_labour';

export interface QuoteLineInput {
  qty: number;
  unitPaise: number;
}

export interface QuoteTotals {
  lineTotals: number[];
  partsTotalPaise: number;
  totalPaise: number;
}

export type QuoteMathResult = ({ ok: true } & QuoteTotals) | { ok: false; reason: QuoteMathReason };

/**
 * Same arithmetic and same caps as the server, but returns a result instead
 * of throwing — a quote builder recomputes this on every keystroke, and a
 * try/catch around a running total is the wrong shape for a live form.
 */
export function computeQuoteTotals(
  labourPaise: number,
  items: readonly QuoteLineInput[],
): QuoteMathResult {
  if (!Number.isSafeInteger(labourPaise) || labourPaise < 0) {
    return { ok: false, reason: 'bad_labour' };
  }

  if (items.length > MAX_ITEMS) {
    return { ok: false, reason: 'too_many_items' };
  }

  const lineTotals: number[] = [];

  for (const item of items) {
    if (!Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) {
      return { ok: false, reason: 'bad_qty' };
    }

    if (
      !Number.isSafeInteger(item.unitPaise) ||
      item.unitPaise < 1 ||
      item.unitPaise > MAX_UNIT_PAISE
    ) {
      return { ok: false, reason: 'bad_unit' };
    }

    const lineTotal = item.qty * item.unitPaise;

    if (lineTotal > MAX_LINE_TOTAL_PAISE) {
      return { ok: false, reason: 'line_too_large' };
    }

    lineTotals.push(lineTotal);
  }

  const partsTotalPaise = lineTotals.reduce((sum, line) => sum + line, 0);
  const totalPaise = labourPaise + partsTotalPaise;

  if (totalPaise <= 0) {
    return { ok: false, reason: 'empty' };
  }

  if (totalPaise > MAX_QUOTATION_TOTAL_PAISE) {
    return { ok: false, reason: 'total_too_large' };
  }

  return { ok: true, lineTotals, partsTotalPaise, totalPaise };
}
