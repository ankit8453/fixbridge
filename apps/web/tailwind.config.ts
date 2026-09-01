import type { Config } from 'tailwindcss';

/**
 * The brand/design tokens live in exactly one place at runtime:
 * `src/brand/tokens.ts`. Tailwind's config is evaluated at build time, so it
 * cannot read a value a later deploy might change without a rebuild — and it
 * shouldn't need to. Instead every brand/semantic colour below points at a
 * CSS custom property, and `<BrandStyleVars>` (rendered once, in
 * `RootLayout`) writes their actual values from the tokens module. Swapping
 * the brand — or retuning a semantic colour — only ever touches tokens.ts;
 * every `bg-brand`, `text-success`, `border-border` class keeps working with
 * no rebuild of this file.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--color-brand-primary)',
          foreground: 'var(--color-brand-primary-foreground)',
          // Gradients, pressed states, and the very light selected-row tint.
          deep: 'var(--color-brand-primary-deep)',
          soft: 'var(--color-brand-primary-soft)',
        },
        'brand-accent': 'var(--color-brand-accent)',
        'brand-accent-alt': 'var(--color-brand-accent-alt)',
        // The customer storefront — warm coral on cream, deliberately not the
        // indigo of the partner app. See shopColors in brand/tokens.ts.
        shop: {
          DEFAULT: 'var(--color-shop-primary)',
          foreground: 'var(--color-shop-primary-foreground)',
          bright: 'var(--color-shop-bright)',
          deep: 'var(--color-shop-deep)',
          soft: 'var(--color-shop-soft)',
          accent: 'var(--color-shop-accent)',
          ground: 'var(--color-shop-ground)',
          ink: 'var(--color-shop-ink)',
          'ink-soft': 'var(--color-shop-ink-soft)',
          line: 'var(--color-shop-line)',
        },
        // The ops console's own accent — teal, deliberately not the indigo the
        // customer and partner surfaces use. See adminColors in brand/tokens.ts.
        admin: {
          DEFAULT: 'var(--color-admin-primary)',
          foreground: 'var(--color-admin-primary-foreground)',
          deep: 'var(--color-admin-primary-deep)',
          soft: 'var(--color-admin-primary-soft)',
          alt: 'var(--color-admin-accent-alt)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          foreground: 'var(--color-success-foreground)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          foreground: 'var(--color-warning-foreground)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          foreground: 'var(--color-danger-foreground)',
        },
        muted: {
          DEFAULT: 'var(--color-muted)',
          foreground: 'var(--color-muted-foreground)',
        },
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
      },
      fontFamily: {
        // Set from `index.html`'s Google Fonts `<link>` + `src/index.css`'s
        // `[lang]`-keyed custom properties — see index.css for why the
        // switch is keyed off `<html lang>` rather than a Tailwind variant.
        devanagari: ['var(--font-devanagari)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-latin)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
      },
      // 44px is the touch-target floor this app designs to (mobile-first —
      // see README). Named so components can write `min-h-touch` instead of
      // repeating the magic number.
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
      boxShadow: {
        // Deliberately subtle — the brief's "no gradient soup, no bevels".
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 1px 0 rgb(15 23 42 / 0.03)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
};

export default config;
