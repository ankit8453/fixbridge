import {
  resolveScopedConfig,
  type ConfigScope,
  type ConfigSource,
  type ScopedConfigRow,
} from '../../core/scoped-config';

/**
 * The platform's cut.
 *
 * Stored in basis points — 1200 = 12% — because percentages with decimal points
 * are how rounding errors get into money. An integer count of hundredths of a
 * percent divides cleanly and reads unambiguously in a config row.
 *
 * The rate is **snapshotted onto the payment when it is collected**. Changing
 * the config later moves nothing that has already happened, which is the only
 * defensible behaviour: a technician agreed to a rate on the day they did the
 * work, and a repricing six weeks later is not a thing that can reach back.
 */

export const BPS_DENOMINATOR = 10_000;

export interface CommissionConfigRow {
  categoryId: number | null;
  rateBps: number;
  isActive: boolean;
  effectiveFrom: Date;
}

export type CommissionScope = ConfigScope;
export type CommissionSource = ConfigSource;

export interface ResolvedCommission {
  rateBps: number;
  source: CommissionSource;
}

/** Same chain as the visit fee: service → cluster → city → global. */
export function resolveCommissionRate(
  rows: readonly CommissionConfigRow[],
  scope: CommissionScope,
  globalDefaultBps: number,
  at: Date = new Date(),
): ResolvedCommission {
  const scoped: ScopedConfigRow<number>[] = rows.map((row) => ({
    categoryId: row.categoryId,
    value: row.rateBps,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
  }));

  const resolved = resolveScopedConfig(scoped, scope, globalDefaultBps, at);

  return { rateBps: resolved.value, source: resolved.source };
}

export interface CommissionSplit {
  /** What the customer paid. */
  grossPaise: number;
  /** Our cut, rounded down. */
  commissionPaise: number;
  /** What the technician earns. Always `gross − commission`, exactly. */
  providerPaise: number;
  rateBps: number;
}

/**
 * Splits a payment into our cut and theirs.
 *
 * **Rounds down**, deliberately: the fraction of a paisa always goes to the
 * technician. Over a year that is a handful of rupees the platform forgoes, and
 * it makes the rule "we never round in our own favour" true without an asterisk
 * — which is worth more than the rupees when a technician is checking their
 * wallet against a bill.
 *
 * The two halves are derived from one subtraction rather than two roundings, so
 * they cannot fail to add back up to the gross. That property is what lets the
 * ledger journal balance by construction.
 */
export function splitCommission(grossPaise: number, rateBps: number): CommissionSplit {
  if (!Number.isSafeInteger(grossPaise) || grossPaise <= 0) {
    throw new Error(`commission split needs a positive whole amount, got ${grossPaise}`);
  }

  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > BPS_DENOMINATOR) {
    throw new Error(`commission rate must be 0–${BPS_DENOMINATOR} bps, got ${rateBps}`);
  }

  const commissionPaise = Math.floor((grossPaise * rateBps) / BPS_DENOMINATOR);

  return {
    grossPaise,
    commissionPaise,
    providerPaise: grossPaise - commissionPaise,
    rateBps,
  };
}

/**
 * The same split, scaled to a partial refund.
 *
 * A refund has to come out of both pockets in the proportion the money went in,
 * or a partial refund quietly becomes a transfer from the platform to the
 * technician (or the reverse). Computed from the refund amount at the original
 * rate, with the same round-down rule, and again with the provider share as the
 * remainder so the reversal balances exactly.
 */
export function splitRefund(refundPaise: number, rateBps: number): CommissionSplit {
  return splitCommission(refundPaise, rateBps);
}
