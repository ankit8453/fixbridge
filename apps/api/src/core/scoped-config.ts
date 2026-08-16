/**
 * Resolving a city/category-scoped setting.
 *
 * Two tables now share this shape — `fee_config` (what a visit costs) and
 * `commission_config` (what we take) — and a third will arrive eventually. They
 * resolve the same way for the same reason, so they resolve through the same
 * tested function rather than two copies that drift.
 *
 * The chain is **service → cluster → city → global**, most specific first and
 * most recent within a rung. The cluster rung is the one that earns its keep:
 * ops price a whole trade with one row instead of one per service, and one row
 * cannot disagree with itself.
 */

export interface ScopedConfigRow<T> {
  /** Null means "the default for this city". */
  categoryId: number | null;
  value: T;
  isActive: boolean;
  effectiveFrom: Date;
}

export interface ConfigScope {
  /** The booked service. */
  categoryId: number;
  /** Its cluster, so one row can cover a whole trade. Null for a cluster itself. */
  parentCategoryId: number | null;
}

/** Which rung answered. Recorded alongside the value so a number can be explained. */
export type ConfigSource = 'category' | 'cluster' | 'city' | 'global';

export interface ResolvedConfig<T> {
  value: T;
  source: ConfigSource;
}

export function resolveScopedConfig<T>(
  rows: readonly ScopedConfigRow<T>[],
  scope: ConfigScope,
  globalDefault: T,
  at: Date = new Date(),
): ResolvedConfig<T> {
  // A row dated in the future is a scheduled change, not a mistake — ignoring it
  // is the whole reason `effective_from` exists.
  const live = rows.filter((row) => row.isActive && row.effectiveFrom.getTime() <= at.getTime());

  const rungs: { source: ConfigSource; matches: (row: ScopedConfigRow<T>) => boolean }[] = [
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

    return { value: winner.value, source: rung.source };
  }

  // Nothing configured is not a failure — it is a new city on its first day.
  return { value: globalDefault, source: 'global' };
}
