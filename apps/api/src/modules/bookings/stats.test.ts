import { describe, expect, it } from 'vitest';
import { MIN_DECIDED_REQUESTS, computeAcceptanceRate } from './stats';
import { createWeightedRankScorer, type RankInput, type RankWeights } from '../search/ranking';

describe('computeAcceptanceRate', () => {
  const counts = (accepted: number, rejected: number, expired: number) => ({
    acceptedCount: accepted,
    rejectedCount: rejected,
    expiredCount: expired,
  });

  it('is accepted over everything decided', () => {
    expect(computeAcceptanceRate(counts(8, 2, 0))).toBe(0.8);
    expect(computeAcceptanceRate(counts(4, 1, 1))).toBeCloseTo(2 / 3, 10);
  });

  /**
   * Silence counts against a technician exactly as much as declining does: from
   * the customer's side, an ignored request and a "no" are the same wasted wait.
   */
  it('counts an expired request as a refusal', () => {
    expect(computeAcceptanceRate(counts(5, 0, 5))).toBe(0.5);
    expect(computeAcceptanceRate(counts(5, 5, 0))).toBe(0.5);
  });

  it('reports nothing below the small-sample floor', () => {
    for (let decided = 0; decided < MIN_DECIDED_REQUESTS; decided += 1) {
      expect(computeAcceptanceRate(counts(0, decided, 0))).toBeNull();
    }

    // One rejection out of two is 50%, and publishing that would bury someone
    // who joined last week under everyone with a longer record.
    expect(computeAcceptanceRate(counts(1, 1, 0))).toBeNull();
  });

  it('starts reporting exactly at the floor', () => {
    expect(computeAcceptanceRate(counts(MIN_DECIDED_REQUESTS, 0, 0))).toBe(1);
  });

  it('reports zero for a technician who decided everything the wrong way', () => {
    // Distinct from null: this one has a record, and it is bad.
    expect(computeAcceptanceRate(counts(0, 6, 0))).toBe(0);
  });
});

describe('acceptance rate in the ranking', () => {
  const weights: RankWeights = {
    distance: 0,
    badge: 0,
    experience: 0,
    completeness: 0,
    trust: 0,
    // Isolated, so the assertions are about this signal and nothing else.
    acceptance: 1,
    price: 0,
    distanceHalfLifeKm: 5,
  };

  const scorer = createWeightedRankScorer(weights);

  const input = (acceptanceRate: number | null): RankInput => ({
    distanceKm: 2,
    providerRadiusKm: 10,
    badge: 'VERIFIED',
    yearsExperience: 5,
    completenessScore: 90,
    trustScore: null,
    acceptanceRate,
    priceBandPosition: null,
  });

  it('ranks a reliable technician above an unreliable one', () => {
    expect(scorer.score(input(0.9)).score).toBeGreaterThan(scorer.score(input(0.3)).score);
  });

  /**
   * The fairness property. A technician with no record must not be ranked as if
   * they had refused everything — otherwise nobody new ever gets a first job.
   */
  it('places an unrated technician at the midpoint, not the bottom', () => {
    const unrated = scorer.score(input(null)).score;

    expect(unrated).toBe(0.5);
    expect(unrated).toBeGreaterThan(scorer.score(input(0)).score);
    expect(unrated).toBeLessThan(scorer.score(input(1)).score);
  });

  it('reports the raw rate in the breakdown', () => {
    expect(scorer.score(input(0.75)).breakdown.acceptance).toBe(0.75);
    expect(scorer.score(input(null)).breakdown.acceptance).toBe(0.5);
  });
});
