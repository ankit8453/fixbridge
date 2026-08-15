import { describe, expect, it } from 'vitest';
import {
  COMPLETENESS_ITEMS,
  COMPLETENESS_WEIGHTS,
  REQUIRED_ITEMS,
  computeCompleteness,
  isListable,
  isRequired,
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

const OPTIONAL_ITEMS: CompletenessItem[] = ['yearsExperience', 'photoDocument'];

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

describe('required items', () => {
  it('are exactly the five that make a listing viable', () => {
    expect([...REQUIRED_ITEMS].sort()).toEqual([
      'availability',
      'baseLocation',
      'displayName',
      'priceCard',
      'skills',
    ]);
  });

  it('agree with isRequired and with the breakdown', () => {
    const { breakdown } = computeCompleteness(COMPLETE);

    for (const entry of breakdown) {
      expect(entry.required).toBe(isRequired(entry.item));
    }
  });

  it('leave the quality items optional', () => {
    for (const item of OPTIONAL_ITEMS) {
      expect(isRequired(item)).toBe(false);
    }
  });

  it('reports missingRequired as the blocking subset of missing', () => {
    const result = computeCompleteness(EMPTY);

    expect(result.missingRequired).toHaveLength(REQUIRED_ITEMS.length);
    expect(result.missing).toEqual(expect.arrayContaining(result.missingRequired));
    expect(result.missingRequired).not.toContain('photoDocument');
  });

  it('is empty once every required item is satisfied', () => {
    const result = computeCompleteness({
      ...EMPTY,
      hasDisplayName: true,
      hasBaseLocation: true,
      hasSkill: true,
      hasActivePriceCard: true,
      hasActiveAvailability: true,
    });

    expect(result.missingRequired).toEqual([]);
    expect(result.missing).toEqual(expect.arrayContaining(OPTIONAL_ITEMS));
  });
});

/**
 * The hard gate is the point of this design: any single required item, missing,
 * delists the profile — regardless of what the score says. If someone rebalances
 * the weights, this is the test that should stop them breaking listing.
 */
describe('isListable — the hard gate', () => {
  it('delists a profile missing any single required item', () => {
    for (const item of REQUIRED_ITEMS) {
      const result = computeCompleteness({ ...COMPLETE, [FACT_FOR[item]]: false });

      expect(isListable(result, DEFAULT_THRESHOLD, true), `missing ${item} must delist`).toBe(
        false,
      );
    }
  });

  it('delists a nameless technician even though the score clears the threshold', () => {
    // The case that motivated the hard gate: 90 ≥ 80, yet there is no name to
    // show in search, so the score must not be allowed to decide on its own.
    const result = computeCompleteness({ ...COMPLETE, hasDisplayName: false });

    expect(result.score).toBe(90);
    expect(result.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    expect(result.missingRequired).toEqual(['displayName']);
    expect(isListable(result, DEFAULT_THRESHOLD, true)).toBe(false);
  });

  it('lists a profile that has every required item but neither optional one', () => {
    const result = computeCompleteness({
      ...COMPLETE,
      hasYearsExperience: false,
      hasPhotoDocument: false,
    });

    expect(result.score).toBe(90);
    expect(isListable(result, DEFAULT_THRESHOLD, true)).toBe(true);
  });

  it('lists a fully complete profile', () => {
    expect(isListable(computeCompleteness(COMPLETE), DEFAULT_THRESHOLD, true)).toBe(true);
  });

  it('refuses to list a blocked technician however complete the profile is', () => {
    expect(isListable(computeCompleteness(COMPLETE), DEFAULT_THRESHOLD, false)).toBe(false);
  });

  it('never lists an empty profile', () => {
    expect(isListable(computeCompleteness(EMPTY), 0, true)).toBe(false);
  });
});

describe('isListable — the threshold on top of the gate', () => {
  it('does not bind at the default, because the gate already implies 90', () => {
    const gateOnly = computeCompleteness({
      ...COMPLETE,
      hasYearsExperience: false,
      hasPhotoDocument: false,
    });

    expect(gateOnly.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    expect(isListable(gateOnly, DEFAULT_THRESHOLD, true)).toBe(true);
  });

  it('can be raised to demand the optional quality items too', () => {
    const gateOnly = computeCompleteness({
      ...COMPLETE,
      hasYearsExperience: false,
      hasPhotoDocument: false,
    });

    // Above 90, the optional items stop being optional in practice.
    expect(isListable(gateOnly, 95, true)).toBe(false);
    expect(isListable(computeCompleteness(COMPLETE), 95, true)).toBe(true);
  });

  it('cannot be lowered enough to bypass the gate', () => {
    const noAvailability = computeCompleteness({ ...COMPLETE, hasActiveAvailability: false });

    expect(isListable(noAvailability, 0, true)).toBe(false);
  });
});
