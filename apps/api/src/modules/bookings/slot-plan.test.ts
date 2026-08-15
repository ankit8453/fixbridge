import { describe, expect, it } from 'vitest';
import {
  IST_OFFSET_MINUTES,
  coversWindow,
  istDayOfWeek,
  istDayParts,
  istInstant,
  istMidnightUtc,
  planSlots,
  planSlotsForWindow,
  reconcileSlots,
  slotKey,
  type AvailabilityTemplateLike,
  type ExistingSlotLike,
} from './slot-plan';

const at = (hours: number, minutes = 0): number => hours * 60 + minutes;

const template = (
  overrides: Partial<AvailabilityTemplateLike> & { dayOfWeek: number },
): AvailabilityTemplateLike => ({
  id: `template-${overrides.dayOfWeek}`,
  startMinute: at(9),
  endMinute: at(17),
  isActive: true,
  ...overrides,
});

describe('IST calendar arithmetic', () => {
  it('uses the fixed +05:30 offset', () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
  });

  it('places IST midnight at 18:30 UTC the previous day', () => {
    // 2026-03-10 00:00 IST is 2026-03-09 18:30 UTC.
    expect(istMidnightUtc(2026, 2, 10).toISOString()).toBe('2026-03-09T18:30:00.000Z');
  });

  /**
   * The bug this exists to catch: an instant just after IST midnight belongs to
   * the *next* IST day even though it is still the previous day in UTC. Reading
   * the UTC date directly would silently plan a whole day of slots wrong.
   */
  it('reads the IST day, not the UTC one, either side of midnight', () => {
    const justAfterIstMidnight = new Date('2026-03-09T18:31:00.000Z');
    expect(istDayParts(justAfterIstMidnight)).toEqual({ year: 2026, month: 2, day: 10 });

    const justBefore = new Date('2026-03-09T18:29:00.000Z');
    expect(istDayParts(justBefore)).toEqual({ year: 2026, month: 2, day: 9 });
  });

  it('reads the IST weekday across the same boundary', () => {
    // 2026-03-09 is a Monday IST; 18:31 UTC is already Tuesday there.
    expect(istDayOfWeek(new Date('2026-03-09T18:29:00.000Z'))).toBe(1);
    expect(istDayOfWeek(new Date('2026-03-09T18:31:00.000Z'))).toBe(2);
  });

  it('rolls a day overflow into the next month', () => {
    // Day 32 of March is 1 April — the horizon loop depends on this.
    expect(istMidnightUtc(2026, 2, 32).toISOString()).toBe('2026-03-31T18:30:00.000Z');
  });

  it('combines an IST date and minute-of-day into an instant', () => {
    const instant = istInstant({ year: 2026, month: 2, day: 10 }, at(18, 30));
    expect(instant.toISOString()).toBe('2026-03-10T13:00:00.000Z');
  });

  it('refuses a minute outside a day', () => {
    expect(() => istInstant({ year: 2026, month: 2, day: 10 }, -1)).toThrow(/outside a day/);
    expect(() => istInstant({ year: 2026, month: 2, day: 10 }, 1441)).toThrow(/outside a day/);
  });
});

