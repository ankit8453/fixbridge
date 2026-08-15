import { describe, expect, it } from 'vitest';
import {
  EXPERIENCE_SATURATION_YEARS,
  NEUTRAL_DEFAULTS,
  createWeightedRankScorer,
  distanceScore,
  experienceScore,
  priceBandPositions,
  type RankInput,
  type RankWeights,
} from './ranking';

const WEIGHTS: RankWeights = {
  distance: 50,
  badge: 15,
  experience: 10,
  completeness: 5,
  trust: 10,
  acceptance: 5,
  price: 5,
  distanceHalfLifeKm: 5,
};

const base: RankInput = {
  distanceKm: 5,
  providerRadiusKm: 10,
  badge: 'VERIFIED',
  yearsExperience: 10,
  completenessScore: 100,
  trustScore: null,
  acceptanceRate: null,
  priceBandPosition: null,
};

const scoreOf = (input: Partial<RankInput>, weights: RankWeights = WEIGHTS): number =>
  createWeightedRankScorer(weights).score({ ...base, ...input }).score;

describe('distanceScore', () => {
  it('is 1 at the door', () => {
    expect(distanceScore(0, 5)).toBe(1);
    expect(distanceScore(-1, 5)).toBe(1);
  });

  it('halves at the half-life', () => {
    expect(distanceScore(5, 5)).toBeCloseTo(0.5, 10);
    expect(distanceScore(10, 5)).toBeCloseTo(0.25, 10);
    expect(distanceScore(15, 5)).toBeCloseTo(0.125, 10);
  });

  it('decays monotonically and never reaches zero', () => {
    let previous = 1;
    for (const km of [1, 2, 5, 10, 25, 100]) {
      const value = distanceScore(km, 5);
      expect(value).toBeLessThan(previous);
      expect(value).toBeGreaterThan(0);
      previous = value;
    }
  });

  it('a shorter half-life punishes distance harder', () => {
    expect(distanceScore(10, 2)).toBeLessThan(distanceScore(10, 10));
  });

  it('survives a non-finite input', () => {
    expect(distanceScore(Number.NaN, 5)).toBe(1);
  });
});

describe('experienceScore', () => {
  it('rises to saturation and then flattens', () => {
    expect(experienceScore(0)).toBe(0);
    expect(experienceScore(EXPERIENCE_SATURATION_YEARS / 2)).toBeCloseTo(0.5, 10);
    expect(experienceScore(EXPERIENCE_SATURATION_YEARS)).toBe(1);
    expect(experienceScore(40)).toBe(1);
  });

  it('treats unknown experience as none, not as average', () => {
    expect(experienceScore(null)).toBe(0);
  });
});

describe('priceBandPositions', () => {
  it('puts the cheapest at 0 and the dearest at 1', () => {
    expect(priceBandPositions([10000, 20000, 30000])).toEqual([0, 0.5, 1]);
  });

  it('gives everyone 0 when all prices match — nobody is cheaper', () => {
    expect(priceBandPositions([20000, 20000])).toEqual([0, 0]);
  });

  it('passes through providers who quote nothing', () => {
    expect(priceBandPositions([10000, null, 30000])).toEqual([0, null, 1]);
  });

  it('returns all nulls when nobody quotes', () => {
    expect(priceBandPositions([null, null])).toEqual([null, null]);
  });
});

