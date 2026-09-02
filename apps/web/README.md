# `apps/web` — the customer, partner, admin and marketing surfaces

Vite + React 19 + TypeScript + Tailwind. One deployable SPA, four surfaces,
calling the same `/api/v1/*` the mobile apps will eventually use. This
document covers the **foundation**: routing, auth, i18n, the API client, the
design system and the shared shells. Each surface's actual pages are built by
whichever agent/phase owns them on top of this.

> **Why Vite, not Next.js.** This app replaced a working Next.js
> implementation of all four surfaces because the owner cannot maintain
> Next.js long-term. The old app's logic, API calls, Hindi copy and business
> rules were correct, and were ported across surface by surface; the
> reference tree it was ported from has since been deleted, so this app is
> the only implementation. The one behavioural regression the move forced is
> the refresh-token storage change documented under "Auth" below, and the
> loss of server-rendered HTML for the marketing surface (no pre-rendered
> markup for crawlers, no first paint before JS boots).

## Running it

```bash
cp .env.example .env   # then edit VITE_API_URL if the API isn't on :3001
npm install             # from the repo root — this is an npm workspace
npm run dev:web         # from the repo root, or `npm run dev` in this directory
```

Opens on **`:3000`**. The API defaults to `:3001` locally (see the root
README) — `.env.example` assumes that.

## Architecture

```
src/
  main.tsx                 true entry point — mounts AuthProvider → QueryClientProvider →
                            ToastProvider → RouterProvider, in that order (see the file's comment)
  index.css                 Tailwind + font-family switching + the one shared focus ring
  vite-env.d.ts              typed import.meta.env
  brand/tokens.ts            the ONE file that changes to rebrand or retune the palette
  i18n/                      locale detection (URL-based), the t()/useT() translator
  locales/{hi,en}.json        foundation-owned copy; other agents add <surface>.{hi,en}.json
                              (marketing.*, customer.*, partner.* already exist, ported verbatim
                              from legacy-next-src — see i18n/dictionaries.ts)
  lib/
    api.ts                   the typed fetch client for the external API
    api-error.ts              ApiError + envelope parsing
    money.ts                  the ₹ formatter
    env.ts                    VITE_API_URL / VITE_RAZORPAY_KEY_ID, read once
    auth/                     session state, AuthProvider, route guards — see Auth below
  components/
    ui/                      the design system — see below, barrel: @/components/ui
    shell/                   RoleNav, SurfaceSwitcher, LocaleToggle, AdminShell, MobileAppShell
  router/
    router.tsx                the whole route table
    localePrefix.ts            duplicates a route tree under `/` (hi) and `/en`
    RootLayout.tsx              <html lang> sync + the one Suspense boundary for lazy surfaces
    NotFound.tsx
  routes/
    auth/                     CustomerLogin, CustomerRegister, PartnerLogin, PartnerRegister,
                              AdminLogin, AdminRegisterPlaceholder, PhoneOtpForm — see Auth routes
    design/DesignSystemShowcase.tsx   /design — every UI primitive in every state
  surfaces/
    marketing/MarketingHome.tsx        placeholder — the marketing agent's mount point
    customer/CustomerAppEntry.tsx       placeholder — the customer agent's mount point
    partner/PartnerAppEntry.tsx         placeholder — the partner agent's mount point
    admin/AdminAppEntry.tsx             placeholder — the admin agent's mount point
  test/                      Vitest/RTL harness — mockApi, renderWithQuery, sessionBody, ...
```

## Routing (`src/router/`)

React Router 6 (`createBrowserRouter`/`RouterProvider`), matching the old
app's URL scheme exactly:

| Path                                  | Surface                     | Guard                                           |
| ------------------------------------- | --------------------------- | ----------------------------------------------- |
| `/`                                   | Marketing                   | none                                            |
| `/login`, `/register`                 | Customer auth               | none — sits outside the guard                   |
| `/partner/login`, `/partner/register` | Partner auth                | none                                            |
| `/admin/login`                        | Admin auth (password → OTP) | none                                            |
| `/admin/register`                     | **Not a form** — see below  | none                                            |
| `/app/*`                              | Customer app                | `RequireAuth` → `/login`                        |
| `/partner/*`                          | Partner app                 | `RequireAuth` → `/partner/login` (see note)     |
| `/admin/*`                            | Ops console                 | `RequireRole(['ops','admin'])` → `/admin/login` |
| `/design`                             | Design system showcase      | none                                            |

