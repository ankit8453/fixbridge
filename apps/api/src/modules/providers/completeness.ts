/**
 * Profile completeness. Pure — no database, no config lookups — so every branch
 * is unit-testable and the Flutter onboarding checklist in Phase 13 can render
 * exactly what the API scored.
 */

export const COMPLETENESS_ITEMS = [
  'displayName',
  'baseLocation',
  'skills',
  'priceCard',
  'availability',
  'yearsExperience',
  'photoDocument',
] as const;

export type CompletenessItem = (typeof COMPLETENESS_ITEMS)[number];

/**
 * Weights sum to exactly 100.
 *
 * The four heavy items are the ones that make a technician *bookable*: without
 * a location nobody can find them, without a skill nobody knows what they do,
 * without a price card nobody knows the cost, without availability nobody can
 * book. Each is weighted 21 so that missing any single one drops the score to
 * 79 — below the default threshold of 80 — and delists the profile on its own.
 *
 * The remaining three are quality signals that improve a listing without being
 * load-bearing, so they are deliberately too light to delist by themselves.
 */
export const COMPLETENESS_WEIGHTS: Record<CompletenessItem, number> = {
  baseLocation: 21,
  skills: 21,
  priceCard: 21,
  availability: 21,
  displayName: 10,
  yearsExperience: 3,
  photoDocument: 3,
};

/** The facts the score is computed from. Deliberately booleans, not entities. */
export interface CompletenessFacts {
  hasDisplayName: boolean;
  hasBaseLocation: boolean;
  hasSkill: boolean;
  hasActivePriceCard: boolean;
  hasActiveAvailability: boolean;
  hasYearsExperience: boolean;
  hasPhotoDocument: boolean;
}

export interface CompletenessBreakdownEntry {
  item: CompletenessItem;
  weight: number;
  satisfied: boolean;
}

export interface CompletenessResult {
  /** 0–100. */
  score: number;
  /** Items still to do, heaviest first — the order the checklist should show. */
  missing: CompletenessItem[];
  breakdown: CompletenessBreakdownEntry[];
}

const SATISFIED: Record<CompletenessItem, (facts: CompletenessFacts) => boolean> = {
  displayName: (f) => f.hasDisplayName,
  baseLocation: (f) => f.hasBaseLocation,
  skills: (f) => f.hasSkill,
  priceCard: (f) => f.hasActivePriceCard,
  availability: (f) => f.hasActiveAvailability,
  yearsExperience: (f) => f.hasYearsExperience,
  photoDocument: (f) => f.hasPhotoDocument,
};

export function computeCompleteness(facts: CompletenessFacts): CompletenessResult {
  const breakdown: CompletenessBreakdownEntry[] = COMPLETENESS_ITEMS.map((item) => ({
    item,
    weight: COMPLETENESS_WEIGHTS[item],
    satisfied: SATISFIED[item](facts),
  }));

  const score = breakdown.reduce((total, entry) => total + (entry.satisfied ? entry.weight : 0), 0);

  const missing = breakdown
    .filter((entry) => !entry.satisfied)
    .sort((a, b) => b.weight - a.weight || a.item.localeCompare(b.item))
    .map((entry) => entry.item);

  return { score, missing, breakdown };
}

/**
 * A profile is listed when it is complete enough AND the account is in good
 * standing. A blocked technician disappears from search immediately, however
 * complete their profile is.
 */
export function isListable(score: number, threshold: number, userIsActive: boolean): boolean {
  return userIsActive && score >= threshold;
}
