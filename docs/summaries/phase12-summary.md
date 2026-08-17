# Phase 12 — The web platform (four surfaces, one SPA)

## 1. Goal

Eleven phases built a marketplace nobody outside a terminal could use. This
phase makes it a thing you can send someone a link to.

Four surfaces, one deployment: the public marketing site, the customer booking
app, the partner (technician) app, and the ops console folded in from
`apps/admin`. The design target was never "a website" — it was a
WhatsApp-forwarded link opening on a ₹8,000 Android phone over 4G, landing on
something that looks trustworthy enough to hand money to a stranger through.

## 2. What was built

### Four surfaces, four front doors

| Surface     | Path       | Sign-in          | Who                                     |
| ----------- | ---------- | ---------------- | --------------------------------------- |
| Marketing   | `/`        | —                | public, indexed, Hindi-first            |
| Customer    | `/app`     | `/login`         | any signed-in user                      |
| Partner     | `/partner` | `/partner/login` | technicians                             |
| Ops console | `/admin`   | `/admin/login`   | ops / admin only, noindex, English-only |

Separate login routes per surface, on explicit instruction. They are **siblings
of** the guarded routes, never nested inside them — a login page mounted under
a route its own guard protects redirects to itself forever.

Each surface is `React.lazy`-loaded. A marketing visitor never downloads the
admin console: `MarketingEntry` is 26 kB against the console's 82 kB.

### Two-factor sign-in for staff

The console no longer shares the customer's OTP-only door. Staff present an ID
and password, and only then the OTP — `POST /auth/admin/password` returns a
**challenge, never a session**, so a leaked password is half an access attempt
rather than an entry.

Passwords are scrypt (Node stdlib — no new dependency), stored
`scrypt$N$r$p$salt$hash` so the cost parameters travel with the hash and can be
raised later without a migration. Two database triggers enforce what
application code should not be trusted to remember: only `ops`/`admin` accounts
may hold a password at all, and losing the role wipes it.

Both rate limits — per login id and per IP — are consumed **before** the
password is checked, so an attacker cannot spend a real user's budget probing.
Unknown accounts are compared against a dummy hash so they cost the same
wall-clock time as real ones, and wrong-password, unknown-account and
not-staff all return the identical error.

### Two API endpoints the web app proved were missing

- **`GET /providers/:providerId`** — the public profile. Previously the client
  cached a search result in `sessionStorage`, so a cold WhatsApp link rendered
  a degraded "please search again" page. It applies the same four gates as
  search, and `404`s identically for suspended and nonexistent.
- **`GET /providers/me/slots`** — a technician's own week including blocked and
  booked hours. Phase 6 shipped a block button and no way to see what had been
  blocked, so un-blocking only worked in the browser session that did the
  blocking. The calendar was write-only for six phases.

### The ops/admin split (Phase 11 carry-over)

Split on **reversibility, not seniority**. `ops` does the judgment work all day;
`admin` alone may refund, mark a payout paid, settle dues, or change city
config. `ADMIN_ONLY_ROUTES` is enumerated in `core/audit.ts` and CI-enforced.
The console **hides** admin-only controls from ops users rather than disabling
them — a disabled button is a description of what you are not trusted with.

## 3. Key decisions & deviations

**The stack is Vite + React, not Next.js.** The brief specified Next.js (App
Router), and Next.js is what was built first — all four surfaces, working. It
was then converted. The owner builds their other project in React on the same
machine, found Next's dev server too slow even on Turbopack, and said plainly
they could not scale or maintain a Next codebase. A framework the founder
cannot work in is a real cost whatever its technical merits. The conversion was
their explicit, repeated instruction after the trade-offs below were stated.

**What that cost, stated plainly:**

- **The refresh token moved from an httpOnly cookie to `localStorage`.** The
  brief mandated httpOnly, and it was implemented that way — via Next route
  handlers running server-side. An SPA has no server, so those handlers have no
  home. This is **genuinely weaker, not equivalent**: page JavaScript can now
  read the refresh token, so an XSS becomes a session theft rather than a
  contained incident. Documented at the point of use in `lib/auth/session.ts`
  rather than buried here. The honest fix is a small token-broker endpoint on
  the API, and it is the first thing to revisit in Phase 15.
- **The marketing site lost server rendering.** No SSG/ISR, so crawlers get an
  empty container and a forwarded link paints only after JS boots — precisely
  the ₹8,000-phone case the brief cares about. JSON-LD, OpenGraph, hreflang,
  sitemap and robots.txt are all still emitted, but by client-side JS. Fixable
  later by pre-rendering just the nine marketing routes; not fixable by
  choosing different React code.

**`apps/admin` is deleted**, per the brief. Its phase summaries stay.

**The old Next tree is deleted too.** It lived at `legacy-next-src/` as
read-only reference while porting, and was removed once every route had a live
counterpart (marketing 9, customer 10, partner 10, admin 14 + login). Source
comments still cite `legacy-next-src/...` paths as provenance — deliberate
history, not broken links: they record where a non-obvious business rule came
from, which outlives a path that resolves.

