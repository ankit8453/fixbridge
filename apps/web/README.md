# `apps/web` — the customer, partner, admin and marketing surfaces

Next.js (App Router) + TypeScript + Tailwind. One deployable app, four route
groups, calling the same `/api/v1/*` the mobile apps will eventually use.
This document covers the **foundation**: auth, i18n, the API client, the UI
kit and the shared shell. Each surface's actual pages are documented by
whichever phase/agent built them — see `docs/summaries/` at the repo root.

## Running it

```bash
cp .env.example .env.local   # then edit NEXT_PUBLIC_API_URL, see below
npm install                  # from the repo root — this is an npm workspace
npm run dev:web               # from the repo root, or `npm run dev` in this directory
```

Opens on **`:3000`**.

### The port collision with the API

This app is fixed to `:3000` — that is Next's default and, more importantly,
the port a Vercel deploy does not let you choose. `apps/api` **also**
defaults `PORT` to `3000` (see `apps/api/.env.example`). Running the API and
this app side by side locally means giving the API a different port:

```bash
# apps/api/.env
PORT=3001
```

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
```

`.env.example` in this directory defaults to `:3001` on that assumption.

## Architecture

```
src/
  app/
    [locale]/            every real page lives under here — see i18n below
      layout.tsx          the actual root layout (html/body, fonts, providers)
      providers.tsx        QueryClientProvider + AuthProvider, client-side
      (marketing)/         surface A — public, SEO-first, no auth
      app/                 surface B — customer, requires any authenticated role
      partner/             surface C — technician, requires the `technician` role
      admin/               surface D — ops/admin, requires `ops`/`admin` role, noindex
    api/session/          Next Route Handlers that own the refresh cookie (see Auth)
    manifest.ts            PWA manifest (see PWA)
    not-found.tsx           true-root 404 — see the file's own comment for why
    global-error.tsx        true-root error boundary — same reason
  brand/tokens.ts          the ONE file that changes to rebrand this app
  i18n/                    locale detection, the t()/useT() translator, config
  locales/{hi,en}.json      the app's own copy (plus per-surface locale files
                             other agents add under the same naming: e.g.
                             marketing.hi.json, customer.en.json — merged by
                             src/i18n/dictionaries.ts)
  lib/
    api.ts                 the typed fetch client for the external API
    money.ts                 the ₹ formatter
    env.ts                   NEXT_PUBLIC_API_URL, read once
    auth/                   session state, AuthProvider, route guards
  components/
    ui/                     hand-rolled primitives — Button, Card, Field, ...
    shell/                  RoleNav, SurfaceSwitcher, LocaleToggle
  middleware.ts             locale routing (see i18n)
  test/                     shared Vitest/RTL harness — mockApi, renderWithQuery, ...
```

### Why four route groups in one app

`(marketing)` is a route group (parenthesised — adds no URL segment);
`app`, `partner`, `admin` are real path segments. All four sit under a
`[locale]` dynamic segment, which every one of them needs for `t()` — see
i18n below for why that segment exists at all.

## Auth

**Threat model:** an XSS bug somewhere in this app (a rendered comment, a
badly-escaped name) must not be able to steal a session that lasts 30 days.
It can steal whatever lives in memory for the life of the tab; it must never
be able to read a refresh token.

- **Access token:** a module-level variable in `lib/auth/session.ts`. Never
  `localStorage`, never a readable cookie. Dies with the tab/reload.
- **Refresh token:** an **httpOnly, `SameSite=Lax`** cookie
  (`fixbridge_refresh`), set and read **only** by three Next Route Handlers —
  `POST /api/session/login`, `/refresh`, `/logout` — which proxy to the API's
  `/api/v1/auth/otp/verify`, `/refresh`, `/logout`. Every response these
  handlers send strips the refresh token out of the JSON body first
  (`app/api/session/_shared.ts`'s `stripRefreshToken`) — page JavaScript
  never sees it, not even transiently in a variable that could be logged.
  `Secure` is conditional on `NODE_ENV === 'production'`: a browser silently
  refuses to store a `Secure` cookie over plain `http`, and local dev serves
  this app over `http://localhost:3000`.
- **Device id:** generated once (`web-<uuid>`), kept in `localStorage`. Not a
  secret — knowing it lets nobody do anything; it only lets the API tell "the
  same browser refreshing" apart from "a stolen refresh token replayed from
  elsewhere" (see the root README's note on `/auth/refresh`).
