import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Devanagari } from 'next/font/google';
import { notFound } from 'next/navigation';
import { type ReactNode } from 'react';
import { APP_NAME, BrandStyleVars, THEME_COLOR } from '@/brand/tokens';
import { DEFAULT_LOCALE, isSupportedLocale, SUPPORTED_LOCALES } from '@/i18n/config';
import { getT } from '@/i18n/get-t';
import '../globals.css';
import { Providers } from './providers';

/**
 * This IS the root layout (contains `<html>`/`<body>`) — there is no
 * `src/app/layout.tsx` above it. Every page in this app lives under
 * `[locale]`, so putting the root here rather than duplicating an
 * `<html lang>` per-locale in a layout further down is the only way to set
 * `lang` correctly without a second render pass. `src/app/api/**` route
 * handlers sit outside this tree entirely and need no HTML shell.
 *
 * **Font loading — why `display: 'optional'` and not `'swap'`:** `swap`
 * guarantees the browser eventually repaints from the fallback font to the
 * real one, and for Devanagari that repaint is not a subtle one — a fallback
 * font on a device with no Devanagari webfont support renders very different
 * glyph widths (or tofu) than Noto Sans Devanagari, so `swap` would produce a
 * real, visible reflow on a screen that is mostly Hindi text (this app's
 * default locale). `optional` tells the browser to use the custom font only
 * if it is already available within a very short block window (effectively:
 * cached from a previous visit); otherwise it renders with the fallback for
 * the rest of that page view and never swaps mid-read. On a cheap phone's
 * first, cold 4G load, that trades "the nicer font might not show up" for
 * "the layout never jumps under someone's thumb" — the right trade for the
 * audience this is built for. Only two weights are loaded (400/600): every
 * additional weight is bytes this connection has to spend before first
 * paint.
 */
const devanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '600'],
  display: 'optional',
  variable: '--font-devanagari',
});

const latin = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'optional',
  variable: '--font-latin',
});

export function generateStaticParams(): { locale: string }[] {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const t = getT(locale);

  return {
    title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
    description: t('brand.metaDescription'),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) notFound();

  return (
    /**
     * `suppressHydrationWarning` on `<html>` and `<body>`, and nowhere else.
     *
     * Browser extensions routinely edit these two elements before React
     * hydrates — password managers, translators and wallet UIs all add classes
     * and `data-` attributes to them — and React then reports a mismatch for a
     * difference the application did not cause and cannot prevent. A real user
     * on a ₹8,000 phone with two extensions installed would hit this on every
     * page load.
     *
     * The suppression is **one level deep by design**: it silences attribute
     * differences on the element it is set on, not on its subtree. So a genuine
     * mismatch inside the app — a date formatted in the user's locale, a
     * `Math.random()` in a component — still fails loudly, which is the warning
     * worth keeping.
     */
    <html
      lang={rawLocale}
      className={`${devanagari.variable} ${latin.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <BrandStyleVars />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
