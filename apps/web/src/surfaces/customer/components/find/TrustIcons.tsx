/**
 * The trust vocabulary, drawn.
 *
 * `CategoryIcon.tsx` established the rule for this surface — stroke SVG on a
 * 24px grid, `currentColor`, no emoji — and the discovery screens need a
 * second, smaller family for the facts a customer actually weighs: is this
 * person checked, how well are they rated, how much have they done, how far
 * away are they, what will it cost, when are they free.
 *
 * These are separate from `CategoryIcon` because they answer a different
 * question (trust, not trade) and are used at a different size (14-18px inline
 * with text rather than 22px in a tile), which is why the stroke is a touch
 * heavier: a 1.75px stroke scaled down to 14px goes muddy on the 1x screens
 * this audience is mostly on.
 *
 * `lucide-react` is already a dependency and is used for chrome (nav, spinner,
 * chevrons). It is deliberately not used here: the badge tier and the rating
 * star are the two marks a customer reads before deciding, and they should
 * belong to this product's hand rather than to a generic icon set.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Svg({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/**
 * A shield with a tick — the ID-verification mark.
 *
 * The single most important glyph on this surface: it is the visual form of
 * the promise the whole marketplace is built on. Drawn with a flat top and a
 * pointed base so it reads as a shield at 14px, where a rounded crest turns
 * into an indistinct blob.
 */
export function ShieldTickIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 2.8 4.8 5.6v5.8c0 4.3 2.9 8.2 7.2 9.8 4.3-1.6 7.2-5.5 7.2-9.8V5.6z" {...STROKE} />
      <path d="m8.9 11.9 2.2 2.2 4-4.4" {...STROKE} />
    </Svg>
  );
}

/**
 * A five-point star, filled rather than stroked.
 *
 * The one deliberate exception to the stroke-only rule in this file: a rating
 * star is read as a quantity (how many are solid) and an outlined star at
 * 14px is ambiguous about whether it counts. `fill="currentColor"` lets the
 * same path render both the filled and empty state of a breakdown row by
 * changing only the text colour of its parent.
 */
export function StarIcon({
  className = 'h-4 w-4',
  filled = true,
}: {
  className?: string;
  filled?: boolean;
}) {
  return (
    <Svg className={className}>
      <path
        d="M12 3.4l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.93l-5.3 2.78 1.01-5.9-4.29-4.18 5.93-.86z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 1 : 2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A map pin — distance from the customer's chosen location. */
export function PinIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 21.2c4-4.2 6-7.4 6-9.9a6 6 0 1 0-12 0c0 2.5 2 5.7 6 9.9z" {...STROKE} />
      <circle cx="12" cy="11" r="2.3" {...STROKE} />
    </Svg>
  );
}

/**
 * A rupee glyph inside a rounded square — the price basis.
 *
 * A rupee sign rather than a generic wallet or tag, because the number beside
 * it is always rupees and the currency is never in question for this audience.
 */
export function RupeeIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Svg className={className}>
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.2" {...STROKE} />
      <path d="M8.6 7.6h6.8M8.6 10.6h6.8M13 7.6c1.7 0 2.4 1.3 2.4 2.6s-.8 2.6-2.7 2.6H9.4l5 4.4" {...STROKE} />
    </Svg>
  );
}

/** A clock — the next free slot. */
export function ClockIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.8" {...STROKE} />
      <path d="M12 7.2V12l3.2 2" {...STROKE} />
    </Svg>
  );
}

/**
 * A checklist clipboard — jobs completed.
 *
 * A tick inside a document, not a bare tick: a bare tick next to a number
 * reads as "confirmed", where the number is actually a count of finished work.
 */
export function JobsDoneIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M8.4 4.6H6.6a1.8 1.8 0 0 0-1.8 1.8v12.2a1.8 1.8 0 0 0 1.8 1.8h10.8a1.8 1.8 0 0 0 1.8-1.8V6.4a1.8 1.8 0 0 0-1.8-1.8h-1.8" {...STROKE} />
      <rect x="8.4" y="2.8" width="7.2" height="3.6" rx="1.2" {...STROKE} />
      <path d="m9.2 13.4 1.9 1.9 3.7-4" {...STROKE} />
    </Svg>
  );
}

/**
 * An empty-results mark: a magnifier over a flat horizon.
 *
 * Drawn rather than reusing `lucide`'s `Inbox` (the shared `EmptyState`'s
 * default) because "we searched around you and found nobody" is a specific,
 * recoverable situation, and a mailbox illustrates the wrong one. The horizon
 * line under the lens is what says "an area", not "a container".
 */
export function NoResultsIcon({ className = 'h-12 w-12' }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="10.6" cy="10.2" r="5.8" {...STROKE} />
      <path d="m15 14.6 4.6 4.6" {...STROKE} />
      <path d="M2.4 20.4h8.4" strokeDasharray="2 2.6" {...STROKE} />
    </Svg>
  );
}