- **Silent refresh, single-flight:** `lib/api.ts`'s `apiRequest` catches a
  `401 AUTH_TOKEN_EXPIRED`, calls `refreshAccessToken()`
  (`lib/auth/session.ts`) and retries once. `refreshAccessToken` shares one
  in-flight promise across every concurrent caller — see that function's own
  comment for exactly why two callers presenting the same (about-to-rotate)
  refresh token is the bug this exists to prevent. Tested in
  `src/test/auth-silent-refresh.test.ts`.
- **`AuthProvider`** (`lib/auth/AuthProvider.tsx`) + **`useAuth()`**
  (`lib/auth/useAuth.ts`) expose `status` (`'restoring' | 'signedOut' |
'signedIn'`), `user`, `roles`, `requestOtp(phone)`, `login(phone, otp)`,
  `logout()`. Mounted once, above all four surfaces (`app/[locale]/layout.tsx`
  → `providers.tsx`) — even marketing pages want to know "already signed in".
- **Guards** (`lib/auth/guards.tsx`): `<RequireAuth>` / `<RequireRole
role="technician">`, client components a surface layout wraps its children
  in. `lib/auth/server-guard.ts`'s `hasSessionCookie()` is a cheap
  **server-side** fast path (checks the cookie's presence, not its
  validity/roles) used in each guarded layout to `redirect()` a definitely
  signed-out request before shipping any client JS. **Neither guard is the
  real security boundary** — the API enforces every permission on every
  request regardless of what this app renders; these exist purely so a
  signed-out visitor never sees a flash of protected UI.
- **A login page is not part of this foundation** — build one at (by
  convention, since the guards default here) `(marketing)/login/page.tsx`
  using `useAuth()`'s `requestOtp`/`login`, matching the admin console's dev
  OTP flow (`AUTH_FIXED_OTP=000000` for `+9199999...` numbers).

Flow diagram (login):

```
Browser                    Next (this app)                  API
  |-- POST /api/session/login ->|
  |   {phone, otp, deviceId}    |-- POST /api/v1/auth/otp/verify ->|
  |                             |<---------- {accessToken, refreshToken, ...}
  |                             |  set-cookie: fixbridge_refresh=... (httpOnly)
  |<-- {accessToken, user} -----|  (refreshToken stripped)
  |  (kept in memory only)
```

## i18n — Hindi-first

Default locale `hi` (no URL prefix), `en` under `/en/...`. **Decision:** a
`[locale]` dynamic segment (every page lives under
`src/app/[locale]/...`) plus `src/middleware.ts`, not a library
(`next-intl`, etc.) and not the old Pages-Router `i18n` config (removed in
the App Router). The middleware:

- `/en/...` → passes through; `[locale]` is `en`.
- `/...` (no prefix) → **rewritten** (not redirected) to `/hi/...`
  internally — the address bar keeps the clean URL. A rewrite costs nothing
  extra on the wire; a redirect is a round trip every first-time visitor
  (by definition hitting the unprefixed URL) would pay for on 4G.
- `/hi/...` (explicit) → redirected to the unprefixed URL, so `hi` never has
  two canonical addresses for the same page (duplicate URLs split SEO
  ranking signal).

No `Accept-Language` sniffing: the default is always `hi` regardless of
browser language, so a crawler and a Hindi-reading visitor see the same
content at the same URL — see `src/middleware.ts`'s own comment for the full
reasoning.

**`t()`:** `useT()` (client, `src/i18n/useT.ts`) and `getT(locale)` (server,
`src/i18n/get-t.ts`) share one lookup engine (`src/i18n/dictionaries.ts`),
mirroring `apps/api/src/core/i18n.ts`'s nested-key/fallback-to-default-locale
shape. Copy lives in `src/locales/{hi,en}.json` for foundation-owned strings;
other surfaces add their own `<surface>.{hi,en}.json` files (e.g.
`marketing.hi.json`) merged in by `dictionaries.ts` — one file per surface
per locale keeps a rename or a copy edit from becoming a merge conflict on
one giant JSON file.

**`Accept-Language`:** `lib/api.ts`'s `apiRequest` sets it from
`lib/i18n/locale-client.ts`'s `getClientLocale()`, which reads
`document.documentElement.lang` (set by the root layout from the same
`[locale]` param `useT()` reads) — chosen over threading a `locale` prop
through every call site because `apiRequest` is called from places that
cannot call a hook (a `queryFn`, an event handler).

