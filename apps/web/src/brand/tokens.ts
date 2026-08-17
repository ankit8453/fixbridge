import { createElement, type ReactElement } from 'react';
import { DEFAULT_APP_NAME } from '@fixbridge/shared';

/**
 * The one file that changes when the brand is decided.
 *
 * Nothing else in this app may hardcode a name, a colour or a wordmark —
 * every surface imports from here. `.ts` rather than `.tsx` is deliberate:
 * `<BrandLogo>` is built with `createElement` instead of JSX so this stays a
 * single importable module without a build-time distinction between "the
 * data" and "the component that renders it" — a future rebrand is a data
 * change, not a component rewrite.
 *
 * Copy (tagline, meta description, etc.) is NOT duplicated here. Real user-
 * facing text belongs in src/locales/{hi,en}.json under the `brand.*`
 * namespace, same key discipline as the API's i18n — this module only names
 * which keys those are, so a page can write `t('brand.tagline')` without
 * knowing the string lives in two places.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? DEFAULT_APP_NAME;

/** First character, uppercased, for the placeholder wordmark — see BrandLogo. */
export const APP_INITIAL = APP_NAME.charAt(0).toUpperCase();

/**
 * Placeholder palette. Chosen to look intentional (not "unstyled defaults")
 * without resembling any real company's identity, since the brand is
 * genuinely undecided — swap these three values and every `bg-brand`,
 * `text-brand`, `text-brand-accent` class in the app follows.
 */
export const brandColors = {
  primary: '#0f6e5c',
  primaryForeground: '#ffffff',
  accent: '#e08a2c',
} as const;

/** Theme-color for the browser chrome / PWA splash — see src/app/manifest.ts. */
export const THEME_COLOR = brandColors.primary;

/**
 * i18n key anchors for brand-adjacent copy.
 *
 * Referencing these constants instead of writing the string keys inline means
 * a rename of the namespace (unlikely, but see the API's own `payable.*`
 * comment style) is a one-line change here rather than a grep-and-replace
 * across every marketing page some other agent writes.
 */
export const BRAND_COPY_KEYS = {
  tagline: 'brand.tagline',
  metaDescription: 'brand.metaDescription',
} as const;

/**
 * Writes the palette above onto `:root` as CSS custom properties.
 *
 * Tailwind's `brand`/`brand-accent` colours (tailwind.config.ts) point at
 * these variable names rather than literal hex values, because Tailwind's
 * config is frozen at build time and this module is the only place allowed to
 * decide the actual colour. Render this once, near the top of the root
 * layout's `<body>` — a `<style>` tag rather than inline styles on `<html>`
 * because CSS custom properties inherit to every descendant for free, and a
 * dedicated tag is trivially cacheable/inspectable in devtools.
 */
export function BrandStyleVars(): ReactElement {
  const css = `:root{--color-brand-primary:${brandColors.primary};--color-brand-primary-foreground:${brandColors.primaryForeground};--color-brand-accent:${brandColors.accent};}`;
  return createElement('style', { dangerouslySetInnerHTML: { __html: css } });
}

/**
 * The wordmark placeholder.
 *
 * A monogram square rather than an empty box or a literal "LOGO" string —
 * this renders on every page from day one (nav, PWA splash preview, etc.) and
 * a component that looks broken is a worse placeholder than one that looks
 * deliberately plain. Swapping in a real mark later means replacing this
 * function's body; nothing that calls `<BrandLogo />` needs to change.
 */
export function BrandLogo({ size = 32 }: { size?: number }): ReactElement {
  return createElement(
    'span',
    {
      role: 'img',
      'aria-label': APP_NAME,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size * 0.25,
        backgroundColor: brandColors.primary,
        color: brandColors.primaryForeground,
        fontWeight: 700,
        fontSize: size * 0.5,
        lineHeight: 1,
        flexShrink: 0,
      },
    },
    APP_INITIAL,
  );
}
