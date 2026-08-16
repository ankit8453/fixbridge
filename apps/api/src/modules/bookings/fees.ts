/**
 * What the technician charges for turning up.
 *
 * A table rather than a constant because the honest number differs by trade. A
 * motor rewinder arrives with tools, a meter and half a morning gone; someone
 * changing a tap washer does not. Charging both the same either underpays the
 * first or overcharges the second, and the second is the customer we most need
 * to keep.
 *
 * Resolution is pure and lives here so the chain can be unit-tested without a
 * database, and so the seed and the API can never disagree about what a given
 * booking should have been charged.
 */

export interface FeeConfigRow {
  /** Null means "the default for this city". */
  categoryId: number | null;
  visitFeePaise: number;
  isActive: boolean;
  effectiveFrom: Date;
}

export interface FeeScope {
  /** The booked service. */
  categoryId: number;
  /** Its cluster, so one row can price a whole trade. Null for a cluster itself. */
  parentCategoryId: number | null;
}

/** Which rung of the chain answered. Recorded on the booking's breakdown. */
export type FeeSource = 'category' | 'cluster' | 'city' | 'global';

export interface ResolvedFee {
  visitFeePaise: number;
  source: FeeSource;
}

/**
 * Most specific wins, then most recent.
 *
 * `service → cluster → city → global`. The cluster rung is what lets ops write
 * "every motor and genset job in Jabalpur costs ₹99 to visit" as one row instead
 * of four that drift apart.
 *
 * Rows dated in the future are ignored rather than an error: scheduling a price
 * change is the point of `effective_from`, and it must not affect today.
 */
export function resolveVisitFee(
  rows: readonly FeeConfigRow[],
  scope: FeeScope,
  globalDefaultPaise: number,
  at: Date = new Date(),
): ResolvedFee {
  const live = rows.filter((row) => row.isActive && row.effectiveFrom.getTime() <= at.getTime());

  const rungs: { source: FeeSource; matches: (row: FeeConfigRow) => boolean }[] = [
    { source: 'category', matches: (row) => row.categoryId === scope.categoryId },
    {
      source: 'cluster',
      matches: (row) =>
        scope.parentCategoryId !== null && row.categoryId === scope.parentCategoryId,
    },
    { source: 'city', matches: (row) => row.categoryId === null },
  ];

  for (const rung of rungs) {
    const candidates = live.filter(rung.matches);
    if (candidates.length === 0) continue;

    // Most recently effective. A unique index keeps two rows from tying.
    const winner = candidates.reduce((best, row) =>
      row.effectiveFrom.getTime() > best.effectiveFrom.getTime() ? row : best,
    );

    return { visitFeePaise: winner.visitFeePaise, source: rung.source };
  }

  // Nothing configured is not a failure — it is a new city on its first day.
  return { visitFeePaise: globalDefaultPaise, source: 'global' };
}
