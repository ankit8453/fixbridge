import { describe, expect, it } from 'vitest';
import {
  COMPLETENESS_ITEMS,
  COMPLETENESS_WEIGHTS,
  computeCompleteness,
  isListable,
  type CompletenessFacts,
  type CompletenessItem,
} from './completeness';

const COMPLETE: CompletenessFacts = {
  hasDisplayName: true,
  hasBaseLocation: true,
  hasSkill: true,
  hasActivePriceCard: true,
  hasActiveAvailability: true,
  hasYearsExperience: true,
  hasPhotoDocument: true,
};

const EMPTY: CompletenessFacts = {
  hasDisplayName: false,
  hasBaseLocation: false,
  hasSkill: false,
  hasActivePriceCard: false,
  hasActiveAvailability: false,
  hasYearsExperience: false,
  hasPhotoDocument: false,
};

/** Which fact backs which checklist item. */
const FACT_FOR: Record<CompletenessItem, keyof CompletenessFacts> = {
  displayName: 'hasDisplayName',
  baseLocation: 'hasBaseLocation',
  skills: 'hasSkill',
  priceCard: 'hasActivePriceCard',
  availability: 'hasActiveAvailability',
  yearsExperience: 'hasYearsExperience',
  photoDocument: 'hasPhotoDocument',
};

const DEFAULT_THRESHOLD = 80;

/** The items that make a technician bookable at all. */
const BOOKING_CRITICAL: CompletenessItem[] = [
  'baseLocation',
  'skills',
  'priceCard',
  'availability',
];

describe('weights', () => {
  it('sum to exactly 100', () => {
    const total = COMPLETENESS_ITEMS.reduce((sum, item) => sum + COMPLETENESS_WEIGHTS[item], 0);
    expect(total).toBe(100);
  });

  it('cover every item exactly once', () => {
    expect(Object.keys(COMPLETENESS_WEIGHTS).sort()).toEqual([...COMPLETENESS_ITEMS].sort());
  });

  it('are all positive', () => {
    for (const item of COMPLETENESS_ITEMS) {
      expect(COMPLETENESS_WEIGHTS[item]).toBeGreaterThan(0);
    }
  });
});

describe('computeCompleteness', () => {
  it('scores a fully filled profile at 100 with nothing missing', () => {
    const result = computeCompleteness(COMPLETE);

    expect(result.score).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it('scores an empty profile at 0 with everything missing', () => {
    const result = computeCompleteness(EMPTY);

    expect(result.score).toBe(0);
    expect(result.missing).toHaveLength(COMPLETENESS_ITEMS.length);
  });

  it('deducts exactly the item weight for each missing item', () => {
    for (const item of COMPLETENESS_ITEMS) {
      const result = computeCompleteness({ ...COMPLETE, [FACT_FOR[item]]: false });

      expect(result.score).toBe(100 - COMPLETENESS_WEIGHTS[item]);
      expect(result.missing).toEqual([item]);
    }
  });

  it('lists missing items heaviest first, so the checklist leads with what matters', () => {
    const result = computeCompleteness(EMPTY);
    const weights = result.missing.map((item) => COMPLETENESS_WEIGHTS[item]);

    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it('returns a breakdown covering every item with its satisfaction state', () => {
    const result = computeCompleteness({ ...COMPLETE, hasSkill: false });

    expect(result.breakdown).toHaveLength(COMPLETENESS_ITEMS.length);
    expect(result.breakdown.find((entry) => entry.item === 'skills')?.satisfied).toBe(false);
    expect(result.breakdown.find((entry) => entry.item === 'baseLocation')?.satisfied).toBe(true);
  });

  it('never scores outside 0–100', () => {
    for (const facts of [COMPLETE, EMPTY, { ...COMPLETE, hasPhotoDocument: false }]) {
      const { score } = computeCompleteness(facts);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

/**
 * The whole point of the weighting: each booking-critical item must be heavy
 * enough that losing it alone delists the profile. If someone rebalances the
 * weights, this is the test that should stop them.
 */
describe('gating at the default threshold', () => {
  it('delists a profile missing any single booking-critical item', () => {
    for (const item of BOOKING_CRITICAL) {
      const { score } = computeCompleteness({ ...COMPLETE, [FACT_FOR[item]]: false });

      expect(score, `missing ${item} should drop below the threshold`).toBeLessThan(
        DEFAULT_THRESHOLD,
      );
      expect(isListable(score, DEFAULT_THRESHOLD, true)).toBe(false);
    }
  });

  it('keeps a profile listed when only the soft quality items are missing', () => {
    const { score } = computeCompleteness({
      ...COMPLETE,
      hasYearsExperience: false,
      hasPhotoDocument: false,
    });

    expect(isListable(score, DEFAULT_THRESHOLD, true)).toBe(true);
  });

  it('still lists a profile that is only missing a display name — a known gap', () => {
    // Documented in docs/summaries/phase03-summary.md: displayName is weighted
    // 10, so at threshold 80 it cannot delist on its own. Asserted rather than
    // ignored so the behaviour is deliberate and visible.
    const { score } = computeCompleteness({ ...COMPLETE, hasDisplayName: false });

    expect(score).toBe(90);
    expect(isListable(score, DEFAULT_THRESHOLD, true)).toBe(true);
    expect(isListable(score, 91, true)).toBe(false);
  });
});

describe('isListable', () => {
  it('requires the score to reach the threshold', () => {
    expect(isListable(79, 80, true)).toBe(false);
    expect(isListable(80, 80, true)).toBe(true);
    expect(isListable(100, 80, true)).toBe(true);
  });

  it('refuses to list a blocked technician however complete the profile is', () => {
    expect(isListable(100, 80, false)).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(isListable(90, 95, true)).toBe(false);
    expect(isListable(90, 50, true)).toBe(true);
  });
});
