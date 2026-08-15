import { VERIFICATION_LEVELS, type VerificationLevel } from './state-machine';

/**
 * Trust badges.
 *
 * All three values exist from day one so the enum never needs a migration, but
 * only `VERIFIED` is attainable in Phase 4. `SILVER` and `GOLD` are trust-score
 * bands computed in Phase 9 from ratings and job history — nothing here awards
 * them, and nothing should until that data exists.
 */
export const BADGES = ['NONE', 'VERIFIED', 'SILVER', 'GOLD'] as const;
export type Badge = (typeof BADGES)[number];

/** Ordered weakest to strongest, so `>=` comparisons are possible. */
const BADGE_RANK: Record<Badge, number> = { NONE: 0, VERIFIED: 1, SILVER: 2, GOLD: 3 };

export function badgeAtLeast(badge: Badge, minimum: Badge): boolean {
  return BADGE_RANK[badge] >= BADGE_RANK[minimum];
}

/**
 * A badge is earned by passing **every** level, and lost the moment any one of
 * them stops being passed.
 *
 * Deriving it from the set of passed levels rather than storing it as an
 * independent fact means a re-check that fails cannot leave a stale badge
 * behind: recompute, and the answer changes on its own.
 */
export function computeBadge(passedLevels: readonly number[]): Badge {
  const passed = new Set(passedLevels);
  const allPassed = VERIFICATION_LEVELS.every((level) => passed.has(level));

  return allPassed ? 'VERIFIED' : 'NONE';
}

/** Levels still to pass before a badge is earned, in ladder order. */
export function remainingLevels(passedLevels: readonly number[]): VerificationLevel[] {
  const passed = new Set(passedLevels);
  return VERIFICATION_LEVELS.filter((level) => !passed.has(level));
}

/**
 * When `badge_since` should be set to.
 *
 * It marks the moment the badge was *earned*, so it survives recomputation
 * while the badge holds, and clears entirely when it is lost. Losing and
 * re-earning a badge gives a new date — which is the honest answer to "how long
 * have they been verified?".
 */
export function nextBadgeSince(
  previousBadge: Badge,
  nextBadge: Badge,
  previousSince: Date | null,
  now: Date,
): Date | null {
  if (nextBadge === 'NONE') return null;
  if (previousBadge === nextBadge && previousSince) return previousSince;

  return now;
}
