import type { BookingStatus } from '@/surfaces/customer/data/types';
import type { Tone } from '@/components/ui';

/**
 * One status vocabulary for the whole booking surface.
 *
 * `BookingListItem` used to own a `STATUS_TONE` map and `BookingDetail`
 * hardcoded `tone="info"` for every status — so the same booking could show
 * amber in the list and blue on its own detail screen. A customer scanning a
 * list navigates by colour before they read the word, and a colour that
 * changes between two screens for the same booking is worse than no colour.
 *
 * `tone` feeds the shared `Badge`/`StatusPill` vocabulary. The extra Tailwind
 * classes are for the larger surfaces the pill cannot cover — a card's accent
 * rail, the detail hero — and are written as whole literal class names because
 * Tailwind's content scanner greps this file's raw text (see `Card.tsx`'s
 * `StatTile` for the same rule).
 */
export interface StatusTheme {
  tone: Tone;
  /** Left accent rail on a list card. */
  rail: string;
  /** Tinted chip behind the status icon. */
  chip: string;
  /** Icon/text colour that passes contrast on `chip`. */
  ink: string;
  /** True while the job is still running — drives the "live" pulse. */
  live: boolean;
}

const THEMES: Record<BookingStatus, StatusTheme> = {
  REQUESTED: {
    tone: 'warning',
    rail: 'bg-amber-400',
    chip: 'bg-amber-50',
    ink: 'text-amber-700',
    live: true,
  },
  ACCEPTED: {
    tone: 'info',
    rail: 'bg-shop',
    chip: 'bg-shop-soft',
    ink: 'text-shop',
    live: true,
  },
  EN_ROUTE: {
    tone: 'info',
    rail: 'bg-shop',
    chip: 'bg-shop-soft',
    ink: 'text-shop',
    live: true,
  },
  ARRIVED: {
    tone: 'info',
    rail: 'bg-shop',
    chip: 'bg-shop-soft',
    ink: 'text-shop',
    live: true,
  },
  IN_PROGRESS: {
    tone: 'info',
    rail: 'bg-shop-accent',
    chip: 'bg-violet-50',
    ink: 'text-violet-700',
    live: true,
  },
  WORK_DONE: {
    tone: 'success',
    rail: 'bg-emerald-500',
    chip: 'bg-emerald-50',
    ink: 'text-emerald-700',
    live: false,
  },
  REJECTED: {
    tone: 'danger',
    rail: 'bg-rose-500',
    chip: 'bg-rose-50',
    ink: 'text-rose-700',
    live: false,
  },
  EXPIRED: {
    tone: 'danger',
    rail: 'bg-rose-400',
    chip: 'bg-rose-50',
    ink: 'text-rose-700',
    live: false,
  },
  CANCELLED_BY_CUSTOMER: {
    tone: 'neutral',
    rail: 'bg-slate-300',
    chip: 'bg-slate-100',
    ink: 'text-shop-ink-soft',
    live: false,
  },
  CANCELLED_BY_PROVIDER: {
    tone: 'neutral',
    rail: 'bg-slate-300',
    chip: 'bg-slate-100',
    ink: 'text-shop-ink-soft',
    live: false,
  },
  CLOSED_QUOTE_DECLINED: {
    tone: 'neutral',
    rail: 'bg-slate-300',
    chip: 'bg-slate-100',
    ink: 'text-shop-ink-soft',
    live: false,
  },
};

const FALLBACK: StatusTheme = {
  tone: 'neutral',
  rail: 'bg-slate-300',
  chip: 'bg-slate-100',
  ink: 'text-shop-ink-soft',
  live: false,
};

/**
 * Tolerant of an unknown string on purpose: the API can add a status before
 * this client is redeployed, and an unstyled-but-rendered booking beats a
 * crash on a screen somebody is standing in their hallway reading.
 */
export function statusTheme(status: string): StatusTheme {
  return THEMES[status as BookingStatus] ?? FALLBACK;
}
