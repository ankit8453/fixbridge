import { type ReactNode } from 'react';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

// One literal string per class so Tailwind's content scanner (a text grep
// over this file, not a live evaluation) can see every candidate — see
// Card.tsx's StatTile for the same rule stated in full.
const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-green-50 text-green-800 ring-green-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
  info: 'bg-blue-50 text-blue-800 ring-blue-200',
};

const DOT_TONES: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  success: 'bg-green-600',
  warning: 'bg-amber-600',
  danger: 'bg-red-600',
  info: 'bg-blue-600',
};

/**
 * A generic tag — a count, a category, a short label. Deliberately has no
 * booking/verification-specific status mapping baked in: this app renders
 * those statuses translated (`t('bookings.status.accepted')`), and a tone
 * mapping keyed on an untranslated English enum value belongs next to
 * whichever surface owns that enum, not in the shared UI kit.
 */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A status indicator — a leading dot plus label, for "this booking/case/job
 * is in state X" contexts where a reader scans a list for the dot colour
 * before reading the word. `Badge` and `StatusPill` share a tone vocabulary
 * on purpose: a page mixing both (a category `Badge` next to a status
 * `StatusPill` in the same row) never has to reconcile two colour systems.
 */
export function StatusPill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONES[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}