Every path above also exists under `/en/...` (English) — `hi` is the default
and is never prefixed. This is built by `router/localePrefix.ts`'s
`withLocalePrefix()`, which mounts the **same route tree twice**, once under
`/` and once under `/en`, rather than an optional `:locale?` param (see that
file's own comment on why: an optional segment makes a literal path like
`login` ambiguous with a locale value). An explicit `/hi` or `/hi/...` visit
redirects to the unprefixed equivalent, matching the old Next middleware's
behaviour, so the default locale never has two canonical URLs.

**`/partner/*` is guarded with `RequireAuth`, not `RequireRole('technician')`.**
Ported directly from `legacy-next-src/app/[locale]/partner/(protected)/layout.tsx`:
a signed-in customer with no provider registration must still reach
`/partner` and see a "become a partner" pitch
(`POST /providers/me/register`, any authenticated user can call it — see
`legacy-next-src/components/partner/BecomePartnerGate.tsx` for the reference
implementation). `PartnerAppEntry` demonstrates the branch point
(`roles.includes('technician')`); the partner-surface agent builds the real
gate and the real routed content behind it.

**`/admin/register` is deliberately not a registration form.** A public route
that could mint an admin account would let anyone grant themselves refund and
payout powers — see `routes/auth/AdminRegisterPlaceholder.tsx`'s own comment.
It renders a plain "ask an existing admin" message. **This route was added on
a mid-task routing clarification, not the original phase brief — flag it for
the product owner to confirm or overrule.**

Every surface's entry point (`surfaces/*/*.tsx`) is `React.lazy`-loaded;
`RootLayout` wraps the router `<Outlet>` in one `<Suspense>` boundary. The
auth routes are NOT lazy (small, and the first thing a signed-out visitor
waits on).

**Plugging in a real surface:** replace the corresponding `surfaces/*/*.tsx`
file's default export. The route (`app/*`, `partner/*`, `admin/*`) and its
guard already exist in `router/router.tsx` — a surface agent adds its own
nested routes _inside_ that entry component (e.g. with a nested
`<Routes>`/`<Outlet>`, or by expanding the `element` in `router.tsx` if the
surface wants top-level route objects instead — either is fine, `router.tsx`
does not care how a surface organises its own children).

## Auth (`src/lib/auth/`)

**Threat model:** an XSS bug somewhere in this app must not be able to steal
a session that lasts 30 days without at least having to reach into storage
that page JS can read.

- **Access token:** a module-level variable in `lib/auth/session.ts`. Never
  written to any storage. Dies with the tab/reload.
- **Refresh token: `localStorage`, not an httpOnly cookie — the one forced
  change from the old Next app, and it is weaker, not equivalent.** The old
  app kept it in an httpOnly cookie set by a Next.js route handler running on
  a server; a static SPA has no server to hold that cookie. An XSS bug can
  now read `localStorage` and steal the 30-day credential, not just whatever
  lives in memory for the current tab. This is the accepted cost of removing
  the server — read `session.ts`'s own comment at the top of the file before
  touching this, it explains exactly what still holds (the access token is
  still memory-only, single-flight refresh is unchanged) and what the real
  fix would be if a server ever comes back (a thin BFF re-introducing an
  httpOnly cookie, not a `localStorage` hardening trick).
- **Device id:** `web-<uuid>`, `localStorage`. Not a secret (see
  `session.ts`).
- **Silent refresh, single-flight:** `lib/api.ts`'s `apiRequest` catches a
  `401 AUTH_TOKEN_EXPIRED`, calls `refreshAccessToken()` and retries once.
  `refreshAccessToken` shares one in-flight promise across every concurrent
  caller. Tested in `src/test/auth-silent-refresh.test.ts`.
