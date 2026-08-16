import type { Badge } from '../verification/badge';

/**
 * Result ranking — a pure function of one provider's signals.
 *
 * Two constraints shape this file:
 *
 *   1. **Weights live in config, nowhere else.** Reordering search results must
 *      never need a code change, so the scorer reads weights from its input and
 *      no other module knows they exist.
 *   2. **Signals that do not exist yet are still in the type.** Declaring them
 *      with documented neutral defaults means a later phase adds data, not a new
 *      scoring interface. Both signals that were once placeholders — acceptance
 *      rate in Phase 6, trust score in Phase 9 — went live without this file
 *      changing at all, which is the whole argument for the pattern.
 *
 * Every component is normalised to 0..1 before weighting, so a weight is
 * directly readable as "how much this matters relative to the others".
 */

export interface RankInput {
  /** Straight-line distance from the customer, in km. */
  distanceKm: number;
  /** The provider's own declared service radius, in km. */
  providerRadiusKm: number;
  badge: Badge;
  yearsExperience: number | null;
  /** 0–100, from the Phase 3 completeness scorer. */
  completenessScore: number;
  /** 0–1 (the 0–100 score divided by 100). Null until they have any history. */
  trustScore: number | null;
  /** 0–1, share of requests accepted. Null below the small-sample floor. */
  acceptanceRate: number | null;
  /** 0–1, where 0 is the cheapest in the result set. Null when no price is set. */
  priceBandPosition: number | null;
}

export interface RankWeights {
  distance: number;
  badge: number;
  experience: number;
  completeness: number;
  trust: number;
  acceptance: number;
  price: number;
  /** Distance at which the distance component scores 0.5. */
  distanceHalfLifeKm: number;
}

/**
 * What a missing signal is worth.
 *
 * All 0.5 — deliberately the midpoint, so an absent signal neither rewards nor
 * punishes. Using 0 would push every provider down equally (a wash, but it makes
 * the weight meaningless); using 1 would mean everyone looks perfect until real
 * data arrives and then everyone's score drops. The midpoint is what lets a new
 * technician and a busy one with a 0.5 acceptance rate sit side by side rather
 * than the newcomer being buried for having no record yet.
 */
export const NEUTRAL_DEFAULTS = {
  trustScore: 0.5,
  acceptanceRate: 0.5,
  priceBandPosition: 0.5,
} as const;

/** Above this, more years stops counting for much. */
export const EXPERIENCE_SATURATION_YEARS = 15;

/** Only VERIFIED is attainable today; the rest are Phase 9 bands. */
const BADGE_SCORE: Record<Badge, number> = {
  NONE: 0,
  VERIFIED: 0.7,
  SILVER: 0.85,
  GOLD: 1,
};

/**
 * Exponential decay: 1 at the door, 0.5 at the half-life, approaching 0 far away.
 *
 * Chosen over a linear `1 - d/max` because the difference between 1 km and 3 km
 * matters far more to someone with a broken geyser than the difference between
 * 18 km and 20 km, and linear scoring treats those as equal.
 */
export function distanceScore(distanceKm: number, halfLifeKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 1;
  return 0.5 ** (distanceKm / halfLifeKm);
}

/** Diminishing returns, flat after saturation. */
export function experienceScore(years: number | null): number {
  if (years === null || years <= 0) return 0;
  return Math.min(1, years / EXPERIENCE_SATURATION_YEARS);
}

export interface RankBreakdown {
  distance: number;
  badge: number;
  experience: number;
  completeness: number;
  trust: number;
  acceptance: number;
  price: number;
}

export interface RankResult {
  /** 0..1, normalised by the sum of weights so it is comparable across configs. */
  score: number;
  /** Each component's normalised value, before weighting. For debugging and docs. */
  breakdown: RankBreakdown;
}

export interface RankScorer {
  readonly name: string;
  score(input: RankInput): RankResult;
}

/**
 * The default weighted-sum scorer.
 *
 * `priceBandPosition` is inverted — cheaper is better — which is the one place
 * the direction is not obvious from the field name.
 */
export function createWeightedRankScorer(weights: RankWeights): RankScorer {
  const total =
    weights.distance +
    weights.badge +
    weights.experience +
    weights.completeness +
    weights.trust +
    weights.acceptance +
    weights.price;

  return {
    name: 'weighted-sum',

    score(input) {
      const breakdown: RankBreakdown = {
        distance: distanceScore(input.distanceKm, weights.distanceHalfLifeKm),
        badge: BADGE_SCORE[input.badge] ?? 0,
        experience: experienceScore(input.yearsExperience),
        completeness: Math.min(1, Math.max(0, input.completenessScore / 100)),
        trust: input.trustScore ?? NEUTRAL_DEFAULTS.trustScore,
        acceptance: input.acceptanceRate ?? NEUTRAL_DEFAULTS.acceptanceRate,
        price: 1 - (input.priceBandPosition ?? NEUTRAL_DEFAULTS.priceBandPosition),
      };

      // A config of all-zero weights would divide by zero; treat it as "no
      // opinion" rather than NaN, and let the caller's tiebreaker decide.
      if (total === 0) return { score: 0, breakdown };

      const weighted =
        breakdown.distance * weights.distance +
        breakdown.badge * weights.badge +
        breakdown.experience * weights.experience +
        breakdown.completeness * weights.completeness +
        breakdown.trust * weights.trust +
        breakdown.acceptance * weights.acceptance +
        breakdown.price * weights.price;

      return { score: weighted / total, breakdown };
    },
  };
}

/**
 * Where a price sits within the result set, 0 = cheapest.
 *
 * Relative rather than absolute because "expensive" only means anything next to
 * the other quotes on screen. Providers without a listed price get null and fall
 * back to the neutral default.
 */
export function priceBandPositions(prices: (number | null)[]): (number | null)[] {
  const known = prices.filter((price): price is number => price !== null);

  if (known.length === 0) return prices.map(() => null);

  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min;

  return prices.map((price) => {
    if (price === null) return null;
    // Every price identical — nobody is cheaper, so nobody gains.
    return span === 0 ? 0 : (price - min) / span;
  });
}
