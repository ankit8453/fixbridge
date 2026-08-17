import type { Config } from 'tailwindcss';

/**
 * The brand colour lives in exactly one place at runtime: `src/brand/tokens.ts`.
 *
 * Tailwind's config is evaluated at build time, so it cannot read an env var
 * that a later deploy might change without a rebuild — and it shouldn't need
 * to. Instead `brand`/`brand-accent` below point at CSS custom properties, and
 * `<BrandStyleVars>` (rendered once, in the root layout) writes their values
 * from the tokens module. Swapping the brand still only touches tokens.ts;
 * `bg-brand`, `text-brand`, etc. keep working everywhere with no rebuild of
 * this file. Everything else here (slate/state colours) is intentionally
 * brand-neutral structure, same reasoning admin's UI kit gives for having no
 * design-system dependency.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--color-brand-primary)',
          foreground: 'var(--color-brand-primary-foreground)',
        },
        'brand-accent': 'var(--color-brand-accent)',
      },
      fontFamily: {
        // Populated with CSS variables from next/font in the root layout —
        // see src/app/[locale]/layout.tsx for why `display: 'optional'` was
        // chosen over the usual `'swap'`.
        devanagari: ['var(--font-devanagari)', 'sans-serif'],
        sans: ['var(--font-latin)', 'system-ui', 'sans-serif'],
      },
      // 44px is the touch-target floor this app designs to (mobile-first, see
      // README). Named so components can write `min-h-touch` instead of
      // repeating the magic number.
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
  plugins: [],
};

export default config;