- **`AuthProvider`** (`lib/auth/AuthProvider.tsx`) + **`useAuth()`**
  (`lib/auth/useAuth.ts`), mounted once in `main.tsx` above the router:

  ```ts
  interface AuthState {
    status: 'restoring' | 'signedOut' | 'signedIn';
    user: AuthUser | null;
    roles: Role[];
    requestOtp: (phone: string) => Promise<{ phone: string; expiresInSeconds: number }>;
    login: (phone: string, otp: string) => Promise<void>;
    adminPasswordStep: (
      loginId: string,
      password: string,
    ) => Promise<{ challengeId: string; phone: string; expiresInSeconds: number }>;
    adminLogin: (challengeId: string, otp: string) => Promise<void>;
    logout: () => Promise<void>;
  }
  ```

  `adminPasswordStep`/`adminLogin` are the ops console's two-factor sign-in —
  `POST /api/v1/auth/admin/password` then `POST /api/v1/auth/admin/verify`
  (see `apps/api/src/modules/auth/admin-login.ts` for why it's two calls).

- **Guards** (`lib/auth/guards.tsx`): `<RequireAuth redirectTo="/login">` /
  `<RequireRole role={['ops','admin']} redirectTo="/admin/login">`. **Neither
  guard is the real security boundary** — the API enforces every permission
  on every request regardless of what this app renders; these exist purely
  so a signed-out visitor never sees a flash of protected UI. Uses
  `<Navigate replace>`, not an imperative redirect in an effect.

### Auth routes (`src/routes/auth/`)

`PhoneOtpForm` is the phone → OTP flow shared by `CustomerLogin`,
`CustomerRegister`, `PartnerLogin`, `PartnerRegister` — login and register
are the same API call (the API creates the account on first successful OTP
verification; there is no separate sign-up endpoint), so one component is
both screens; only heading copy, submit label and the post-login redirect
differ. **The masked-phone bug this form exists to prevent:**
`POST /auth/otp/request` echoes the phone back masked
(`+9199999*****`) — `phone` (what the user typed) and `maskedPhone` (display
only) are separate state on purpose. Regression test:
`src/test/login-phone.test.tsx`.

`AdminLogin` implements the two-step password→OTP flow directly (it doesn't
share `PhoneOtpForm` — the shape is different: id+password, then a
challenge+OTP, not phone, then OTP).

All six auth routes are placeholders — real copy/branding/onboarding is each
surface agent's job. What is real: the route exists, sits outside its
surface's guard, and calls the correct `useAuth()` methods with the correct
arguments.

## i18n — Hindi-first (`src/i18n/`)

Default locale `hi` (unprefixed), `en` under `/en/...` — see Routing above
for how the URL split is implemented (two duplicated route trees, not a
`[locale]` segment — there is no server to run Next-style middleware).

- **`useLocale()`** (`i18n/useT.ts`) reads `useLocation().pathname` — `en` if
  it starts with `/en` or equals it, `hi` otherwise. No context provider
  needed; the URL already is the source of truth.
- **`useT()`** — `(key: string, vars?: Record<string, string | number>) => string`.
  Nested dot-path keys, `{{var}}` interpolation, falls back to `hi` then to
  the key itself on a miss (mirrors `apps/api/src/core/i18n.ts`).
- **`getClientLocale()`** (`i18n/locale-client.ts`) — for call sites that
  aren't components (`lib/api.ts`'s `Accept-Language` header). Reads
  `document.documentElement.lang`, which `RootLayout` keeps synced to
  `useLocale()`'s value on every render.
- **Catalogs** (`i18n/dictionaries.ts`): one JSON file per surface per
  locale, merged at the top level — `locales/{hi,en}.json` (foundation:
  `brand.*`, `common.*`, `nav.*`, `auth.*`, `notFound.*`, `pagination.*`),
  `locales/marketing.{hi,en}.json`, `locales/customer.{hi,en}.json`,
  `locales/partner.{hi,en}.json` — all four ported verbatim from
  `legacy-next-src/locales/`. A surface agent may extend its own file freely;
  adding a new top-level namespace elsewhere requires touching
  `dictionaries.ts`'s merge.
- **Fonts:** Google Fonts `<link>` in `index.html` (Inter + Noto Sans
  Devanagari, `display=swap`), switched by `index.css`'s
  `html[lang='hi'] { font-family: var(--font-devanagari); }` — keyed off
  `<html lang>`, the same attribute `getClientLocale()` reads, so there is
  exactly one place that has to stay correct. Hindi body copy also gets a
  taller `line-height` (1.7) — Devanagari conjuncts crowd each other at Latin
  line-heights.
- **`buildLocalizedHref(locale, pathname)`** (`i18n/config.ts`) — the URL for
  `pathname` in `locale`; `hi` never prefixed, everything else is. Used by
  every guard redirect and by `LocaleToggle`.

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

Attaches the in-memory access token, sets `Accept-Language`, and on a
`401 AUTH_TOKEN_EXPIRED` calls the silent refresh and retries once. Throws
`ApiError` (`status`, `code`, `requestId`, `fieldErrors`) on any non-2xx —
render it with `<ErrorState>`.

**Pagination — the one quirk, isolated:**

```ts
paginationParams(page, pageSize, spelling?: 'page_size' | 'pageSize'): Record<string, QueryValue>
parsePage<T>(body: unknown, itemsKey: string): { items: T[]; page: number; pageSize: number; total: number }
```

Every paginated endpoint takes `page`/`page_size` **except** the Phase 4
verification queue, which takes `pageSize` — the one call site that needs it
passes `spelling: 'pageSize'` explicitly.