**Fonts:** `next/font/google` — Noto Sans Devanagari + Inter (Latin
fallback), **`display: 'optional'`**, not the usual `'swap'`. `swap`
guarantees an eventual visible repaint from the fallback font to the real
one; for Devanagari, that repaint is not subtle — a fallback font's glyph
widths differ enough from Noto Sans Devanagari to visibly reflow a
Hindi-heavy page. `optional` uses the custom font only if it is already
available almost instantly (effectively: cached), otherwise renders with the
fallback for that whole page view and never swaps mid-read — the right trade
for a cheap phone on 4G, where "the nicer font didn't load" beats "the
layout jumped under your thumb." See `src/app/[locale]/layout.tsx`.

## API client (`src/lib/api.ts`)

```ts
apiRequest<T>(path: string, options?: {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  skipAuth?: boolean;   // public GETs made while signed out
  locale?: Locale;      // override the detected Accept-Language
}): Promise<T>
```

Attaches the in-memory access token, sets `Accept-Language`, and on a `401
AUTH_TOKEN_EXPIRED` calls the silent refresh and retries once (see Auth).
Throws `ApiError` (`status`, `code`, `requestId`, `fieldErrors`) on any
non-2xx — render it with `<ErrorState>` from the UI kit.

**Pagination — the one quirk, isolated:**

```ts
paginationParams(page, pageSize, spelling?: 'page_size' | 'pageSize'): Record<string, QueryValue>
parsePage<T>(body: unknown, itemsKey: string): { items: T[]; page: number; pageSize: number; total: number }
```

Every paginated endpoint takes `page`/`page_size` **except** the Phase 4
verification queue, which takes `pageSize`. `paginationParams` defaults to
`page_size`; the one call site that needs the other passes
`spelling: 'pageSize'` explicitly — see the function's own comment.

**TanStack Query:** `createQueryClient()` — 10s stale time, no
retry on 4xx, `refetchOnWindowFocus: false` (mobile-first: no desktop
window-focus habit to serve). Mounted once in `app/[locale]/providers.tsx`.

## The ₹ util (`src/lib/money.ts`)

```ts
formatPaise(paise: number): string   // 125000 -> "₹1,250" (Indian digit grouping, no trailing .00)
parseRupeesToPaise(input: string): number | null
```

The **only** money formatter in this app — matches
`apps/api/src/modules/search/service.ts`'s `formatPaise` exactly. Money is
an integer number of paise everywhere in this system; nothing else may call
`toLocaleString` on an amount.

## UI kit (`src/components/ui`, barrel: `@/components/ui`)

Hand-rolled, no design-system dependency — same reasoning as
`apps/admin/src/components/ui`, extended for a touch-first audience: every
interactive control enforces a **44px touch target** and **16px+ text**
(below 16px, iOS Safari zooms the whole page on focus).

| Export                                                 | Signature                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `Button`                                               | `{ variant?: 'primary'\|'secondary'\|'danger'\|'ghost'; fullWidth?: boolean } & ButtonHTMLAttributes`                          |
| `Card`                                                 | `{ title?; actions?; children; className? }`                                                                                   |
| `StatTile`                                             | `{ label: string; value: string\|number; href?: string; hint?: string }`                                                       |
| `DetailRow`                                            | `{ label: string; children }`                                                                                                  |
| `Field`                                                | `{ label: string; hint?: string; error?: string\|null; children: (id: string) => ReactNode }` (render-prop)                    |
| `TextInput` / `TextArea` / `Select`                    | standard HTML attributes, pre-styled                                                                                           |
| `Modal`                                                | `{ title: string; onClose: () => void; children; width?: string }` — bottom sheet on phone width, centred dialog from `sm:` up |
| `Badge`                                                | `{ tone?: 'neutral'\|'good'\|'warn'\|'bad'\|'info'; children }` — generic; no domain-specific status→tone mapping baked in     |
| `Table` / `Th` / `Td` / `Tr`                           | for genuinely tabular screens; most lists on a phone-width screen should be cards, not a `<table>`                             |
| `Pagination`                                           | `{ page, pageSize, total, onChange: (page: number) => void }`                                                                  |
| `Spinner` / `EmptyState` / `ErrorState` / `QueryState` | loading/empty/error primitives; `QueryState` wraps a TanStack Query result's three states in one place                         |

## Brand (`src/brand/tokens.ts`)