describe('planSlotsForWindow', () => {
  const dayStart = istMidnightUtc(2026, 2, 10);

  it('chops a window into fixed-length slots', () => {
    const slots = planSlotsForWindow(
      template({ dayOfWeek: 2, startMinute: at(9), endMinute: at(12) }),
      dayStart,
      60,
    );

    expect(slots).toHaveLength(3);
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-03-10T03:30:00.000Z'); // 09:00 IST
    expect(slots[2]?.endsAt.toISOString()).toBe('2026-03-10T06:30:00.000Z'); // 12:00 IST
  });

  /**
   * A 90-minute window yields one slot, not one-and-a-half. Offering a customer
   * half an hour the technician never offered is worse than offering less.
   */
  it('drops the remainder rather than offering a short slot', () => {
    const slots = planSlotsForWindow(
      template({ dayOfWeek: 2, startMinute: at(9), endMinute: at(10, 30) }),
      dayStart,
      60,
    );

    expect(slots).toHaveLength(1);

    const only = slots[0];
    expect(only).toBeDefined();
    expect(only!.endsAt.getTime() - only!.startsAt.getTime()).toBe(60 * 60_000);
  });

  it('produces nothing for a window shorter than the increment', () => {
    expect(
      planSlotsForWindow(
        template({ dayOfWeek: 2, startMinute: at(9), endMinute: at(9, 30) }),
        dayStart,
        60,
      ),
    ).toEqual([]);
  });

  it('produces nothing for an inactive template, a zero increment, or an inverted window', () => {
    expect(planSlotsForWindow(template({ dayOfWeek: 2, isActive: false }), dayStart, 60)).toEqual(
      [],
    );
    expect(planSlotsForWindow(template({ dayOfWeek: 2 }), dayStart, 0)).toEqual([]);
    expect(
      planSlotsForWindow(
        template({ dayOfWeek: 2, startMinute: at(17), endMinute: at(9) }),
        dayStart,
        60,
      ),
    ).toEqual([]);
  });

  it('carries the source template id onto every slot', () => {
    const slots = planSlotsForWindow(template({ dayOfWeek: 2, id: 'tpl-abc' }), dayStart, 120);
    expect(slots.every((slot) => slot.sourceTemplateId === 'tpl-abc')).toBe(true);
  });
});