**TanStack Query:** `createQueryClient()` — 10s stale time, no retry on 4xx,
`refetchOnWindowFocus: false`. Mounted once in `main.tsx`.

**Session issuance (login/refresh/logout/admin two-step) does NOT go through
`apiRequest`** — it lives in `lib/auth/session.ts` and talks to the API
directly, because token issuance has its own rules (see Auth above).

## The ₹ util (`src/lib/money.ts`)

```ts
formatPaise(paise: number): string   // 125000 -> "₹1,250" (Indian digit grouping, no trailing .00)
parseRupeesToPaise(input: string): number | null
```

The **only** money formatter in this app — matches
`apps/api/src/modules/search/service.ts`'s `formatPaise` exactly. Money is an
integer number of paise everywhere; nothing else may call `toLocaleString` on
an amount.

## The design system (`src/components/ui`, barrel: `@/components/ui`)

Hand-rolled, no component library. Every interactive control enforces a
**44px touch target** and **16px+ text** (iOS Safari zooms the page on focus
below 16px). Icons: `lucide-react`, stroke width 1.75 by convention (2.25 for
an "active" state, 2.5 for spinners). Motion: 150ms transitions, no bounce.
**See `/design` (`routes/design/DesignSystemShowcase.tsx`) to review every
state of every primitive at a glance** — that page is the proof this system
actually looks the way this document claims.

| Export                                                 | Signature                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`                                               | `{ variant?: 'primary'\|'secondary'\|'danger'\|'ghost'; size?: 'sm'\|'md'\|'lg'; fullWidth?: boolean; loading?: boolean } & ButtonHTMLAttributes`                                                            |
| `Card`                                                 | `{ title?; actions?; children; className? }`                                                                                                                                                                 |
| `CardHeader`                                           | `{ title: ReactNode; subtitle?; actions? }`                                                                                                                                                                  |
| `StatTile`                                             | `{ label: string; value: string\|number; href?: string; hint?: string; delta?: number\|string; icon?: ComponentType<LucideProps> }` — `delta`'s colour is derived from its own sign, not caller-supplied     |
| `DetailRow`                                            | `{ label: string; children }`                                                                                                                                                                                |
| `Field`                                                | `{ label: string; hint?: string; error?: string\|null; children: (id: string) => ReactNode }` (render-prop)                                                                                                  |
| `TextInput` / `TextArea` / `Select`                    | standard HTML attributes, pre-styled                                                                                                                                                                         |
| `Modal`                                                | `{ title: string; onClose: () => void; children; width?: string }` — centred dialog on `sm:`+, bottom sheet below it                                                                                         |
| `Sheet`                                                | `{ open: boolean; title: string; onClose: () => void; children }` — ALWAYS a bottom sheet, never becomes a centred dialog                                                                                    |
| `Badge`                                                | `{ tone?: 'neutral'\|'success'\|'warning'\|'danger'\|'info'; children }` — a tag; no domain-specific status→tone mapping baked in                                                                            |
| `StatusPill`                                           | same tone vocabulary as `Badge`, plus a leading status dot                                                                                                                                                   |
| `Table`                                                | `{ columns: TableColumn<T>[]; rows: T[]; rowKey: (row: T) => string; empty?: { title?; hint? }; cardTitle?: (row: T) => ReactNode }` — a real `<table>` (sticky header) on `sm:`+, one card per row below it |
| `Pagination`                                           | `{ page, pageSize, total, onChange: (page: number) => void }`                                                                                                                                                |
| `Tabs`                                                 | `{ tabs: { value; label; badge? }[]; value: string; onChange: (value: string) => void }` — roving tabindex, arrow-key navigation                                                                             |
| `ToastProvider` / `useToast`                           | `useToast(): { show: (opts: { title; description?; tone?; durationMs? }) => void }` — provider mounted once in `main.tsx`                                                                                    |
| `Skeleton` / `SkeletonText`                            | `{ className? }` / `{ lines? }`                                                                                                                                                                              |
| `Avatar`                                               | `{ name?: string\|null; src?: string\|null; size?: number }` — initials fallback, never a broken-image icon                                                                                                  |
| `Spinner` / `EmptyState` / `ErrorState` / `QueryState` | loading/empty/error primitives; `QueryState` wraps a TanStack Query result's three states in one place                                                                                                       |

### App shells (`src/components/shell`)

- **`AdminShell`** — `{ navItems: AdminNavItem[]; activeHref: string; title: ReactNode; breadcrumbs?: Breadcrumb[]; userMenu?: ReactNode; children }`. Dark slate collapsible sidebar (desktop) / off-canvas drawer (below `md:`), sticky light topbar with breadcrumbs + title + user menu, `bg-slate-50` canvas. This is deliberately the one shell that is NOT mobile-first — the ops audience is at a desk.
- **`MobileAppShell`** — `{ title?; topBarActions?; tabs: MobileTabItem[]; activeKey: string; children }`. Compact sticky top bar + sticky bottom tab bar with icon + label + unread badge, `env(safe-area-inset-bottom)`-aware. Shared shape for `/app` and `/partner`; only the tab list differs.
- `RoleNav`, `SurfaceSwitcher`, `LocaleToggle` — the old minimal top bar and its pieces, ported. A starting point for a surface with no shell yet, not a fixture.

## Brand & design tokens (`src/brand/tokens.ts`)

The **one file** that changes to rebrand this app or retune its palette:
`APP_NAME` (from `VITE_APP_NAME`, defaulting to `@fixbridge/shared`'s
`DEFAULT_APP_NAME`), `brandColors` (primary teal `#0f6e5c`, accent),
`semanticColors` (`success`/`warning`/`danger`/`muted`/`surface`/`border`),
`<BrandLogo>` (monogram placeholder), `<BrandStyleVars>` (writes every token
above onto `:root` as CSS custom properties — `tailwind.config.ts`'s
`brand`/`success`/`warning`/`danger`/`muted`/`surface`/`border` colours all
point at those variable names, never a literal hex). Copy (tagline, meta
description) lives in i18n (`brand.*` keys) — this module only names which
keys those are (`BRAND_COPY_KEYS`).

