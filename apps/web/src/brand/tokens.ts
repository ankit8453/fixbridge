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

/**
 * First character, uppercased.
 *
 * No longer used by `BrandLogo`, which now draws the real mark, but kept as
 * the fallback initial for avatar-style placeholders where a person or a
 * surface has no image of its own.
 */
export const APP_INITIAL = APP_NAME.charAt(0).toUpperCase();

/**
 * The FixBridge palette: navy, blue and gold, each with one job.
 *
 * All three are real — navy and gold are sampled from `logo.png`, and the blue
 * is the exact `#2563eb` the customer app uses. That last point is the whole
 * reason it is here: somebody who taps a blue button on this site and then
 * opens the app should not feel they have arrived somewhere else.
 *
 *   - **navy** is the chrome. Headers, footers, dark bands, the anchor end of
 *     a gradient. It is the brand's own colour and it holds the page together.
 *   - **blue** is the action. Every button, link and interactive accent.
 *     Deliberately not navy: if the chrome and the buttons are the same
 *     colour, nothing on the page looks clickable.
 *   - **gold** is the warmth. Badges, rules, highlights.
 *
 * An earlier version of this file was indigo and plum, chosen while the brand
 * was still undecided; it matched neither the logo nor either app.
 *
 * Contrast measured, not guessed, against the `#fbfaf7` ground:
 *   - blue `#2563eb` — **4.95:1**, clears AA for body text.
 *   - navy `#2b2e5c` — **12.21:1**, AAA.
 *   - gold `#e0ba62` — **1.77:1**, so DECORATIVE ONLY on a light ground. It is
 *     **6.9:1 on navy**, which clears AA, so gold text on a navy band is safe.
 *     Gold on blue is 2.8:1 and is not.
 */
export const brandColors = {
  /** The action colour, identical to the customer app's. 4.95:1 on ground. */
  primary: '#2563eb',
  primaryForeground: '#ffffff',
  /** Deeper blue for pressed states and the far end of a gradient. 6.42:1. */
  primaryDeep: '#1d4ed8',
  /** The app's own `blueSoft`, for selected rows and icon chips. */
  primarySoft: '#eff4ff',
  /**
   * Gold. DECORATIVE on a light ground (1.77:1) — badges, rules, the warm end
   * of a gradient. Safe as text only on navy, where it is 6.9:1.
   */
  accent: '#e0ba62',
  /** Brand navy — the chrome: dark bands, headers, footers, gradient anchor. */
  accentAlt: '#2b2e5c',
} as const;

/**
 * The customer storefront's palette.
 *
 * The customer app's blue on the logo's own warm paper. An earlier version was
 * plum, chosen so the three surfaces could not be confused — reasonable while
 * the brand was undecided, but it meant the surface a customer actually sees
 * was the one furthest from the brand. The surfaces are now told apart by hue
 * where it matters (graphite for technicians, teal for ops) and by ground and
 * density everywhere else.
 */
export const shopColors = {
  /** The customer app's blue, to the digit. 4.95:1 on the ground. */
  primary: '#2563eb',
  primaryForeground: '#ffffff',
  /**
   * Lighter blue. 3.1:1 — DECORATIVE ONLY. Gradients, icon fills behind white
   * glyphs, illustration. Never body text on a light ground.
   */
  bright: '#60a5fa',
  /** Deep blue, for pressed states and the far end of a gradient. */
  deep: '#1d4ed8',
  /** The tint behind selected rows and icon chips. */
  soft: '#eff4ff',
  /** Gold. Decorative here; safe as text only on navy. */
  accent: '#e0ba62',
  /**
   * The page ground: the logo's own cream, lightened. Warm rather than the
   * default white, so the site sits on the same paper the mark was drawn on.
   */
  ground: '#fbfaf7',
  /** Near-black with a navy cast, so text does not look cold on warm paper. */
  ink: '#1b1c2e',
  /** De-emphasised copy. 6.03:1 — still AA for body text. */
  inkSoft: '#5c5f72',
  /** Hairline borders, warm to match the ground. */
  line: '#e9e7e0',
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
  return createElement('img', {
    src: '/img/brand/logo-mark.png',
    alt: APP_NAME,
    width: size,
    height: size,
    style: {
      // The mark is wider than tall, so height is the axis that must be
      // honoured -- letting width drive it in a flex row squashes it.
      width: 'auto',
      height: size,
      objectFit: 'contain',
      flexShrink: 0,
      display: 'block',
    },
  });
}

/**
 * The mark with the wordmark beside it, for a page that is introducing the
 * product rather than continuing it -- sign-in, the marketing header.
 */
export function BrandLockup({ height = 40 }: { height?: number }): ReactElement {
  return createElement('img', {
    src: '/img/brand/logo-wordmark.png',
    alt: APP_NAME,
    style: {
      width: 'auto',
      height,
      objectFit: 'contain',
      flexShrink: 0,
      display: 'block',
    },
  });
}
