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
 * network call. Ported verbatim from
 * `legacy-next-src/components/customer/provider/SlotPicker.tsx`.
 */
export function SlotPicker({ slots, selectedSlotId, onSelect }: SlotPickerProps) {
  const t = useT();

  if (slots.length === 0) {
    return <p className="text-sm text-slate-500">{t('app.provider.noSlots')}</p>;
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
          <p className="mb-1.5 text-sm font-medium text-slate-700">
            {t(istDayOfWeekKey(daySlots[0]?.startsAt ?? day))} ·{' '}
            {istDateLabel(daySlots[0]?.startsAt ?? day)}
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
                  className={`min-h-touch min-w-touch rounded-lg border px-3 text-sm font-medium transition-colors ${
                    selected
                      ? 'border-brand bg-brand text-brand-foreground'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
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
