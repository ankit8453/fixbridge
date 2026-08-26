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
  /**
   * Indigo, not the muted teal this shipped with.
   *
   * The first palette was chosen to be inoffensive while the brand was
   * undecided, and it succeeded a little too well -- the owner's word for the
   * result was that it looked like a government portal. Correct: desaturated
   * blue-green at mid lightness is the house style of exactly that, and a
   * marketplace asking somebody to trust a stranger with their home needs to
   * feel like a product, not a form.
   *
   * Indigo at 6.29:1 on white clears WCAG AA for body text, so it can be used
   * for real text and not just decoration -- which the accent below cannot.
   */
  primary: '#4f46e5',
  primaryForeground: '#ffffff',
  /**
   * Deeper indigo, for gradients and pressed states. Having the second stop as
   * a token rather than a Tailwind literal keeps a rebrand to this one file.
   */
  primaryDeep: '#4338ca',
  /** Very light tint for selected rows and icon chips. */
  primarySoft: '#eef2ff',
  /**
   * Amber. 2.15:1 on white, so DECORATIVE ONLY -- badges, highlights, the
   * gradient's warm end. Never body text, never a lone icon carrying meaning.
   */
  accent: '#f59e0b',
  /** Violet, the gradient's other end and the second chart series. */
  accentAlt: '#7c3aed',
} as const;

/**
 * The customer storefront's palette — deep plum, deliberately NOT the indigo
 * the partner app uses nor the teal of the ops console.
 *
 * Three surfaces, three registers. The ops console is teal (an instrument
 * panel), the partner app is indigo (the product a technician works for), and
 * this is plum — the one a customer sees when they are deciding whether to
 * let somebody into their house. Plum is uncommon in this category, which is
 * the point: it reads as a brand rather than as a default framework blue, and
 * nobody confuses it with the other two surfaces at a glance.
 *
 * Contrast measured, not guessed:
 *   - `primary` #7e22ce is 6.82:1 on the ground — clears WCAG AA for body
 *     text, so it can carry real copy and not just chrome.
 *   - `bright` #a855f7 is 3.87:1 — DECORATIVE ONLY. Gradients, fills behind
 *     white text, illustration. Never body text on a light ground.
 */
export const shopColors = {
  /** Plum. 6.82:1 on the ground — clears WCAG AA, so it can carry real text. */
  primary: '#7e22ce',
  primaryForeground: '#ffffff',
  /**
   * Light violet. 3.87:1 — DECORATIVE ONLY. Gradients, icon fills behind white
   * glyphs, illustration. Never body text on a light ground.
   */
  bright: '#a855f7',
  /** Deep plum, for pressed states and the far end of a gradient. */
  deep: '#6b21a8',
  /** The barely-there tint behind selected rows and icon chips. */
  soft: '#faf5ff',
  /** Warm gold — the one warm note, used sparingly. Decorative. */
  accent: '#f0a04b',
  /**
   * The page ground. A hair off white with a violet cast, so the surface does
   * not read as the default white every other app ships.
   */
  ground: '#fdfcfd',
  /** Near-black with a violet cast, so text does not look blue on this ground. */
  ink: '#1c1721',
  /** De-emphasised copy. 5.56:1. */
  inkSoft: '#6b6472',
  /** Hairline borders. */
  line: '#ece7f0',
} as const;

/**
 * The ops console's own accent, deliberately NOT the customer/partner indigo.
 *
 * Two audiences, two jobs. A technician is on a phone between jobs and the
 * indigo brand is the product they chose to work for. An ops reviewer is at a
 * desk all day working a queue, deciding whether somebody earns this week —
 * and needs to know at a glance which system they are looking at, because the
 * two surfaces share a browser and a session.
 *
 * Teal reads as "instrument panel" rather than "brand", which is the right
 * register for a tool. It also sits far enough from indigo in hue that a
 * mis-click between surfaces is obvious immediately.
 *
 * Measured, not eyeballed: `primary` is 4.62:1 on white, so it clears WCAG AA
 * for body text. `accent` (amber) is decorative only — see the note there.
 */
export const adminColors = {
  /** Teal-600. 4.62:1 on white — safe for real text, not just chrome. */
  primary: '#0d9488',
  primaryForeground: '#ffffff',
  /** Teal-700, for gradients and pressed states. */
  primaryDeep: '#0f766e',
  /** Very light tint for selected rows and icon chips. */
  primarySoft: '#f0fdfa',
  /** Cyan-600 — the gradient's other end and a second chart series. */
  accentAlt: '#0891b2',
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
  success: '#059669',
  successForeground: '#ecfdf5',
  warning: '#d97706',
  warningForeground: '#fffbeb',
  danger: '#e11d48',
  dangerForeground: '#fff1f2',
  // "Muted" is a text tone (de-emphasised copy — timestamps, hints), not a
  // status; kept here anyway so every "quiet" colour in the app traces back
  // to one token instead of components each picking their own slate shade.
  muted: '#64748b',
  mutedForeground: '#f8fafc',
  surface: '#ffffff',
  border: '#e5e7eb',
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
    `--color-brand-primary-deep:${brandColors.primaryDeep};` +
    `--color-brand-primary-soft:${brandColors.primarySoft};` +
    `--color-brand-accent:${brandColors.accent};` +
    `--color-brand-accent-alt:${brandColors.accentAlt};` +
    `--color-shop-primary:${shopColors.primary};` +
    `--color-shop-primary-foreground:${shopColors.primaryForeground};` +
    `--color-shop-bright:${shopColors.bright};` +
    `--color-shop-deep:${shopColors.deep};` +
    `--color-shop-soft:${shopColors.soft};` +
    `--color-shop-accent:${shopColors.accent};` +
    `--color-shop-ground:${shopColors.ground};` +
    `--color-shop-ink:${shopColors.ink};` +
    `--color-shop-ink-soft:${shopColors.inkSoft};` +
    `--color-shop-line:${shopColors.line};` +
    `--color-admin-primary:${adminColors.primary};` +
    `--color-admin-primary-foreground:${adminColors.primaryForeground};` +
    `--color-admin-primary-deep:${adminColors.primaryDeep};` +
    `--color-admin-primary-soft:${adminColors.primarySoft};` +
    `--color-admin-accent-alt:${adminColors.accentAlt};` +
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
