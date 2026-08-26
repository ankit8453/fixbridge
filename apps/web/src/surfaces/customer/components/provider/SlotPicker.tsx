import { useT } from '@/i18n/useT';
import {
  istDateLabel,
  istDayKey,
  istDayOfWeekKey,
  istTime,
} from '@/surfaces/customer/data/ist-date';
import type { PublicSlot } from '@/surfaces/customer/data/types';

export interface SlotPickerProps {
  slots: PublicSlot[];
  selectedSlotId: string | null;
  onSelect: (slotId: string) => void;
}

/**
 * Purely presentational — given the open slots and a selection, renders
 * day-grouped time buttons and calls back on a tap. No fetching here on
 * purpose: the provider page owns the `useProviderSlots` query, which keeps
 * this component testable with plain fixture data rather than a mocked
 * network call.
 *
 * Each time button's label is the time and nothing else. That is a constraint
 * the tests encode (`getByRole('button', { name: '09:00' })`) and it is also
 * the right design: a screen reader announcing "Monday 17 Aug 09:00 button"
 * for every one of a dozen slots in a group whose heading already said Monday
 * is unusable. The day heading carries the date once, for everybody.
 */
export function SlotPicker({ slots, selectedSlotId, onSelect }: SlotPickerProps) {
  const t = useT();

  if (slots.length === 0) {
    return <p className="text-sm text-shop-ink-soft">{t('app.provider.noSlots')}</p>;
  }

  const byDay = new Map<string, PublicSlot[]>();
  for (const slot of slots) {
    const key = istDayKey(slot.startsAt);
    const existing = byDay.get(key);
    if (existing) existing.push(slot);
    else byDay.set(key, [slot]);
  }

  return (
    <div className="flex flex-col gap-3">
      {[...byDay.entries()].map(([day, daySlots]) => (
        <div key={day}>
          {/* One text node, not a styled `<span>` around the date: a nested
              element would make the date match `getAllByText(/Aug/)` twice —
              once on the paragraph and once on the span — and the day-grouping
              test counts those matches. */}
          <p className="mb-2 text-[13px] font-semibold text-shop-ink">
            {`${t(istDayOfWeekKey(daySlots[0]?.startsAt ?? day))}, ${istDateLabel(
              daySlots[0]?.startsAt ?? day,
            )}`}
          </p>
          <div className="flex flex-wrap gap-2">
            {daySlots.map((slot) => {
              const selected = slot.id === selectedSlotId;
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => onSelect(slot.id)}
                  aria-pressed={selected}
                  className={`min-h-touch min-w-touch rounded-xl border px-4 text-sm font-semibold tabular-nums transition-colors ${
                    selected
                      ? 'border-shop bg-shop text-shop-foreground shadow-sm'
                      : 'border-shop-line bg-white text-shop-ink hover:border-shop/40 hover:bg-shop-soft/40'
                  }`}
                >
                  {istTime(slot.startsAt)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
