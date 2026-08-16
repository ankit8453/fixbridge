import { describe, expect, it } from 'vitest';
import {
  COMPLAINT_SEVERITY_WEIGHT,
  computeBadgeBand,
  computeTrustScore,
  decayFactor,
  decayedAverageStars,
  evaluateSuspension,
  type BadgeBandThresholds,
  type SuspensionRules,
  type TrustInputs,
  type TrustWeights,
} from './score';

/**
 * Every expected number below was worked out on paper first.
 *
 * This function decides whether somebody keeps getting work, so "the code says
 * 62" is not evidence that 62 is right. Each fixture states the arithmetic in a
 * comment and asserts the answer.
 */

const NOW = new Date('2026-08-16T00:00:00.000Z');

const WEIGHTS: TrustWeights = {
  rating: 35,
  acceptance: 20,
  reliability: 20,
  complaints: 15,
  recency: 10,
  ratingHalfLifeDays: 90,
  recencyHalfLifeDays: 90,
  complaintZeroAt: 6,
};

const THRESHOLDS: BadgeBandThresholds = {
  silverScore: 70,
  silverJobs: 10,
  goldScore: 85,
  goldJobs: 30,
};

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const inputs = (overrides: Partial<TrustInputs> = {}): TrustInputs => ({
  ratings: [],
  acceptanceRate: null,
  settledJobs: 0,
  providerCancellations: 0,
  complaints: { minor: 0, major: 0, severe: 0 },
  lastSettledAt: null,
  ...overrides,
});

const component = (result: ReturnType<typeof computeTrustScore>, name: string) =>
  result.components.find((entry) => entry.name === name);

/* -------------------------------------------------------------------------- */
/* Decay                                                                      */
/* -------------------------------------------------------------------------- */

describe('decayFactor', () => {
  it('halves at the half-life', () => {
    expect(decayFactor(0, 90)).toBe(1);
    expect(decayFactor(90, 90)).toBeCloseTo(0.5, 10);
    expect(decayFactor(180, 90)).toBeCloseTo(0.25, 10);
    expect(decayFactor(270, 90)).toBeCloseTo(0.125, 10);
  });

  it('treats the future and today the same', () => {
    // A review dated slightly ahead of the clock is a clock skew, not a bonus.
    expect(decayFactor(-5, 90)).toBe(1);
  });

  it('does not divide by zero on a zero half-life', () => {
    expect(decayFactor(30, 0)).toBe(1);
  });
});