describe('the weighted scorer', () => {
  it('scores within 0..1', () => {
    for (const distanceKm of [0, 1, 5, 25]) {
      const score = scoreOf({ distanceKm });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(scoreOf({})).toBe(scoreOf({}));
  });

  it('ranks the closer provider first, all else equal', () => {
    expect(scoreOf({ distanceKm: 1 })).toBeGreaterThan(scoreOf({ distanceKm: 8 }));
  });

  it('ranks VERIFIED above an unverified provider, all else equal', () => {
    // NONE is unreachable through search, but the scorer must still order it.
    expect(scoreOf({ badge: 'VERIFIED' })).toBeGreaterThan(scoreOf({ badge: 'NONE' }));
  });

  it('orders the Phase 9 badge bands correctly, ready for when they exist', () => {
    expect(scoreOf({ badge: 'GOLD' })).toBeGreaterThan(scoreOf({ badge: 'SILVER' }));
    expect(scoreOf({ badge: 'SILVER' })).toBeGreaterThan(scoreOf({ badge: 'VERIFIED' }));
  });

  it('prefers more experience and a more complete profile', () => {
    expect(scoreOf({ yearsExperience: 15 })).toBeGreaterThan(scoreOf({ yearsExperience: 2 }));
    expect(scoreOf({ completenessScore: 100 })).toBeGreaterThan(scoreOf({ completenessScore: 60 }));
  });

  it('prefers the cheaper provider — price position is inverted', () => {
    expect(scoreOf({ priceBandPosition: 0 })).toBeGreaterThan(scoreOf({ priceBandPosition: 1 }));
  });

  /** Hand-computed, so a silent change to the formula fails here. */
  it('matches a hand-computed score', () => {
    const score = createWeightedRankScorer(WEIGHTS).score({
      distanceKm: 5, // half-life 5 → 0.5
      providerRadiusKm: 10,
      badge: 'VERIFIED', // → 0.7
      yearsExperience: 15, // → 1
      completenessScore: 100, // → 1
      trustScore: null, // → 0.5
      acceptanceRate: null, // → 0.5
      priceBandPosition: 0, // → 1 - 0 = 1
    }).score;

    // (0.5*50 + 0.7*15 + 1*10 + 1*5 + 0.5*10 + 0.5*5 + 1*5) / 100
    const expected = (25 + 10.5 + 10 + 5 + 5 + 2.5 + 5) / 100;
    expect(score).toBeCloseTo(expected, 10);
  });

  it('reports a breakdown that matches the components', () => {
    const result = createWeightedRankScorer(WEIGHTS).score({ ...base, distanceKm: 5 });

    expect(result.breakdown.distance).toBeCloseTo(0.5, 10);
    expect(result.breakdown.badge).toBeCloseTo(0.7, 10);
    expect(result.breakdown.completeness).toBe(1);
  });
});

/**
 * The requirement that reordering results must need only a config change. If
 * these fail, something outside config is deciding the order.
 */
describe('weights are the only lever', () => {
  it('a distance-only config ranks purely by distance', () => {
    const distanceOnly: RankWeights = {
      ...WEIGHTS,
      badge: 0,
      experience: 0,
      completeness: 0,
      trust: 0,
      acceptance: 0,
      price: 0,
    };

    // A far, highly experienced provider loses to a near novice.
    const near = scoreOf({ distanceKm: 1, yearsExperience: 0, badge: 'VERIFIED' }, distanceOnly);
    const far = scoreOf({ distanceKm: 12, yearsExperience: 40, badge: 'GOLD' }, distanceOnly);

    expect(near).toBeGreaterThan(far);
  });

  it('a price-only config reverses a distance-driven ordering', () => {
    const nearExpensive = { distanceKm: 1, priceBandPosition: 1 };
    const farCheap = { distanceKm: 10, priceBandPosition: 0 };

    // Default weights: distance dominates.
    expect(scoreOf(nearExpensive)).toBeGreaterThan(scoreOf(farCheap));

    const priceOnly: RankWeights = {
      ...WEIGHTS,
      distance: 0,
      badge: 0,
      experience: 0,
      completeness: 0,
      trust: 0,
      acceptance: 0,
      price: 50,
    };

    // Price-only weights: the ordering flips, with no code change.
    expect(scoreOf(farCheap, priceOnly)).toBeGreaterThan(scoreOf(nearExpensive, priceOnly));
  });

  it('raising the badge weight promotes a farther but better-badged provider', () => {
    const nearVerified = { distanceKm: 4, badge: 'VERIFIED' as const };
    const farGold = { distanceKm: 7, badge: 'GOLD' as const };

    expect(scoreOf(nearVerified)).toBeGreaterThan(scoreOf(farGold));

    const badgeHeavy: RankWeights = { ...WEIGHTS, distance: 10, badge: 80 };
    expect(scoreOf(farGold, badgeHeavy)).toBeGreaterThan(scoreOf(nearVerified, badgeHeavy));
  });

  it('does not divide by zero when every weight is zero', () => {
    const noOpinion: RankWeights = {
      ...WEIGHTS,
      distance: 0,
      badge: 0,
      experience: 0,
      completeness: 0,
      trust: 0,
      acceptance: 0,
      price: 0,
    };

    expect(scoreOf({}, noOpinion)).toBe(0);
    expect(Number.isNaN(scoreOf({}, noOpinion))).toBe(false);
  });
});

/**
 * Phase 6 and Phase 9 will start supplying real values for *some* providers. The
 * neutral midpoint means that transition does not reshuffle everyone who still
 * has no data.
 */
describe('neutral defaults for signals that do not exist yet', () => {
  it('are the midpoint, so a missing signal neither helps nor hurts', () => {
    expect(NEUTRAL_DEFAULTS.trustScore).toBe(0.5);
    expect(NEUTRAL_DEFAULTS.acceptanceRate).toBe(0.5);
    expect(NEUTRAL_DEFAULTS.priceBandPosition).toBe(0.5);
  });

  it('score the same as explicitly supplying the neutral value', () => {
    expect(scoreOf({ trustScore: null })).toBe(scoreOf({ trustScore: 0.5 }));
    expect(scoreOf({ acceptanceRate: null })).toBe(scoreOf({ acceptanceRate: 0.5 }));
  });

  it('leave ordering by distance untouched while every provider is neutral', () => {
    const providers = [3, 1, 8, 2].map((distanceKm) => ({
      distanceKm,
      score: scoreOf({ distanceKm }),
    }));

    const byScore = [...providers].sort((a, b) => b.score - a.score).map((p) => p.distanceKm);
    expect(byScore).toEqual([1, 2, 3, 8]);
  });

  it('a provider with real trust data outranks an identical neutral one', () => {
    expect(scoreOf({ trustScore: 0.95 })).toBeGreaterThan(scoreOf({ trustScore: null }));
    expect(scoreOf({ trustScore: 0.1 })).toBeLessThan(scoreOf({ trustScore: null }));
  });
});