**Four agents worked in parallel**, one per surface, over a shared foundation
(router, auth, i18n, API client, design system, shells). Per-surface locale
catalogs (`marketing.hi.json`, `customer.hi.json`, …) rather than one shared
file, specifically so concurrent agents could not conflict on it.

**`/admin/login` is pinned to English.** The console is English-only by
decision, and every string in `surfaces/admin/**` is hardcoded English — but
this one screen read the locale from the URL, so the unprefixed `/admin/login`
rendered Hindi and flipped to English the moment sign-in succeeded.

## 4. Assumptions & missing inputs

- **`sitemap.xml` still points at `https://example.com`.** Not an oversight —
  the brand and domain are undecided, and a sitemap pointing at a wrong origin
  is worse than none. One find-replace once the domain exists; the file says so
  in its own comment.
- **Privacy and terms contain `[...]` placeholders** for the operating entity's
  legal name, address and grievance officer. These need a lawyer, not an agent,
  before launch.
- **OTP delivery is still the dev fixed-OTP path** (`000000` for `+9199999…`).
  Real delivery waits on DLT registration — Phase 15.
- **`ProviderHeader` shows a skill `slug`, not a localized name.** The public
  profile endpoint returns `nameKey`/`slug` rather than a pre-resolved display
  name the way search does. Cosmetic; worth closing when convenient.
- **No browser click-through was performed.** Verification below is typecheck,
  lint, build and automated tests only. Playwright golden-path and a Lighthouse
  mobile score remain outstanding.

## 5. Verification results

| Check                       | Result                                              |
| --------------------------- | --------------------------------------------------- |
| API tests                   | **1001 passed** / 1001, 50 files                    |
| Web tests                   | **56 passed** / 56, 14 files — green on repeat runs |
| Typecheck (api + web)       | clean                                               |
| ESLint (repo)               | clean                                               |
| Prettier (repo)             | clean                                               |
| Production build            | 1819 modules, four code-split surface bundles       |
| Fresh-DB migration parity   | **identical** — see below                           |
| Seed idempotency            | **identical** row counts across 12 tables on re-run |
| Aadhaar raw-number tripwire | 5/5 passed                                          |

**Fresh-database migration parity** deserves its own note, because this repo has
a standing hazard: `prisma migrate diff` proposes dropping 9 raw-SQL indexes
every single phase, and every migration is hand-edited to remove those DROPs. A
single missed hand-edit would leave a freshly-deployed production database
missing an index that dev has had all along, and nothing in the test suite would
notice. Applying every migration to an empty database and diffing against the
working one:

```
indexes     137 identical
triggers     24 identical
checks       60 identical
fks          59 identical
tables       43 identical
enums       154 identical
extensions    4 identical
```

Twelve phases of hand-edited migrations reproduce the dev schema exactly.

**Two bugs found and fixed during integration**, neither caught by the agents
that wrote the surrounding code:

1. **A dead catch-all route.** `router.tsx` declared `path: '*'` twice — the
   marketing wildcard and a `NotFound`. React Router ranks by specificity and
   the first equally-ranked wildcard wins, so the second was unreachable. Real
   404s were already handled correctly one level down inside `MarketingEntry`
   (and render better there, inside the marketing chrome), so the dead route was
   removed rather than reordered. Verified by probing `matchRoutes` directly
   against ten paths rather than by reasoning about precedence.
2. **A regression guard that failed only when the suite was busy.**
   `login-phone.test.tsx` — the test protecting the masked-phone login bug the
   owner personally hit — takes ~5s alone but 11–13s under parallel workers on
   this 12-core machine, tripping the 10s default. It was reported as
   "environmental flakiness"; it is deterministic CPU contention. Given a 30s
   budget for that file only, with the reasoning recorded in the test. A guard
   that cries wolf when the suite is loaded is worse than no guard, and raising
   the global timeout would have weakened every other test to fix one.

## 6. Next steps

**Before launch (Phase 15 or sooner):**

1. **Move the refresh token off `localStorage`** — a token-broker endpoint on
   the API restores the httpOnly posture the brief asked for. The single
   biggest security regression in this phase.
2. **Pre-render the nine marketing routes** so crawlers and cold WhatsApp links
   get HTML. Recovers the SEO the framework change cost, without reintroducing
   a framework the owner cannot maintain.
3. **Legal copy** — privacy/terms placeholders need the real entity details.
4. **Real domain** into `sitemap.xml`, `robots.txt` and the OG/canonical tags.

**Verification still owed:** a Playwright golden-path spec (chromium, mobile
viewport — search → book → pay → review) and a Lighthouse mobile score for the
homepage. Both were scoped for this phase and are not done.

**Phase 13** is the Flutter customer app, against the same `/api/v1` this web
app consumes — including the two endpoints this phase added.
