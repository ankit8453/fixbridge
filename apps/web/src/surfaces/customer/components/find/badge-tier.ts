import type { Badge } from '@/surfaces/customer/data/types';

/**
 * How each verification tier looks, in one place.
 *
 * The tier is the single most consequential thing on a provider card — it is
 * literally the answer to "has anybody checked this person before I let them
 * into my house" — and it renders in two places (the search card and the
 * profile header) that must never disagree. Before this it was two separate
 * `Record<Badge, Tone>` maps flattening all four tiers onto the generic
 * `Badge` component's four tones, which made GOLD and VERIFIED look like a
 * success and an info message rather than two rungs of one ladder.
 *
 * Tailwind classes are written as whole literal strings, never assembled from
 * fragments, because Tailwind's content scanner is a text grep over source —
 * a class built as `bg-${tone}-50` at runtime is a class that never ships.
 */
export interface BadgeTierStyle {
  /** The chip on a card: background, text, and ring, as one class string. */
  chip: string;
  /** A stronger, filled treatment for the profile header's hero. */
  solid: string;
  /**
   * Whether this tier means "somebody has actually checked their ID".
   *
   * NONE is a technician who is listed but not yet through verification, and
   * showing them a shield would be a lie in the one place a lie costs most.
   */
  verified: boolean;
}

export const BADGE_TIER: Record<Badge, BadgeTierStyle> = {
  // Not "bad", just new — slate rather than a warning colour, because a red
  // or amber chip on a legitimately new technician reads as a warning about
  // them rather than an absence of history.
  NONE: {
    chip: 'bg-slate-100 text-slate-700 ring-slate-200',
    solid: 'bg-white/15 text-white ring-white/25',
    verified: false,
  },
  VERIFIED: {
    chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    solid: 'bg-emerald-400/20 text-white ring-emerald-200/40',
    verified: true,
  },
  // Slate-blue rather than a literal silver: a true grey chip is invisible
  // against the white card, and "silver" is a tier name, not a colour brief.
  SILVER: {
    chip: 'bg-sky-50 text-sky-800 ring-sky-200',
    solid: 'bg-sky-400/20 text-white ring-sky-200/40',
    verified: true,
  },
  // Amber is `shop-accent`'s hue and fails contrast as text on white at the
  // token's value, so the chip uses the darker amber-800 on a 50 tint rather
  // than the token itself — decorative-only rule, honoured.
  GOLD: {
    chip: 'bg-amber-50 text-amber-900 ring-amber-300',
    solid: 'bg-amber-400/25 text-white ring-amber-200/50',
    verified: true,
  },
};
