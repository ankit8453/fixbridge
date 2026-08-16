# Operations console

The internal ops/admin web console — a **Vite + React 18 + TypeScript** SPA over
the API's `/api/v1/admin` module. Phase 11.

```bash
cp .env.example .env        # Windows: copy .env.example .env
npm run dev:admin           # from the repo root — http://localhost:5173
```

The API must be running on `VITE_API_URL` (default `http://localhost:3000`).
In development the login screen prints the seeded ops and admin phone numbers
and the fixed OTP; that block is compiled out of a production build.

| Command                                          | Does                             |
| ------------------------------------------------ | -------------------------------- |
| `npm --workspace @fixbridge/admin run dev`       | Vite dev server on port 5173     |
| `npm --workspace @fixbridge/admin run build`     | `tsc --noEmit` then `vite build` |
| `npm --workspace @fixbridge/admin run typecheck` | `tsc --noEmit`                   |
| `npm --workspace @fixbridge/admin run test`      | Vitest + Testing Library         |

---

## Decisions worth knowing before you edit this

**Not Next.js, and no UI kit.** This console is signed-in-only, indexed by
nobody and rendered for about a dozen people. Server rendering buys it nothing
and a design system would buy it a dependency with its own upgrade cycle in
exchange for components we would immediately constrain to one look. The
primitives in `src/components/ui/` are hand-rolled and deliberately small; if one
grows a third variant that a single screen uses, it belongs on that screen.

**The access token never touches storage.** It lives in a module variable in
`src/lib/api.ts` and dies with the tab. This console holds the credential that
suspends technicians and marks payouts paid — putting that in `localStorage`
hands it to any script that ever reaches this origin. The refresh token does go
to `localStorage`: it is single-use, device-bound, and the API treats its reuse
as theft, so it survives a reload without being a standing liability.

**The role gate refuses at the door.** A customer or technician can complete the
same OTP login. The server would 403 every `/admin` route for them, so the risk
is not access — it is a console full of red errors that reads like an outage.
`src/auth/AuthProvider.tsx` refuses them in words and discards their tokens.

**No optimistic updates, anywhere.** Every mutation invalidates and refetches
(`src/lib/mutations.ts`). Several of these are refused by the server for reasons
the client cannot predict — a booking that is no longer locked, a batch somebody
else closed, a UTR a database CHECK rejects. A row that says "paid" and quietly
reverts is a screen that lied to ops about money.

**Every destructive action is confirmed, with the reason inside the dialog.**
`ConfirmDialog` takes the note field rather than asking for it afterwards,
because the API makes a note mandatory on all of these and a two-step flow makes
"confirm" the decision and the note an afterthought.

**One money formatter.** `src/lib/money.ts` `formatPaise` and nothing else. Two
formatters drift, and the day they disagree an ops user has to decide which
screen to believe about a payout.

**English only.** No i18n layer — this is an internal tool for our own team, and
the API is called with `Accept-Language: en`. If ops hiring ever makes Hindi the
working language of the room, the change is that header plus a translation
layer, not a rewrite. That decision is deliberately deferred, not ruled out.

**Filters live in the URL.** `useFilters` reads and writes search params so the
overview's tiles can link to a filtered list and so an ops user can paste an
address into a chat window and have a colleague see the same rows.

---

## Layout

```
src/
  api/          endpoints.ts (every URL this app calls) · types.ts (response shapes)
  auth/         AuthProvider — session restore, the role gate, sign-out
  components/   Layout, ConfirmDialog, BookingTimeline, Timestamp
    ui/         Button, Card, Table, Badge, Field, Modal, Pagination, States
  lib/          api (fetch + refresh + errors) · money · time · filters · mutations
  pages/        one file per route
  test/         harness.tsx (fetch mocked at the boundary) + four flow tests
```

## Pagination parameter names

The API's list endpoints disagree, because each module's Zod schema is `.strict()`
and rejects the other spelling with a `400`:

| Endpoint                         | Page size parameter |
| -------------------------------- | ------------------- |
| `/admin/verification/queue`      | `pageSize`          |
| everything else (Phase 9 and 11) | `page_size`         |

That disagreement is confined to `src/api/endpoints.ts`. Nothing else in the app
constructs a URL.

## Response envelopes

Lists come back as `{ <items>, page, pageSize, total }` where `<items>` differs
per endpoint. `toPage()` in `src/lib/api.ts` prefers the documented key and falls
back to whichever property is an array — a console that silently renders an empty
queue because a key was renamed is worse than one that is slightly clever about
finding the rows.

## Tests

`npm --workspace @fixbridge/admin run test`. `fetch` is replaced with a route
table keyed by `"METHOD /path"`, so the assertions are about which endpoint was
called with which body — the real risk being a well-formed request to the wrong
place. Four flows are covered: login and the role gate, deciding a verification
case, marking a payout paid, and resolving a complaint.
