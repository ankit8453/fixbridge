import {
  resolveScopedConfig,
  type ConfigScope,
  type ConfigSource,
  type ScopedConfigRow,
} from '../../core/scoped-config';

/**
 * What the technician charges for turning up.
 *
 * A table rather than a constant because the honest number differs by trade. A
 * motor rewinder arrives with tools, a meter and half a morning gone; someone
 * changing a tap washer does not. Charging both the same either underpays the
 * first or overcharges the second, and the second is the customer we most need
 * to keep.
 *
 * The chain itself lives in `core/scoped-config.ts` — `commission_config`
 * resolves identically, and one tested function beats two that drift.
 */

export interface FeeConfigRow {
  /** Null means "the default for this city". */
  categoryId: number | null;
  visitFeePaise: number;
  isActive: boolean;
  effectiveFrom: Date;
}

export type FeeScope = ConfigScope;
export type FeeSource = ConfigSource;

export interface ResolvedFee {
  visitFeePaise: number;
  source: FeeSource;
}

/** Most specific wins, then most recent: service → cluster → city → global. */
export function resolveVisitFee(
  rows: readonly FeeConfigRow[],
  scope: FeeScope,
  globalDefaultPaise: number,
  at: Date = new Date(),
): ResolvedFee {
  const scoped: ScopedConfigRow<number>[] = rows.map((row) => ({
    categoryId: row.categoryId,
    value: row.visitFeePaise,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
  }));

  const resolved = resolveScopedConfig(scoped, scope, globalDefaultPaise, at);

  return { visitFeePaise: resolved.value, source: resolved.source };
}
