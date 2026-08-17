# The web app

One Vite + React single-page application at [apps/web](../apps/web) serving all
four surfaces. This document covers the cross-cutting decisions — auth, i18n,
routing, and the SEO posture. Per-surface implementation notes live in
[apps/web/README.md](../apps/web/README.md).

## Why Vite and not Next.js

Phase 12 built all four surfaces in Next.js (App Router) first, as its brief
specified, and then converted them to Vite. The owner builds their other project
in React on the same machine, measured Next's dev server as too slow even after
Turbopack, and stated they could not scale or maintain a Next codebase.

That is a legitimate reason and it was their call to make, but it was not free.
Two things were lost, and both are recorded here rather than in a commit message
nobody will read:

1. The refresh token moved out of an httpOnly cookie — see below.
2. The marketing site lost server rendering — see [SEO](#seo).

Do not propose reintroducing Next.js. Both costs are recoverable by other means.

## Surfaces

| Surface     | Path       | Sign-in          | Guard                    | Indexed |
| ----------- | ---------- | ---------------- | ------------------------ | ------- |
| Marketing   | `/`        | —                | none                     | yes     |
| Customer    | `/app`     | `/login`         | `RequireAuth`            | no      |
| Partner     | `/partner` | `/partner/login` | `RequireAuth`            | no      |
| Ops console | `/admin`   | `/admin/login`   | `RequireRole(ops,admin)` | no      |

Each surface has its **own sign-in route** rather than one shared login page.

The login routes are **siblings of** the guarded routes, not children. Nesting a
login page inside a route its own guard protects produces a redirect loop: the
guard bounces the signed-out visitor to a login page that is itself guarded.

`/partner` guards on `RequireAuth`, deliberately **not** `RequireRole('technician')`
— a signed-in customer must be able to reach the surface to see the "become a
partner" pitch and call `POST /providers/me/register`. Bouncing them back to
`/partner/login` when they are already signed in is a dead end.

Every surface is `React.lazy`-loaded. A first-time marketing visitor on 4G
downloads 26 kB of marketing code, not the 82 kB ops console.

## Auth

### The token split

- **Access JWT — in memory only.** Never persisted. Lost on refresh, which is
  fine; the refresh token rebuilds it.
- **Refresh token — `localStorage`.** See the warning below.
- **Device id — `localStorage`.** Not a secret; it identifies a browser across
  sessions so refresh-token rotation can be scoped to one device.

> **⚠ The refresh token in `localStorage` is a known, accepted weakening.**
>
> Phase 12's brief mandated an httpOnly, Secure, SameSite=Lax cookie, and the
> Next.js implementation did exactly that with thin server-side route handlers
> at `/api/session/{login,refresh,logout}`. An SPA has no server, so those
> handlers have nowhere to run.
>
> The consequence is concrete, not theoretical: page JavaScript can now read the
> refresh token, so a single XSS escalates from a contained incident to full
> session theft with a long-lived credential. This is **weaker, not
> equivalent**.
>
> The fix is a small token-broker endpoint on the API that sets the cookie
> itself — it does not require a frontend framework change. It is the first
> security item in Phase 15.

### Silent refresh

A `401` triggers one refresh attempt, **single-flight**: concurrent 401s from
parallel queries wait on the same in-flight refresh rather than each firing
their own and racing token rotation into a self-inflicted logout. On refresh
failure the session is cleared and the visitor is sent to the sign-in route for
the surface they were on — a customer to `/login`, a technician to
`/partner/login`, staff to `/admin/login`.

### Staff sign-in is two-factor

The console does not share the customer's OTP-only door.
`POST /auth/admin/password` → challenge → `POST /auth/admin/verify` → session.
Password alone never issues a session. Full endpoint semantics, including the
timing-equalisation and rate-limit ordering, are in
[API.md](API.md#post-apiv1authadminpassword).

### Signing in locally

The dev fixed-OTP path (`AUTH_FIXED_OTP=000000`, phones starting `+9199999`)
covers every surface. Each login screen renders the relevant dev credentials
inline, gated on `import.meta.env.DEV`, so nothing needs hunting in logs:

| Account  | Login                                              |
| -------- | -------------------------------------------------- |
| Customer | any `+9199999…` phone · OTP `000000`               |
| Ops      | `+919999900002` · `SEED_STAFF_PASSWORD` · `000000` |
| Admin    | `+919999900001` · `SEED_STAFF_PASSWORD` · `000000` |

`SEED_STAFF_PASSWORD` is refused outright by the config schema when
`NODE_ENV=production`, the same structural guard as the fixed OTP. Unset, the
seeded staff accounts simply have no password and cannot use the console's
password step — the correct default for anything that is not a laptop.

## i18n

Hindi is the default and lives at `/`; English lives under `/en`. The active
locale is derived from the **URL pathname**, not a context provider — the URL is
already the single source of truth and `useLocation()` recomputes on navigation
for free.

`/hi/...` redirects to the unprefixed equivalent so the default locale never has
two canonical URLs for one page, which would split ranking signal on the
marketing surface.

Copy lives in **per-surface catalogs** (`marketing.hi.json`, `customer.hi.json`,
`partner.hi.json`, plus a shared `hi.json`/`en.json`). One file per surface
rather than one shared file, so four agents building four surfaces in parallel
cannot conflict on it.

**The ops console is English-only**, including its login screen, which is pinned
with `createTranslator('en')` rather than `useT()`. `adminRequest` also pins
`Accept-Language: en` so server-rendered errors match the UI around them.

Localized category and service names come from the **API**, not the web
catalogs — `Accept-Language` follows the active locale, and a signed-in user's
`preferred_language` is synced when they toggle.

## SEO

Applies to the marketing surface only. `/app`, `/partner` and `/admin` are
`noindex` and client-rendered by design.

Emitted: full metadata, OpenGraph, JSON-LD (`LocalBusiness` + `Service`),
hreflang `hi`/`en`/`x-default`, `sitemap.xml`, `robots.txt`.

> **The marketing site is client-rendered.** The Next.js version was SSG/ISR;
> the SPA is not. Crawlers receive an empty container, and a WhatsApp-forwarded
> link paints only after JS boots — exactly the ₹8,000-phone-on-4G case the
> product cares most about. The metadata above is all still emitted, but by
> client-side JavaScript, which not every crawler executes.
>
> The fix is pre-rendering the nine fixed marketing routes at build time. It
> does not require changing frameworks.

**`sitemap.xml` currently points at `https://example.com`.** Deliberate: the
brand and domain are undecided, and a sitemap pointing at the wrong origin is
worse than no sitemap. One find-replace once the domain exists.

## Environment

```bash
VITE_API_URL=http://localhost:3001        # the API; note :3001, not :3000
VITE_RAZORPAY_KEY_ID=rzp_test_…           # key id only — NEVER the secret
```

The dev server is fixed to **:3000** and the API moved to **:3001** in this
phase, so the app people actually type a URL into keeps the port they expect.
The API's `WEB_ORIGIN` must match the web origin exactly — CORS is an
exact-match allow-list, not a pattern.

## Running it

```bash
npm run dev:web          # :3000, expects the API on :3001
npm --workspace @fixbridge/web run build
npm --workspace @fixbridge/web run test
```
