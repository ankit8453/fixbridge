import { describe, expect, it } from 'vitest';
import { BADGES, badgeAtLeast, computeBadge, nextBadgeSince, remainingLevels } from './badge';

describe('badge enum', () => {
  it('defines all four bands now, so Phase 9 needs no migration', () => {
    expect(BADGES).toEqual(['NONE', 'VERIFIED', 'SILVER', 'GOLD']);
  });

  it('orders bands so search can ask for "at least VERIFIED"', () => {
    expect(badgeAtLeast('VERIFIED', 'VERIFIED')).toBe(true);
    expect(badgeAtLeast('GOLD', 'VERIFIED')).toBe(true);
    expect(badgeAtLeast('SILVER', 'VERIFIED')).toBe(true);
    expect(badgeAtLeast('NONE', 'VERIFIED')).toBe(false);
  });
});

describe('computeBadge', () => {
  it('awards VERIFIED only when every level has passed', () => {
    expect(computeBadge([0, 1, 2])).toBe('VERIFIED');
  });

  it('does not care about order or duplicates', () => {
    expect(computeBadge([1, 0, 2])).toBe('VERIFIED');
    expect(computeBadge([0, 0, 1, 2])).toBe('VERIFIED');
  });

  /**
   * Technicians verified under the old four-level ladder keep their badge.
   *
   * Their stored set is [0,1,2,3], and 3 is now a level nobody is asked for.
   * Because the badge is derived by checking every *current* level is present
   * rather than by comparing sets, the extra entry is simply ignored — the
   * recompute that runs on their next event does not quietly strip a badge
   * they earned.
   */
  it('keeps the badge for anyone verified under the old references ladder', () => {
    expect(computeBadge([0, 1, 2, 3])).toBe('VERIFIED');
  });

  it('withholds the badge while any level is outstanding', () => {
    expect(computeBadge([])).toBe('NONE');
    expect(computeBadge([0])).toBe('NONE');
    expect(computeBadge([0, 1])).toBe('NONE');
    // Level 3 alone is not a substitute for the skill check.
    expect(computeBadge([1, 3])).toBe('NONE');
  });

  it('never awards SILVER or GOLD — those are Phase 9 trust bands', () => {
    expect(computeBadge([0, 1, 2])).not.toBe('SILVER');
    expect(computeBadge([0, 1, 2])).not.toBe('GOLD');
  });

  /**
   * The downgrade path. Because the badge is derived from the levels currently
   * passed rather than accumulated, a failed re-check removes it with no
   * separate "revoke" step that could be forgotten.
   */
  it('drops to NONE when a previously passed level stops being passed', () => {
    expect(computeBadge([0, 1, 2, 3])).toBe('VERIFIED');
    expect(computeBadge([0, 2, 3])).toBe('NONE');
  });
});

describe('remainingLevels', () => {
  it('lists what is left, in ladder order', () => {
    expect(remainingLevels([])).toEqual([0, 1, 2]);
    expect(remainingLevels([0, 2])).toEqual([1]);
    expect(remainingLevels([1, 0, 2])).toEqual([]);
    // A stale level 3 from the old ladder leaves nothing outstanding either.
    expect(remainingLevels([3, 1, 0, 2])).toEqual([]);
  });
});

describe('nextBadgeSince', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');
  const earlier = new Date('2026-07-01T09:00:00.000Z');

  it('stamps the moment a badge is first earned', () => {
    expect(nextBadgeSince('NONE', 'VERIFIED', null, now)).toEqual(now);
  });

  it('keeps the original date while the badge holds', () => {
    // Recomputation happens on every pass/fail, and must not keep resetting this.
    expect(nextBadgeSince('VERIFIED', 'VERIFIED', earlier, now)).toEqual(earlier);
  });

  it('clears the date when the badge is lost', () => {
    expect(nextBadgeSince('VERIFIED', 'NONE', earlier, now)).toBeNull();
  });

  it('re-earning after a loss gives a new date, not the old one', () => {
    const afterLoss = nextBadgeSince('VERIFIED', 'NONE', earlier, now);
    expect(afterLoss).toBeNull();
    expect(nextBadgeSince('NONE', 'VERIFIED', afterLoss, now)).toEqual(now);
  });

  it('stamps a date if one is somehow missing while the badge holds', () => {
    expect(nextBadgeSince('VERIFIED', 'VERIFIED', null, now)).toEqual(now);
  });
});
