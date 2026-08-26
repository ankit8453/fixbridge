import { type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * The small shared vocabulary for the account/alerts/addresses/complaints
 * screens.
 *
 * ## Why these are not in `@/components/ui`
 *
 * The shared kit is surface-neutral, and its `Button variant="primary"` is
 * `bg-brand` — the partner app's indigo. On the customer surface that colour
 * is simply wrong, so these four screens need a filled control in the deep
 * plum `shop-*` palette. Rather than fork the kit (owned elsewhere) or paste
 * the same twelve utility classes into four files, the plum control lives
 * here once. Everything else — inputs, modals, badges, states — still comes
 * from the shared kit, which is already palette-neutral.
 *
 * The icons follow `find/CategoryIcon.tsx`: stroke SVG on a 24px grid, all
 * `currentColor` so each call site tints its own. No emoji — they were
 * deliberately removed from this surface.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Glyph({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** A stack of address cards with a pin on the front one. */
export function AddressBookIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="3.5" y="4.5" width="14" height="15" rx="2.5" {...STROKE} />
      <path d="M17.5 7.5h1.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H8" {...STROKE} />
      <path d="M10.5 8.2a2 2 0 0 1 4 0c0 1.5-2 3.8-2 3.8s-2-2.3-2-3.8z" {...STROKE} />
      <path d="M7.5 15.5h6" {...STROKE} />
    </Glyph>
  );
}

/** A speech bubble with an exclamation — a raised issue, not a chat. */
export function ComplaintIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.4a.5.5 0 0 1-.8-.4V16a1 1 0 0 1-1-1z"
        {...STROKE}
      />
      <path d="M12 7.6v3.2" {...STROKE} />
      <path d="M12 13.4h.01" {...STROKE} />
    </Glyph>
  );
}

/** A bell — the alerts screen's own mark, used in its empty state. */
export function BellIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path
        d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.2.9 5 1.7 5.9a.6.6 0 0 1-.45 1H5.25a.6.6 0 0 1-.45-1c.8-.9 1.7-2.7 1.7-5.9z"
        {...STROKE}
      />
      <path d="M10 19.2a2.2 2.2 0 0 0 4 0" {...STROKE} />
    </Glyph>
  );
}

/** A pin — a single saved place. */
export function PinIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M12 21s6.5-6.2 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.8 12 21 12 21z" {...STROKE} />
      <circle cx="12" cy="10.3" r="2.4" {...STROKE} />
    </Glyph>
  );
}

/** A shield with a tick — "nothing outstanding", for the complaints empty state. */
export function ShieldOkIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M12 3.2 5 5.8v5.6c0 4 2.9 7.6 7 9.4 4.1-1.8 7-5.4 7-9.4V5.8z" {...STROKE} />
      <path d="m9.2 11.9 2 2 3.6-3.9" {...STROKE} />
    </Glyph>
  );
}

/**
 * The page title shared by these screens. `as` keeps the heading level honest
 * — `h1` for a page title, `h2` for a section inside one — without every call
 * site restating the same type scale.
 */
export function PageHeading({
  as: Tag = 'h1',
  children,
  trailing,
}: {
  as?: 'h1' | 'h2';
  children: ReactNode;
  /** Optional control that sits on the title's baseline, e.g. "Add address". */
  trailing?: ReactNode;
}) {
  const size =
    Tag === 'h1'
      ? 'text-[22px] leading-tight lg:text-[26px]'
      : 'text-[15px] leading-tight lg:text-base';

  if (!trailing) {
    return <Tag className={`font-bold tracking-tight text-shop-ink ${size}`}>{children}</Tag>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tag className={`font-bold tracking-tight text-shop-ink ${size}`}>{children}</Tag>
      {trailing}
    </div>
  );
}

type ShopTone = 'primary' | 'quiet' | 'danger';

// One literal class string per tone so Tailwind's content scanner — a text
// grep over this file, not a live evaluation — sees every candidate.
const TONES: Record<ShopTone, string> = {
  primary: 'border-transparent bg-shop text-shop-foreground shadow-sm hover:bg-shop-deep',
  quiet: 'border-shop-line bg-white text-shop-ink hover:bg-shop-soft/70',
  danger: 'border-red-200 bg-white text-red-700 hover:bg-red-50',
};

/**
 * A control in the customer palette. Keeps the shared kit's 44px touch floor
 * and 16px-ish text (below 16px iOS Safari zooms the page on focus), it just
 * wears plum instead of the partner surface's indigo.
 */
export function ShopButton({
  tone = 'quiet',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ShopTone; size?: 'sm' | 'md' }) {
  const sizing =
    size === 'sm'
      ? 'min-h-touch px-3 py-1.5 text-[13px] gap-1.5'
      : 'min-h-touch px-4 py-2.5 text-[15px] gap-2';

  return (
    <button
      // Explicit, because a bare <button> inside a form defaults to submit.
      type={rest.type ?? 'button'}
      {...rest}
      className={`inline-flex items-center justify-center rounded-xl border font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${sizing} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A row-shaped skeleton, matching the list rows on these screens so the
 * layout does not jump when the query resolves.
 */
export function RowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="divide-y divide-shop-line overflow-hidden rounded-2xl border border-shop-line bg-white"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-3 px-4 py-3.5">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-shop-soft" />
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <div className="h-3.5 w-2/5 animate-pulse rounded bg-shop-soft" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-shop-soft/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