The **one file** that changes to rebrand this app: `APP_NAME` (from
`NEXT_PUBLIC_APP_NAME`, defaulting to `@fixbridge/shared`'s
`DEFAULT_APP_NAME`), `brandColors`, `<BrandLogo>` (a monogram placeholder),
`<BrandStyleVars>` (writes the palette onto `:root` as CSS custom properties
— Tailwind's `bg-brand`/`text-brand` classes point at those variable names,
never a literal hex, so a rebrand needs no Tailwind rebuild). Copy
(tagline, meta description) lives in i18n (`brand.*` keys in
`src/locales/{hi,en}.json`) — this module only names which keys those are
(`BRAND_COPY_KEYS`).

## PWA-lite (`src/app/manifest.ts`)

Manifest only — **no service worker, no offline support, no push**,
deliberately (see the phase spec's "explicitly out of scope": push rides
WhatsApp for partners in v1; a service worker with no offline strategy
behind it is a caching bug waiting to happen, not a feature). Enough for
Chrome/Android's "Add to Home Screen". Icons
(`public/icons/icon-{192,512}.png`) are flat placeholder squares in the
brand primary colour — real, licensed artwork (including a maskable variant
with proper safe-zone padding) is a pre-launch task; swap the two PNG files
and nothing else needs to change.

## Testing

Vitest 3.2.7 + React Testing Library, `jsdom` by default. Route-handler
suites opt into `// @vitest-environment node` at the top of the file (see
`vitest.config.ts`) — `NextRequest`/`NextResponse` assume Node's fetch
globals, which `jsdom` partially shadows.

- `src/test/setup.ts` — the one global setup: RTL `cleanup()`, the auth
  module's in-memory state reset, a `crypto.randomUUID` polyfill, mock/env
  teardown.
- `src/test/harness.tsx` — `mockApi(routes)` (fetch mocked at the boundary,
  keyed `"METHOD path"`), `waitForCall`, `renderWithQuery` (renders inside a
  retry-off `QueryClientProvider`), `sessionBody()`.
- `src/test/auth-silent-refresh.test.ts` — the single-flight refresh
  guarantee, plus login/OTP.
- `src/test/session-cookie-flags.test.ts` — calls the real
  `POST /api/session/login` route handler and asserts the `Set-Cookie`
  header is `HttpOnly`, `SameSite=Lax`, and conditionally `Secure`.
- `src/test/i18n-toggle.test.tsx` — `LocaleToggle` computes the correct
  cross-locale URL in both directions.

## Mobile-first

The design target is a ₹8,000 Android phone on 4G — desktop is the
adaptation. Concretely: 44px touch targets, 16px+ form text, `optional` font
loading, `refetchOnWindowFocus: false`, image optimisation left **on**
(`next.config.ts`), and every list built to paginate rather than render
everything at once.

## A note on dependency versions in this workspace

`apps/admin` (React 18) and this app (React 19) coexist in one npm
workspace. Where a shared dependency's exact version would otherwise force
npm to hoist a single, version-mismatched copy of `react`/`react-dom` to the
workspace root — breaking both this app's TypeScript compile (two `ReactNode`
types in one program) and `@testing-library/react`'s rendering (two React
runtime instances, "Objects are not valid as a React child") — this app
pins its own exact versions of the packages that touch React
(`@tanstack/react-query`, `@testing-library/react`) distinct from admin's, and
root `package.json`'s `overrides` field pins `@fixbridge/admin`'s React
stack to 18.3.1 explicitly. If `apps/admin` is ever removed from the
workspace, that `overrides` block becomes dead weight and can go with it.

## Dev server speed

The dev script runs **Turbopack** (`next dev --turbopack`). On this codebase,
measured cold on Windows:

| | Webpack | Turbopack |
| --- | --- | --- |
| First route compiled | 61s | 32s |
| Each further cold route | tens of seconds | ~1–3s |
| Warm reload | fast | fast |

The second row is the one you feel: you cross route boundaries constantly while
working, and Webpack recompiles a large graph each time.

Two things worth knowing before concluding "Next is slow":

**Dev and production are different problems.** These numbers are the dev
bundler. Production is pre-built — the marketing pages are static/ISR HTML and
the shared JS bundle is ~102 kB. Nothing about dev compile time reaches a
customer.

**On Windows, add the repo to your antivirus exclusions.** Real-time scanning
inspects every file a bundler writes, and `.next/` churns thousands of them.
This is frequently a larger factor than the bundler choice.
