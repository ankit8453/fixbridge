import { type ReactNode } from 'react';

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  good: 'bg-green-50 text-green-800 ring-green-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-red-50 text-red-800 ring-red-200',
  info: 'bg-blue-50 text-blue-800 ring-blue-200',
};

/**
 * A generic status pill. Deliberately has no booking/verification-specific
 * mapping baked in (unlike admin's `StatusBadge`) — this app renders those
 * statuses translated (`t('bookings.status.accepted')`, etc.), and a tone
 * mapping keyed on an untranslated English enum value belongs next to
 * whichever surface owns that enum, not in the shared UI kit.
 */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
