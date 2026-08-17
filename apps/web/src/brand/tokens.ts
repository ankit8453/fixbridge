import { createElement, type ReactElement } from 'react';
import { DEFAULT_APP_NAME } from '@fixbridge/shared';

/**
 * The one file that changes when the brand is decided, and the one file that
 * changes to retune the design system's palette.
 *
 * Nothing else in this app may hardcode a name or a colour — every surface
 * imports from here, and `<BrandStyleVars>` (rendered once in `RootLayout`)
 * is what actually gets these values onto the page: it writes them as CSS
 * custom properties, and `tailwind.config.ts`'s `brand`/`success`/`warning`/
 * `danger`/`muted`/`surface`/`border` colours all point at those variable
 * names rather than a literal hex. A rebrand or a palette retune is a data
 * change in this one module, never a grep across components.
 *
 * `.ts` rather than `.tsx` is deliberate: `<BrandLogo>` is built with
 * `createElement` instead of JSX so this stays a single importable module
 * without a build-time split between "the data" and "the component that
 * renders it".
 *
 * Copy (tagline, meta description, etc.) is NOT duplicated here. Real
 * user-facing text belongs in `src/locales/{hi,en}.json` under the `brand.*`
 * namespace, same key discipline as the API's i18n — this module only names
 * which keys those are (`BRAND_COPY_KEYS`), so a page can write
 * `t('brand.tagline')` without knowing the string lives in two places.
 */

export const APP_NAME = import.meta.env.VITE_APP_NAME ?? DEFAULT_APP_NAME;

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

/**
 * Semantic tokens — brand-neutral by design. These name a *meaning*
 * (something succeeded, something needs attention, something failed), not a
 * hue, which is what lets `StatusPill`/`Badge`/form errors reuse the same
 * three colours everywhere instead of every screen picking its own shade of
 * red. Chosen at a contrast ratio that holds up as text-on-white AND as the
 * foreground on their own tinted background (see `Badge`/`StatusPill`).
 */
export const semanticColors = {
  success: '#15803d',
  successForeground: '#f0fdf4',
  warning: '#b45309',
  warningForeground: '#fffbeb',
  danger: '#b91c1c',
  dangerForeground: '#fef2f2',
  // "Muted" is a text tone (de-emphasised copy — timestamps, hints), not a
  // status; kept here anyway so every "quiet" colour in the app traces back
  // to one token instead of components each picking their own slate shade.
  muted: '#64748b',
  mutedForeground: '#f8fafc',
  surface: '#ffffff',
  border: '#e2e8f0',
} as const;

/** Theme-color for the browser chrome / PWA splash — see public/manifest.webmanifest. */
export const THEME_COLOR = brandColors.primary;

/**
 * i18n key anchors for brand-adjacent copy.
 *
 * Referencing these constants instead of writing the string keys inline means
 * a rename of the namespace is a one-line change here rather than a
 * grep-and-replace across every marketing page some other agent writes.
 */
export const BRAND_COPY_KEYS = {
  tagline: 'brand.tagline',
  metaDescription: 'brand.metaDescription',
} as const;

/**
 * Writes the palette above onto `:root` as CSS custom properties.
 *
 * Render this once, near the top of the app (`RootLayout`) — a `<style>` tag
 * rather than inline styles on `<html>` because CSS custom properties
 * inherit to every descendant for free, and a dedicated tag is trivially
 * cacheable/inspectable in devtools.
 */
export function BrandStyleVars(): ReactElement {
  const css =
    `:root{` +
    `--color-brand-primary:${brandColors.primary};` +
    `--color-brand-primary-foreground:${brandColors.primaryForeground};` +
    `--color-brand-accent:${brandColors.accent};` +
    `--color-success:${semanticColors.success};` +
    `--color-success-foreground:${semanticColors.successForeground};` +
    `--color-warning:${semanticColors.warning};` +
    `--color-warning-foreground:${semanticColors.warningForeground};` +
    `--color-danger:${semanticColors.danger};` +
    `--color-danger-foreground:${semanticColors.dangerForeground};` +
    `--color-muted:${semanticColors.muted};` +
    `--color-muted-foreground:${semanticColors.mutedForeground};` +
    `--color-surface:${semanticColors.surface};` +
    `--color-border:${semanticColors.border};` +
    `}`;
  return createElement('style', { dangerouslySetInnerHTML: { __html: css } });
}

/**
 * The wordmark placeholder.
 *
 * A monogram square rather than an empty box or a literal "LOGO" string —
 * this renders on every page from day one (nav, PWA splash preview, the
 * `/design` showcase) and a component that looks broken is a worse
 * placeholder than one that looks deliberately plain. Swapping in a real
 * mark later means replacing this function's body; nothing that calls
 * `<BrandLogo />` needs to change.
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
