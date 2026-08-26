/**
 * Category icons, drawn rather than typed.
 *
 * These were emoji — `⚡`, `🔧`, `🛠️` — which is the single fastest way to make
 * a product look unfinished. Emoji also render differently on every platform
 * (Samsung's wrench is not Apple's), cannot take the brand's colours, and sit
 * on the text baseline rather than on a pixel grid, so a row of them never
 * quite lines up.
 *
 * Stroke-based SVG on a 24px grid instead: one visual family, `currentColor`
 * throughout so each tile tints its own icon, and crisp at any size.
 *
 * Keyed by the category's `slug` rather than its `icon` column because the slug
 * is the stable identity — `icon` is a hint the seed happens to set, and a
 * category added later without one should still get a real icon.
 */

export type CategorySlug =
  | 'electrical'
  | 'plumbing'
  | 'motors-generators'
  | 'cooling-appliances'
  | 'mechanics';

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** A lightning bolt through a socket plate — wiring, not weather. */
function ElectricalIcon() {
  return (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" {...STROKE} />
      <path d="M13.2 7.5 9.8 12.4h3.1l-2.1 4.1" {...STROKE} />
    </>
  );
}

/** A bent length of pipe with its joint collars. */
function PlumbingIcon() {
  return (
    <>
      <path d="M5 8h6a3 3 0 0 1 3 3v8" {...STROKE} />
      <path d="M3.5 6.2h3.2v3.6H3.5z" {...STROKE} />
      <path d="M12.2 17.6h3.6v3.2h-3.6z" {...STROKE} />
      <path d="M17 5.5h3.5M18.75 3.75v3.5" {...STROKE} />
    </>
  );
}

/** A motor body with a drive shaft and cooling fins. */
function MotorIcon() {
  return (
    <>
      <rect x="3.5" y="8" width="11" height="8.5" rx="2" {...STROKE} />
      <path d="M14.5 12.25h4M18.5 9.5v5.5" {...STROKE} />
      <path d="M6.2 8V5.8M9 8V5.8M11.8 8V5.8" {...STROKE} />
    </>
  );
}

/** A snowflake — the one shape that reads instantly as cooling. */
function CoolingIcon() {
  return (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5 4.2 16.5" {...STROKE} />
      <path d="M12 6.6 9.9 4.9M12 6.6l2.1-1.7M12 17.4l-2.1 1.7M12 17.4l2.1 1.7" {...STROKE} />
    </>
  );
}

/** A spanner at rest, jaw open. */
function MechanicsIcon() {
  return (
    <>
      <path
        d="M15.6 4.6a4.2 4.2 0 0 0-5.3 5.3L4.8 15.4a2 2 0 0 0 2.8 2.8l5.5-5.5a4.2 4.2 0 0 0 5.3-5.3l-2.4 2.4-2.3-.6-.6-2.3z"
        {...STROKE}
      />
    </>
  );
}

const ICONS: Record<CategorySlug, () => JSX.Element> = {
  electrical: ElectricalIcon,
  plumbing: PlumbingIcon,
  'motors-generators': MotorIcon,
  'cooling-appliances': CoolingIcon,
  mechanics: MechanicsIcon,
};

/** A wrench-and-screwdriver pair, for any category without a drawn icon. */
function GenericIcon() {
  return (
    <>
      <path d="M14.5 6.5a3.5 3.5 0 0 0 4.6 4.6l-8 8a2.2 2.2 0 0 1-3.1-3.1z" {...STROKE} />
      <path d="M6.5 6.5 10 10M4.8 4.8l1.7 1.7" {...STROKE} />
    </>
  );
}

export function CategoryIcon({
  slug,
  className = 'h-6 w-6',
}: {
  slug: string;
  className?: string;
}) {
  const Glyph = ICONS[slug as CategorySlug] ?? GenericIcon;

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <Glyph />
    </svg>
  );
}

/**
 * Each category gets its own colour.
 *
 * Not decoration: five identical tiles are a wall of text, and a returning
 * customer navigates by remembered position and colour long before they read
 * the label. Tailwind classes rather than tokens because these are per-category
 * hues that sit deliberately outside the single-accent brand palette.
 */
export const CATEGORY_THEME: Record<string, { tile: string; icon: string; glow: string }> = {
  electrical: {
    tile: 'from-amber-50 to-orange-50 border-amber-200/70',
    icon: 'bg-gradient-to-br from-amber-400 to-orange-500',
    glow: 'bg-amber-400/20',
  },
  plumbing: {
    tile: 'from-sky-50 to-blue-50 border-sky-200/70',
    icon: 'bg-gradient-to-br from-sky-400 to-blue-500',
    glow: 'bg-sky-400/20',
  },
  'motors-generators': {
    tile: 'from-violet-50 to-purple-50 border-violet-200/70',
    icon: 'bg-gradient-to-br from-violet-400 to-purple-500',
    glow: 'bg-violet-400/20',
  },
  'cooling-appliances': {
    tile: 'from-cyan-50 to-teal-50 border-cyan-200/70',
    icon: 'bg-gradient-to-br from-cyan-400 to-teal-500',
    glow: 'bg-cyan-400/20',
  },
  mechanics: {
    tile: 'from-rose-50 to-pink-50 border-rose-200/70',
    icon: 'bg-gradient-to-br from-rose-400 to-pink-500',
    glow: 'bg-rose-400/20',
  },
};

export const DEFAULT_THEME = {
  tile: 'from-slate-50 to-slate-100 border-shop-line',
  icon: 'bg-gradient-to-br from-slate-400 to-slate-600',
  glow: 'bg-slate-400/20',
};

export function themeFor(slug: string) {
  return CATEGORY_THEME[slug] ?? DEFAULT_THEME;
}
