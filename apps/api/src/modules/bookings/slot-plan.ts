import { MINUTES_IN_DAY } from '../providers/availability';

/**
 * Turning weekly availability templates into concrete dated slots — pure, so
 * every edge of the calendar arithmetic is testable without a database.
 *
 * **Everything here is Asia/Kolkata.** Templates say "Tuesday 18:00", which is a
 * wall-clock time in the only timezone this product has. The offset is fixed at
 * +05:30 with no DST, which is the one mercy of Indian timekeeping: a plain
 * arithmetic conversion is exactly right, and no tz database is needed.
 */

/** India Standard Time, in minutes. Fixed all year — India has no DST. */
export const IST_OFFSET_MINUTES = 330;

export interface AvailabilityTemplateLike {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}

export interface PlannedSlot {
  startsAt: Date;
  endsAt: Date;
  sourceTemplateId: string;
}

/** Midnight IST on the given IST calendar day, as a UTC instant. */
export function istMidnightUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, -IST_OFFSET_MINUTES, 0, 0));
}

/** The IST calendar day an instant falls on. */
export function istDayParts(instant: Date): { year: number; month: number; day: number } {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/** 0 = Sunday … 6 = Saturday, in IST. Matches `dayOfWeek` on the template. */
export function istDayOfWeek(instant: Date): number {
  return new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000).getUTCDay();
}

/**
 * Chops one template window into fixed-length slots.
 *
 * A window shorter than the increment yields **nothing**, and so does the
 * remainder at the end of a longer one: a 90-minute window at 60-minute
 * increments produces one slot, not one-and-a-half. Offering a customer half an
 * hour that the technician did not offer would be worse than offering less.
 */
export function planSlotsForWindow(
  template: AvailabilityTemplateLike,
  dayStartUtc: Date,
  incrementMinutes: number,
): PlannedSlot[] {
  if (!template.isActive) return [];
  if (incrementMinutes <= 0) return [];
  if (template.endMinute <= template.startMinute) return [];

  const slots: PlannedSlot[] = [];

  for (
    let minute = template.startMinute;
    minute + incrementMinutes <= template.endMinute;
    minute += incrementMinutes
  ) {
    const startsAt = new Date(dayStartUtc.getTime() + minute * 60_000);
    const endsAt = new Date(startsAt.getTime() + incrementMinutes * 60_000);

    slots.push({ startsAt, endsAt, sourceTemplateId: template.id });
  }

  return slots;
}

export interface PlanOptions {
  /** Inclusive IST day to start from — normally "today". */
  from: Date;
  horizonDays: number;
  incrementMinutes: number;
  /** Slots entirely in the past are pointless; nothing before this is planned. */
  notBefore?: Date;
}

/**
 * Every slot a provider's templates imply over the horizon.
 *
 * Deterministic and sorted, so a re-run produces byte-identical output and the
 * nightly job can be idempotent by comparison rather than by bookkeeping.
 */
export function planSlots(
  templates: readonly AvailabilityTemplateLike[],
  options: PlanOptions,
): PlannedSlot[] {
  const active = templates.filter((template) => template.isActive);
  if (active.length === 0) return [];

  const notBefore = options.notBefore ?? options.from;
  const { year, month, day } = istDayParts(options.from);
  const planned: PlannedSlot[] = [];

  for (let offset = 0; offset < options.horizonDays; offset += 1) {
    const dayStart = istMidnightUtc(year, month, day + offset);
    const weekday = istDayOfWeek(dayStart);

    for (const template of active) {
      if (template.dayOfWeek !== weekday) continue;

      for (const slot of planSlotsForWindow(template, dayStart, options.incrementMinutes)) {
        if (slot.startsAt.getTime() < notBefore.getTime()) continue;
        planned.push(slot);
      }
    }
  }

  return planned.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Stable identity for a planned slot, used to diff against what already exists. */
export function slotKey(startsAt: Date, endsAt: Date): string {
  return `${startsAt.toISOString()}|${endsAt.toISOString()}`;
}

export interface ExistingSlotLike {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: 'open' | 'held' | 'booked' | 'blocked';
}

export interface SlotReconciliation {
  toCreate: PlannedSlot[];
  /** `open` slots the templates no longer imply. */
  toDeleteIds: string[];
  /** Left alone because someone is relying on them. */
  preservedIds: string[];
}

/**
 * Diffs what the templates say against what exists.
 *
 * The rule that matters: **`held`, `booked` and `blocked` slots are never
 * touched.** A technician editing their hours must not cancel a job somebody has
 * already booked, and must not silently un-block time they deliberately blocked.
 * Only `open` slots — which nobody is relying on — are added or removed.
 */
export function reconcileSlots(
  planned: readonly PlannedSlot[],
  existing: readonly ExistingSlotLike[],
): SlotReconciliation {
  const plannedByKey = new Map(planned.map((slot) => [slotKey(slot.startsAt, slot.endsAt), slot]));

  const toDeleteIds: string[] = [];
  const preservedIds: string[] = [];
  const covered = new Set<string>();

  for (const slot of existing) {
    const key = slotKey(slot.startsAt, slot.endsAt);

    if (slot.status !== 'open') {
      // Untouchable, and it already covers this hour, so nothing is recreated.
      preservedIds.push(slot.id);
      covered.add(key);
      continue;
    }

    if (plannedByKey.has(key)) {
      covered.add(key);
    } else {
      toDeleteIds.push(slot.id);
    }
  }

  return {
    toCreate: planned.filter((slot) => !covered.has(slotKey(slot.startsAt, slot.endsAt))),
    toDeleteIds,
    preservedIds,
  };
}

/** Does a slot fully cover the requested window? Partial cover is not availability. */
export function coversWindow(
  slot: { startsAt: Date; endsAt: Date },
  windowStart: Date,
  windowEnd: Date,
): boolean {
  return (
    slot.startsAt.getTime() <= windowStart.getTime() && slot.endsAt.getTime() >= windowEnd.getTime()
  );
}

/** Combines an IST calendar date with a minute-of-day into a UTC instant. */
export function istInstant(
  date: { year: number; month: number; day: number },
  minute: number,
): Date {
  if (minute < 0 || minute > MINUTES_IN_DAY) {
    throw new Error(`minute ${minute} is outside a day`);
  }

  return new Date(istMidnightUtc(date.year, date.month, date.day).getTime() + minute * 60_000);
}
