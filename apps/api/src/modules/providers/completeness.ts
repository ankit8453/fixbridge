/**
 * Profile completeness. Pure — no database, no config lookups — so every branch
 * is unit-testable and the Flutter onboarding checklist in Phase 13 can render
 * exactly what the API scored.
 *
 * Two independent mechanisms, deliberately not conflated:
 *
 *   1. **Required items** — a hard gate. Every one must be satisfied before a
 *      profile can be listed, whatever the score says.
 *   2. **Score and threshold** — an adjustable quality bar layered on top.
 *
 * Splitting them lets the weights mean what they say. An earlier version had to
 * distort them (four items at 21 apiece) purely so that losing any one would
 * drag the total under the threshold — which made the score a gating mechanism
 * in disguise and left `displayName` unable to gate at all.
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
 * The hard gate: without any one of these a listing is not viable.
 *
 * No name — nothing to show. No location — nobody can find them. No skill —
 * nobody knows what they do. No price — nobody knows the cost. No availability —
 * nobody can book. Each is individually disqualifying, regardless of score.
 */
export const REQUIRED_ITEMS: readonly CompletenessItem[] = [
  'displayName',
  'baseLocation',
  'skills',
  'priceCard',
  'availability',
];

export function isRequired(item: CompletenessItem): boolean {
  return REQUIRED_ITEMS.includes(item);
}

/**
 * Weights sum to 100 and are now free to express how much work each step
 * actually represents, since gating no longer depends on them. This is a
 * progress bar, not a gate.
 */
export const COMPLETENESS_WEIGHTS: Record<CompletenessItem, number> = {
  baseLocation: 20,
  skills: 20,
  priceCard: 20,
  availability: 20,
  displayName: 10,
  yearsExperience: 5,
  photoDocument: 5,
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
  /** True when this item blocks listing on its own. */
  required: boolean;
  satisfied: boolean;
}

export interface CompletenessResult {
  /** 0–100. Progress, not permission. */
  score: number;
  /** Everything still to do, heaviest first. */
  missing: CompletenessItem[];
  /**
   * The subset of `missing` that is blocking listing. Empty means the hard gate
   * is satisfied — which is what an onboarding screen should count down to.
   */
  missingRequired: CompletenessItem[];
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
    required: isRequired(item),
    satisfied: SATISFIED[item](facts),
  }));

  const score = breakdown.reduce((total, entry) => total + (entry.satisfied ? entry.weight : 0), 0);

  const missing = breakdown
    .filter((entry) => !entry.satisfied)
    .sort((a, b) => b.weight - a.weight || a.item.localeCompare(b.item))
    .map((entry) => entry.item);

  return {
    score,
    missing,
    missingRequired: missing.filter(isRequired),
    breakdown,
  };
}

/**
 * Whether a profile may appear in search.
 *
 * Takes the whole `CompletenessResult` rather than a bare score precisely so a
 * caller cannot check the threshold and forget the hard gate — the two must
 * always be evaluated together.
 *
 * Note the threshold does not bind at its default of 80: satisfying every
 * required item already scores 90. That is intended. The gate is the floor; the
 * threshold is the knob for demanding more later (raise it past 90 to make
 * `photoDocument` and `yearsExperience` effectively mandatory too).
 */
export function isListable(
  result: CompletenessResult,
  threshold: number,
  userIsActive: boolean,
): boolean {
  return userIsActive && result.missingRequired.length === 0 && result.score >= threshold;
}