describe('decayedAverageStars', () => {
  it('is the plain mean when everything is from today', () => {
    const result = decayedAverageStars(
      [
        { stars: 5, createdAt: NOW },
        { stars: 3, createdAt: NOW },
      ],
      NOW,
      90,
    );

    expect(result.average).toBe(4);
  });

  /**
   * The point of the whole decay idea: a technician who was excellent last year
   * and mediocre this month reads as mediocre, because that is what a customer
   * booking them today will get.
   */
  it('lets a recent bad review outweigh an old good one', () => {
    const result = decayedAverageStars(
      [
        // 5 stars, 270 days old → weight 0.125
        { stars: 5, createdAt: daysAgo(270) },
        // 2 stars, today → weight 1
        { stars: 2, createdAt: NOW },
      ],
      NOW,
      90,
    );

    // (5×0.125 + 2×1) / 1.125 = 2.625 / 1.125 = 2.333…
    expect(result.average).toBeCloseTo(2.3333, 3);
    // A plain mean would have said 3.5.
    expect(result.average as number).toBeLessThan(3.5);
  });

  it('returns null when there are no ratings', () => {
    expect(decayedAverageStars([], NOW, 90).average).toBeNull();
  });

  it('returns null when every rating has decayed to nothing', () => {
    // Twenty half-lives is a weight of about one in a million.
    const ancient = decayedAverageStars([{ stars: 5, createdAt: daysAgo(90 * 60) }], NOW, 90);

    expect(ancient.average).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The score                                                                  */
/* -------------------------------------------------------------------------- */

describe('computeTrustScore — null until there is data', () => {
  it('scores a brand-new technician null, not zero', () => {
    // Zero would say "we measured them and they are untrustworthy", which is a
    // lie about somebody who started on Tuesday.
    const result = computeTrustScore(inputs(), WEIGHTS, NOW);

    expect(result.score).toBeNull();
    expect(result.appliedWeight).toBe(0);
  });

  it('does not let a clean complaint record alone produce a score', () => {
    // The complaints component is always present. If it counted on its own,
    // every technician who had never worked would score 100.
    const result = computeTrustScore(inputs(), WEIGHTS, NOW);

    expect(component(result, 'complaints')?.normalized).toBe(1);
    expect(result.score).toBeNull();
  });

  it('starts scoring as soon as there is one real signal', () => {
    expect(computeTrustScore(inputs({ acceptanceRate: 0.8 }), WEIGHTS, NOW).score).not.toBeNull();
    expect(
      computeTrustScore(inputs({ ratings: [{ stars: 4, createdAt: NOW }] }), WEIGHTS, NOW).score,
    ).not.toBeNull();
    expect(computeTrustScore(inputs({ settledJobs: 1 }), WEIGHTS, NOW).score).not.toBeNull();
  });
});

describe('computeTrustScore — hand-computed fixtures', () => {
  /**
   * A flawless technician.
   *
   *   rating       5 stars → (5−1)/4 = 1.0  × 35 = 35
   *   acceptance   1.0                      × 20 = 20
   *   reliability  10/10 = 1.0              × 20 = 20
   *   complaints   none → 1.0               × 15 = 15
   *   recency      today → 1.0              × 10 = 10
   *   ────────────────────────────────────────────────
   *   100 / 100 → 100
   */
  it('gives a perfect record 100', () => {
    const result = computeTrustScore(
      inputs({
        ratings: [{ stars: 5, createdAt: NOW }],
        acceptanceRate: 1,
        settledJobs: 10,
        lastSettledAt: NOW,
      }),
      WEIGHTS,
      NOW,
    );

    expect(result.score).toBe(100);
    expect(result.appliedWeight).toBe(100);
  });

  /**
   * A middling one, every component present.
   *
   *   rating       3 stars → (3−1)/4 = 0.5  × 35 = 17.5
   *   acceptance   0.5                      × 20 = 10
   *   reliability  6 done / (6+2) = 0.75    × 20 = 15
   *   complaints   1 minor → 1 − 1/6 = 0.8333 × 15 = 12.5
   *   recency      90 days → 0.5            × 10 = 5
   *   ────────────────────────────────────────────────
   *   60 / 100 → 60
   */
  it('scores a middling record at 60', () => {
    const result = computeTrustScore(
      inputs({
        ratings: [{ stars: 3, createdAt: NOW }],
        acceptanceRate: 0.5,
        settledJobs: 6,
        providerCancellations: 2,
        complaints: { minor: 1, major: 0, severe: 0 },
        lastSettledAt: daysAgo(90),
      }),
      WEIGHTS,
      NOW,
    );

    expect(result.score).toBe(60);
    expect(component(result, 'rating')?.contribution).toBeCloseTo(17.5, 5);
    expect(component(result, 'reliability')?.contribution).toBeCloseTo(15, 5);
    expect(component(result, 'complaints')?.contribution).toBeCloseTo(12.5, 5);
    expect(component(result, 'recency')?.contribution).toBeCloseTo(5, 5);
  });

  /**
   * A missing component is left out of both halves of the fraction.
   *
   * With no ratings at all:
   *   acceptance   1.0   × 20 = 20
   *   reliability  1.0   × 20 = 20
   *   complaints   1.0   × 15 = 15
   *   recency      1.0   × 10 = 10
   *   ────────────────────────────
   *   65 / 65 → 100, not 65/100 → 65
   *
   * Rescaling by the applied weight is what stops a technician being punished
   * for a component that cannot exist yet.
   */
  it('rescales by the weights that actually applied', () => {
    const result = computeTrustScore(
      inputs({ acceptanceRate: 1, settledJobs: 5, lastSettledAt: NOW }),
      WEIGHTS,
      NOW,
    );

    expect(result.appliedWeight).toBe(65);
    expect(result.score).toBe(100);
    expect(component(result, 'rating')?.normalized).toBeNull();
    expect(component(result, 'rating')?.contribution).toBe(0);
  });

  it('maps one star to zero and five to one', () => {
    const one = computeTrustScore(
      inputs({ ratings: [{ stars: 1, createdAt: NOW }] }),
      WEIGHTS,
      NOW,
    );
    const five = computeTrustScore(
      inputs({ ratings: [{ stars: 5, createdAt: NOW }] }),
      WEIGHTS,
      NOW,
    );

    expect(component(one, 'rating')?.normalized).toBe(0);
    expect(component(five, 'rating')?.normalized).toBe(1);
  });
});

describe('computeTrustScore — complaints', () => {
  it('wipes the component out on a single severe complaint', () => {
    // severe = 6, and the component reaches zero at 6. One is enough — a
    // technician who was unsafe or took money should not be able to average it
    // away behind a hundred good jobs.
    const result = computeTrustScore(
      inputs({ acceptanceRate: 1, complaints: { minor: 0, major: 0, severe: 1 } }),
      WEIGHTS,
      NOW,
    );

    expect(component(result, 'complaints')?.normalized).toBe(0);
  });

  it('weighs severity steeply rather than counting incidents', () => {
    expect(COMPLAINT_SEVERITY_WEIGHT).toEqual({ minor: 1, major: 3, severe: 6 });

    const fiveMinor = computeTrustScore(
      inputs({ acceptanceRate: 1, complaints: { minor: 5, major: 0, severe: 0 } }),
      WEIGHTS,
      NOW,
    );
    const oneSevere = computeTrustScore(
      inputs({ acceptanceRate: 1, complaints: { minor: 0, major: 0, severe: 1 } }),
      WEIGHTS,
      NOW,
    );

    // Five small failures hurt less than one serious one, which is the point.
    expect(component(fiveMinor, 'complaints')?.normalized).toBeGreaterThan(
      component(oneSevere, 'complaints')?.normalized as number,
    );
  });

  it('never goes below zero however many complaints there are', () => {
    const result = computeTrustScore(
      inputs({ acceptanceRate: 1, complaints: { minor: 50, major: 50, severe: 50 } }),
      WEIGHTS,
      NOW,
    );

    expect(component(result, 'complaints')?.normalized).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('computeTrustScore — reliability', () => {
  it('counts only work they took on', () => {
    // Rejections belong to the acceptance component. Counting them here as well
    // would punish the same behaviour twice.
    const result = computeTrustScore(
      inputs({ settledJobs: 9, providerCancellations: 1, acceptanceRate: 0.2 }),
      WEIGHTS,
      NOW,
    );

    expect(component(result, 'reliability')?.normalized).toBeCloseTo(0.9, 10);
  });

  it('is absent, not zero, when they have accepted nothing yet', () => {
    const result = computeTrustScore(inputs({ acceptanceRate: 0.8 }), WEIGHTS, NOW);

    expect(component(result, 'reliability')?.normalized).toBeNull();
  });
});

describe('computeTrustScore — weights are config', () => {
  /**
   * Done criterion: tuning must need **zero code change**.
   */
  it('reorders two technicians when the weights change, with no code change', () => {
    const goodRatingPoorAcceptance = inputs({
      ratings: [{ stars: 5, createdAt: NOW }],
      acceptanceRate: 0.2,
      settledJobs: 5,
      lastSettledAt: NOW,
    });

    const poorRatingGoodAcceptance = inputs({
      ratings: [{ stars: 2, createdAt: NOW }],
      acceptanceRate: 1,
      settledJobs: 5,
      lastSettledAt: NOW,
    });

    const ratingHeavy: TrustWeights = { ...WEIGHTS, rating: 80, acceptance: 5 };
    const acceptanceHeavy: TrustWeights = { ...WEIGHTS, rating: 5, acceptance: 80 };

    expect(computeTrustScore(goodRatingPoorAcceptance, ratingHeavy, NOW).score).toBeGreaterThan(
      computeTrustScore(poorRatingGoodAcceptance, ratingHeavy, NOW).score as number,
    );

    // Same data, different config, opposite order.
    expect(computeTrustScore(goodRatingPoorAcceptance, acceptanceHeavy, NOW).score).toBeLessThan(
      computeTrustScore(poorRatingGoodAcceptance, acceptanceHeavy, NOW).score as number,
    );
  });

  it('reports every component so a score can be explained', () => {
    const result = computeTrustScore(
      inputs({
        ratings: [{ stars: 4, createdAt: NOW }],
        acceptanceRate: 0.9,
        settledJobs: 3,
        lastSettledAt: NOW,
      }),
      WEIGHTS,
      NOW,
    );

    // Five components, always — including the ones with no data, so the app can
    // show a technician what they have not been measured on yet.
    expect(result.components).toHaveLength(5);

    for (const entry of result.components) {
      expect(entry.weight).toBeGreaterThan(0);
      expect(entry.reasonKey).toMatch(/^trust\.reason\./);
      if (entry.normalized !== null) {
        expect(entry.contribution).toBeCloseTo(entry.normalized * entry.weight, 10);
      }
    }
  });

  it('is pure — the same inputs always give the same answer', () => {
    const data = inputs({
      ratings: [{ stars: 4, createdAt: NOW }],
      acceptanceRate: 0.75,
      settledJobs: 8,
      lastSettledAt: NOW,
    });

    expect(computeTrustScore(data, WEIGHTS, NOW)).toEqual(computeTrustScore(data, WEIGHTS, NOW));
  });

  it('always lands inside 0–100', () => {
    const cases = [
      inputs({
        ratings: [{ stars: 1, createdAt: NOW }],
        acceptanceRate: 0,
        settledJobs: 0,
        providerCancellations: 9,
        complaints: { minor: 9, major: 9, severe: 9 },
        lastSettledAt: daysAgo(3650),
      }),
      inputs({
        ratings: [{ stars: 5, createdAt: NOW }],
        acceptanceRate: 1,
        settledJobs: 99,
        lastSettledAt: NOW,
      }),
    ];

    for (const each of cases) {
      const score = computeTrustScore(each, WEIGHTS, NOW).score as number;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Badge bands                                                                */
/* -------------------------------------------------------------------------- */

describe('computeBadgeBand', () => {
  it('gives an unverified technician nothing, however good their score', () => {
    // The badge answers "do we know who this is" before "how do they behave".
    expect(computeBadgeBand('NONE', 100, 500, THRESHOLDS)).toBe('NONE');
  });

  it('holds at VERIFIED until there is a score at all', () => {
    expect(computeBadgeBand('VERIFIED', null, 50, THRESHOLDS)).toBe('VERIFIED');
  });

  it('earns SILVER at exactly the thresholds, and not one short', () => {
    expect(computeBadgeBand('VERIFIED', 70, 10, THRESHOLDS)).toBe('SILVER');
    expect(computeBadgeBand('VERIFIED', 69, 10, THRESHOLDS)).toBe('VERIFIED');
    expect(computeBadgeBand('VERIFIED', 70, 9, THRESHOLDS)).toBe('VERIFIED');
  });

  it('earns GOLD at exactly the thresholds', () => {
    expect(computeBadgeBand('VERIFIED', 85, 30, THRESHOLDS)).toBe('GOLD');
    expect(computeBadgeBand('VERIFIED', 84, 30, THRESHOLDS)).toBe('SILVER');
    // A perfect score on nine jobs is still nine jobs.
    expect(computeBadgeBand('VERIFIED', 100, 9, THRESHOLDS)).toBe('VERIFIED');
  });

  it('downgrades when the score falls', () => {
    expect(computeBadgeBand('GOLD', 60, 40, THRESHOLDS)).toBe('VERIFIED');
    expect(computeBadgeBand('SILVER', 72, 12, THRESHOLDS)).toBe('SILVER');
    // The band is recomputed from scratch every time, so a stale GOLD cannot
    // survive its own data.
    expect(computeBadgeBand('GOLD', 71, 12, THRESHOLDS)).toBe('SILVER');
  });
});

/* -------------------------------------------------------------------------- */
/* Suspension                                                                 */
/* -------------------------------------------------------------------------- */

describe('evaluateSuspension', () => {
  const RULES: SuspensionRules = {
    lowTrustScore: 30,
    lowTrustMinJobs: 10,
    cancellationCount: 3,
    cancellationWindowDays: 7,
    durationDays: 7,
  };

  const suspension = (overrides: Partial<Parameters<typeof evaluateSuspension>[0]> = {}) =>
    evaluateSuspension(
      {
        trustScore: null,
        settledJobs: 0,
        recentCancellations: 0,
        severeComplaints: 0,
        ...overrides,
      },
      RULES,
    );

  it('leaves a new technician alone', () => {
    // Nothing here can fire on somebody with no history — every rule needs
    // either enough jobs or an upheld complaint.
    expect(suspension()).toEqual({ suspend: false, reason: null, reasonKey: null });
  });

  it('suspends on a severe complaint immediately', () => {
    expect(suspension({ severeComplaints: 1 })).toMatchObject({
      suspend: true,
      reason: 'complaint_severe',
    });
  });

  it('suspends at exactly the cancellation threshold', () => {
    expect(suspension({ recentCancellations: 2 }).suspend).toBe(false);
    expect(suspension({ recentCancellations: 3 })).toMatchObject({
      suspend: true,
      reason: 'auto_repeat_cancellation',
    });
  });

  it('suspends on a low score only once there are enough jobs', () => {
    // Two bad jobs is not a pattern; ten is.
    expect(suspension({ trustScore: 20, settledJobs: 9 }).suspend).toBe(false);
    expect(suspension({ trustScore: 20, settledJobs: 10 })).toMatchObject({
      suspend: true,
      reason: 'auto_low_trust',
    });
    expect(suspension({ trustScore: 30, settledJobs: 50 }).suspend).toBe(false);
  });

  it('reports the most serious cause when several apply', () => {
    // A technician with a severe complaint should be told about the complaint,
    // not about their score.
    expect(
      suspension({ severeComplaints: 1, recentCancellations: 5, trustScore: 5, settledJobs: 40 })
        .reason,
    ).toBe('complaint_severe');
  });

  it('gives every suspension a reason a technician can be shown', () => {
    for (const decision of [
      suspension({ severeComplaints: 1 }),
      suspension({ recentCancellations: 3 }),
      suspension({ trustScore: 10, settledJobs: 20 }),
    ]) {
      expect(decision.reasonKey).toMatch(/^trust\.suspension\./);
    }
  });
});