## Testing

Vitest 3.2.7 + React Testing Library, `jsdom`.

- `src/test/setup.ts` — RTL `cleanup()`, the auth module's in-memory +
  `localStorage` state reset, a `crypto.randomUUID` polyfill, mock/env
  teardown.
- `src/test/harness.tsx` — `mockApi(routes)` (fetch mocked at the boundary,
  keyed `"METHOD path"` — matches on pathname only, since every call now
  goes straight to the API with no local proxy layer), `waitForCall`,
  `renderWithQuery`, `sessionBody()`.
- `src/test/auth-silent-refresh.test.ts` — the single-flight refresh
  guarantee, plus login/OTP.
- `src/test/refresh-token-storage.test.ts` — replaces the old
  `session-cookie-flags.test.ts` (that mechanism no longer exists). Asserts
  the refresh token lands in the expected `localStorage` key, the access
  token never does, and `logout()` clears both.
- `src/test/i18n-toggle.test.tsx` — `LocaleToggle` computes the correct
  cross-locale URL in both directions, via `MemoryRouter`.
- `src/test/login-phone.test.tsx` — the masked-phone regression test.

## Mobile-first

The design target is a ₹8,000 Android phone on 4G — desktop is the
adaptation (the one deliberate exception: `AdminShell`, built for a desk).
Concretely: 44px touch targets, 16px+ form text, `font-display: swap`,
`refetchOnWindowFocus: false`, every list built to paginate rather than
render everything at once, and every surface lazy-loaded so a first-time
marketing visitor never downloads the admin console's code.

## The old Next.js tree

Gone. It lived at `legacy-next-src/` as read-only reference while the four
surfaces were ported, and was deleted once every route had a live
counterpart (marketing 9, customer 10, partner 10, admin 14 + login).

Source comments across the app still cite `legacy-next-src/...` paths as
provenance — "ported from X". Those are deliberate history, not broken
links: they say where a non-obvious business rule came from, which is worth
more than a path that resolves. Git history has the files if a decision ever
needs re-litigating.

## Deployment (`vercel.json`)

`vercel.json` deliberately contains **no comments** — not even the `"//"` key
convention. Vercel validates the file against a strict schema and rejects any
property it does not recognise, so a `"//"` key fails the whole deployment with
`should NOT have additional property '//'`. The explanation therefore lives
here instead.

**`rewrites`** is what makes deep links work. This app is a Vite SPA: every
route below `/` is resolved in the browser by the router, not by a file on
disk. Without the rewrite, loading or refreshing `/en/download` asks Vercel for
a file at that path, finds none, and returns 404 — which is why the site worked
while navigating but broke the moment anyone reloaded or opened a link
directly. Vercel checks the filesystem before applying rewrites, so real assets
still serve normally.

**`headers`** covers two things the defaults get wrong:

- APKs need `application/vnd.android.package-archive`, or the browser saves
  them as a text file the phone will not install. `must-revalidate` stops a
  stale build being served after a release.
- Vite fingerprints filenames under `/assets`, so a changed file gets a new
  name and the old one can be cached permanently.