describe('planSlots', () => {
  // A Tuesday, 10:00 IST.
  const from = new Date('2026-03-10T04:30:00.000Z');

  it('only plans days the templates cover', () => {
    const slots = planSlots([template({ dayOfWeek: 2, startMinute: at(9), endMinute: at(12) })], {
      from,
      horizonDays: 14,
      incrementMinutes: 60,
      // No `notBefore`, so the whole Tuesday window is in scope.
      notBefore: new Date('2026-03-01T00:00:00.000Z'),
    });

    // Two Tuesdays inside a 14-day horizon, three slots each.
    expect(slots).toHaveLength(6);
    expect(new Set(slots.map((slot) => istDayOfWeek(slot.startsAt)))).toEqual(new Set([2]));
  });

  it('skips slots that already started', () => {
    const slots = planSlots([template({ dayOfWeek: 2, startMinute: at(9), endMinute: at(12) })], {
      from,
      horizonDays: 1,
      incrementMinutes: 60,
      notBefore: from,
    });

    // At exactly 10:00 the 09:00 slot is gone. The 10:00 one is kept: the cutoff
    // is strict, so an hour starting this very minute is still bookable.
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2026-03-10T04:30:00.000Z', // 10:00 IST
      '2026-03-10T05:30:00.000Z', // 11:00 IST
    ]);
  });

  it('returns nothing when no template is active', () => {
    expect(
      planSlots([template({ dayOfWeek: 2, isActive: false })], {
        from,
        horizonDays: 14,
        incrementMinutes: 60,
      }),
    ).toEqual([]);
  });

  it('sorts chronologically and is byte-identical on a rerun', () => {
    const options = { from, horizonDays: 7, incrementMinutes: 60, notBefore: from };
    const templates = [
      template({ dayOfWeek: 4, id: 'thu' }),
      template({ dayOfWeek: 2, id: 'tue' }),
      template({ dayOfWeek: 3, id: 'wed' }),
    ];

    const first = planSlots(templates, options);
    const second = planSlots(templates, options);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const times = first.map((slot) => slot.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('interleaves two windows on the same day in time order', () => {
    // A split shift: mornings and evenings, afternoon off.
    const slots = planSlots(
      [
        template({ dayOfWeek: 2, id: 'morning', startMinute: at(8), endMinute: at(10) }),
        template({ dayOfWeek: 2, id: 'evening', startMinute: at(18), endMinute: at(20) }),
      ],
      {
        from,
        horizonDays: 1,
        incrementMinutes: 60,
        notBefore: new Date('2026-03-10T00:00:00.000Z'),
      },
    );

    expect(slots.map((slot) => slot.sourceTemplateId)).toEqual([
      'morning',
      'morning',
      'evening',
      'evening',
    ]);
  });
});

describe('reconcileSlots', () => {
  const startsAt = new Date('2026-03-10T03:30:00.000Z');
  const endsAt = new Date('2026-03-10T04:30:00.000Z');

  const planned = [{ startsAt, endsAt, sourceTemplateId: 'tpl' }];

  const existing = (status: ExistingSlotLike['status'], id = 'slot-1'): ExistingSlotLike => ({
    id,
    startsAt,
    endsAt,
    status,
  });

  it('creates a planned slot that does not exist yet', () => {
    const plan = reconcileSlots(planned, []);

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toDeleteIds).toEqual([]);
    expect(plan.preservedIds).toEqual([]);
  });

  it('leaves an existing open slot alone', () => {
    const plan = reconcileSlots(planned, [existing('open')]);

    expect(plan.toCreate).toEqual([]);
    expect(plan.toDeleteIds).toEqual([]);
  });

  it('deletes an open slot the templates no longer imply', () => {
    const plan = reconcileSlots([], [existing('open')]);

    expect(plan.toDeleteIds).toEqual(['slot-1']);
  });

  /**
   * The rule the whole regeneration story rests on: a technician editing their
   * hours must never cancel a job somebody already booked, and must never
   * silently reopen time they deliberately blocked.
   */
  it.each(['held', 'booked', 'blocked'] as const)('never deletes a %s slot', (status) => {
    const plan = reconcileSlots([], [existing(status)]);

    expect(plan.toDeleteIds).toEqual([]);
    expect(plan.preservedIds).toEqual(['slot-1']);
  });

  it.each(['held', 'booked', 'blocked'] as const)(
    'does not recreate an hour a %s slot already covers',
    (status) => {
      const plan = reconcileSlots(planned, [existing(status)]);

      expect(plan.toCreate).toEqual([]);
      expect(plan.preservedIds).toEqual(['slot-1']);
    },
  );

  it('preserves a booked slot while pruning an open one in the same run', () => {
    const otherStart = new Date('2026-03-10T05:30:00.000Z');
    const otherEnd = new Date('2026-03-10T06:30:00.000Z');

    const plan = reconcileSlots(planned, [
      existing('booked'),
      { id: 'slot-2', startsAt: otherStart, endsAt: otherEnd, status: 'open' },
    ]);

    expect(plan.preservedIds).toEqual(['slot-1']);
    expect(plan.toDeleteIds).toEqual(['slot-2']);
    expect(plan.toCreate).toEqual([]);
  });

  it('keys a slot by its exact boundaries', () => {
    expect(slotKey(startsAt, endsAt)).toBe('2026-03-10T03:30:00.000Z|2026-03-10T04:30:00.000Z');

    // A slot with the same start but a different end is a different slot: a
    // 30-minute increment must not silently satisfy a 60-minute plan.
    const shorter = new Date('2026-03-10T04:00:00.000Z');
    const plan = reconcileSlots(planned, [
      { id: 'slot-1', startsAt, endsAt: shorter, status: 'open' },
    ]);

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toDeleteIds).toEqual(['slot-1']);
  });
});

describe('coversWindow', () => {
  const slot = {
    startsAt: new Date('2026-03-10T03:30:00.000Z'),
    endsAt: new Date('2026-03-10T04:30:00.000Z'),
  };

  it('accepts an exact match and a contained window', () => {
    expect(coversWindow(slot, slot.startsAt, slot.endsAt)).toBe(true);
    expect(
      coversWindow(
        slot,
        new Date('2026-03-10T03:45:00.000Z'),
        new Date('2026-03-10T04:15:00.000Z'),
      ),
    ).toBe(true);
  });

  it('rejects partial cover on either side', () => {
    expect(
      coversWindow(
        slot,
        new Date('2026-03-10T03:00:00.000Z'),
        new Date('2026-03-10T04:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      coversWindow(
        slot,
        new Date('2026-03-10T04:00:00.000Z'),
        new Date('2026-03-10T05:00:00.000Z'),
      ),
    ).toBe(false);
  });
});
