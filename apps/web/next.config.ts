import type { NextConfig } from 'next';

/**
 * Deliberately small.
 *
 * There is no `i18n` block here — the App Router dropped the Pages Router's
 * built-in i18n routing, and the replacement (a `[locale]` segment plus
 * `src/middleware.ts`) is implemented by hand. See `src/middleware.ts` for why
 * that shape was chosen over an i18n library.
 *
 * `images.unoptimized` stays unset (i.e. optimisation ON): the whole point of
 * this app is a cheap Android phone on 4G, and Next's image optimiser resizing
 * and re-encoding to the viewport is exactly the bytes that audience cannot
 * afford to skip.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    /**
     * `next build` runs its own bundled ESLint pass by default, using
     * `eslint-config-next` if present. This repo deliberately does not
     * install that config — apps/api and apps/admin are both linted by one
     * root `eslint.config.mjs` (flat config) via the top-level `npm run
     * lint`, precisely so every workspace is held to the same rules rather
     * than each app's bundler opinion. Leaving Next's own pass enabled
     * would run a SECOND, differently-configured lint pass during every
     * build — and Next's pass fails outright on rules like
     * `@next/next/no-img-element` that only exist in `eslint-config-next`,
     * which this repo does not have. `npm run lint` (root) remains the
     * real gate; see `apps/web/README.md`.
     */
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
