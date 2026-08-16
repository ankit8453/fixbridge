# Phase 11 — Admin dashboard (the ops cockpit)

## 1. Goal

Manual-first was a frozen decision, and the right one: verification, complaints,
suspensions, payouts and dues all route through human judgment. Ten phases later
that human still had only `curl`.

Two principles governed everything built here. **Every screen answers "what needs
my attention?"** rather than presenting a table. And **every action leaves a
trace** — because each of these decisions is one person's opinion about another
person's livelihood, and an opinion nobody wrote down is one nobody can be
answerable for. "Ops said so" is not an answer you can give a technician whose
account you closed.

## 2. What was built

### The audit backbone

`audit_logs`: actor, action, target, the decision's **substance**, IP and request
id. Append-only by database trigger, with exactly one permitted `UPDATE` —
nulling the actor for DPDP erasure, so the record of a decision survives the
erasure of the person who made it. The same reasoning as the ledger, and the same
trap avoided that `ledger_journals` fell into in Phase 8.

`core/audit.ts` holds the closed action vocabulary and `AUDITED_ADMIN_ROUTES` — a
registry of every admin mutation. A test walks the **real Express router stack**
and compares the two in both directions.

It was retrofitted onto every pre-existing ops mutation: verification review and
decide, complaint take-up/resolve/dismiss, review hide/unhide, suspend/reinstate/
recompute, payout create/paid/failed/close, dues settlement, refunds, block and
unblock.

### The backend gaps, closed

- **Users** — search by phone fragment or name; block/unblock with a mandatory
  reason, cutting access off immediately rather than at token expiry.
- **Providers** — list with filters, and the aggregate the provider page is built
  from: completeness, verification, trust breakdown, suspension, wallet, dues,
  price cards, recent cases and bookings, plus a `visibility` object answering
  the **five gates separately**.
- **Bookings** — one search box taking a booking id _or_ either party's phone; the
  full dispute timeline; **OTP unlock**; ops-cancel.
- **Money** — ledger browser, journal detail, batch list, batch close, and the
  revenue/GMV summary.
- **Queues** — parked outbox, failed webhooks and parked notification deliveries,
  each with retry and discard-with-reason.
- **Cities** — the `require_entry_approval` flag and its pending-approval queue.

### The console

`apps/admin` — Vite + React + TypeScript + Tailwind, React Router, TanStack
Query, hand-rolled UI primitives rather than a component kit. Ten routes:
Overview, verification queue and case, providers list and detail, bookings search
and timeline, complaints, review reports, money (batches, dues, ledger browser),
the three parked queues, the audit viewer, and login.

Loading, error and empty states on every query; no optimistic updates
(invalidate and refetch — correctness first); a confirmation dialog with the
reason field **inline** on every destructive or money action; one money formatter
in the whole application.

## 3. Key decisions and deviations

**The audit row moves into the mutation's transaction, not the other way round.**
Prisma has no nested interactive transactions, so wrapping ten existing services
in an outer transaction was not possible — and would have been the wrong shape
anyway, since each already opens exactly the right one. Instead the services grew
an optional `audit` field on their deps and write the row inside their own
transaction. Optional because the same services are called by jobs, by the outbox
and by tests, where there is no human actor and an audit row would be a lie.

**Coverage is enforced by walking the router stack, not by a checklist.** A list
somebody maintains by hand is a list that rots. This compares the registry
against the routes Express actually has, both ways, so an unaudited mutation
cannot ship and a stale entry cannot linger.

**Every ops mutation takes a mandatory reason.** Not ceremony. In six months the
note is the only thing that will exist.

**The refund route moved** from `/api/v1/payments/:id/refund` to
`/api/v1/admin/payments/:id/refund`. It was always ops-only behind a role check,
but it sat outside the prefix the coverage test enumerates — a money mutation
escaping that net is precisely the hole the test exists to close.

**Reinstating now needs a reason too**, for symmetry with suspending. "Ops let
them back on" with no note is not an answer either.

**OTP unlock does not reissue the codes.** Phase 6 locked the handshake after five
wrong attempts and deliberately refused to hand out a new code — the whole point
is that a specific person is at a specific door. Only the attempt counter is
cleared, so the slip the customer is holding still works. The mandatory note is
the entire control: without it, an unlock is indistinguishable from somebody
clicking a button because a queue looked untidy.

**Ops-cancel is not a bypass.** It obeys the same state machine a customer's
cancel does and is refused once the technician has arrived, because at that point
work has begun and money may be owed. A button that could make a bill disappear
would be a way to lose money quietly.

**Discard never deletes.** A discarded outbox event or webhook is marked processed
with the reason recorded. The row is the evidence that something was published
and never delivered; deleting it would erase both the fact and the decision.

**`action` is a TypeScript union, not a Postgres enum.** A new ops capability
would otherwise need a migration simply to name itself, and that friction pushes
people to reuse a near-enough existing action — which is how an audit log stops
being readable.

**Entry approval ships off.** The pilot cannot afford a human in the path of every
signup, and completeness plus verification already keep an unverified profile out
of search. With the flag off the queue is simply empty, so the feature costs
nothing until the first city where we do not know the trades personally.

**CORS is hand-rolled, ~40 lines.** One origin, three headers and a preflight does
not justify a dependency to keep patched, and the `cors` package's permissive
defaults are a common way an API ends up answering everybody. It is documented as
a convenience, not a security boundary — the real guard is the role check.

**The console's access token never touches storage.** It lives in a module
variable and dies with the tab. This is the credential that can suspend a
technician and move money; putting it in `localStorage` hands it to any script
that ever reaches this origin. The refresh token does go to storage — it is
single-use, device-bound, and its reuse is treated as theft by the API, which
makes the trade worth surviving a page reload for.

**A non-ops user is refused at the door, in words.** The server already `403`s
them on every admin route, so the risk is not access — it is a console full of red
error states that reads like an outage. They are told they are in the wrong place
and their session is discarded rather than left sitting in this origin's storage.

**The provider page renders trust _inputs_, not a fabricated breakdown.** The
aggregate returns the stats row, not the weighted components that
`/providers/me/trust` computes. Rather than invent weights that might disagree
with the real scorer, it shows the ratings, acceptance record, cancellations and
upheld complaints that feed it. Wiring the genuine component array into the
aggregate is noted as follow-up.

**One answer per money question.** The console's revenue tiles come from
`/admin/summary` rather than also calling `/ledger/position`; two paths to the
same number eventually disagree, and ops would have to decide which to believe.

## 4. Assumptions and missing inputs

- **No role-editor UI.** Roles are granted in the database for the pilot, as the
  prompt specifies. `admin` is the owner, `ops` is staff; they see the same
  console today. When ops hiring makes the distinction matter, `admin` is the
  natural place to put role granting.
- **Admin UI is English-only.** It is an internal tool. Hindi is a later decision
  if ops hiring needs it.
- **No browser e2e suite.** Documented as a Phase 15 candidate with Playwright if
  pilot ops volume justifies it.
- **OTP-locked bookings are counted by scanning Redis keys.** The lock lives with
  the code, in Redis with a TTL, because Phase 6 kept handshake codes out of
  Postgres. At pilot volume that is a handful of keys; at scale it wants a set.
- **The summary endpoint is uncached.** An ops screen showing a number that was
  true five minutes ago is worse than a slower one showing the truth.
- **Seeded parked rows are scenery.** Two deliberately stuck rows so the queues
  are not all zero on a fresh clone. Nothing depends on them.
- **Four admin endpoints have no screen**: `/admin/users`, `/admin/cities`, the
  refund, and force-recompute. All are reachable and tested; none of them is one
  of the ten pages the phase specified. Users and cities are the obvious next two
  screens.
- **Two pagination spellings survive.** Phase 4's verification queue takes
  `pageSize`; everything since takes `page_size`. Both schemas are `.strict()`, so
  the wrong one is a `400` rather than a silent default. The console isolates the
  quirk in one file; unifying it is an API change worth making deliberately rather
  than as a side effect of this phase.

## 5. Verification results

```
npm run typecheck      clean  (both apps)
npm run lint           clean  (both apps)
npm run format:check   clean
npm run build          clean  (api + admin, 295 kB JS / 88 kB gzip)
API tests              992 passed / 992 across 50 files
Console tests          8 passed / 8 across 4 files
```

**One flake, reported rather than buried.** Five full API runs were made; four
were clean at 992/992. The one failure came in a run that took **269s against a
normal ~140s**, because it was competing with the console's `npm install` and
Vite build on the same machine — the suite has a 15s per-test timeout and its
integration tests make a dozen HTTP round trips each. I could not identify the
failing test (the output filter truncated the name) and it did not reproduce in
four subsequent runs, including three back to back. My assessment is timeout
under load rather than a defect, but it is an assessment, not a proof, and it is
worth watching on the next phase's runs.

**Fresh-database verification.** All 13 migrations applied to an empty database
produce an object inventory identical to the incrementally migrated dev database
— 137 indexes, 22 triggers, 60 CHECK constraints, 5 views, 1012 functions. All 16
hand-written raw-SQL indexes survive, including the nine `prisma migrate diff` has
proposed dropping since Phase 3 and the new partial `provider_profiles_pending_entry_idx`.

The append-only trigger was exercised directly on the fresh database:

```
UPDATE audit_logs SET action='other';
  ERROR: audit_logs is append-only: row 083b93e6-… may not be modified
DELETE FROM audit_logs;
  ERROR: audit_logs is append-only: DELETE is not permitted (id=083b93e6-…)
```

**Seed idempotency.** Second run reports `0` for every section.

Proved end to end (29 new integration tests plus 5 coverage tests):

- A customer gets `403` on **every** admin path, including ones added later — the
  guard is applied once at the top of the router, and the test asserts the
  property that arrangement buys. A technician too; anonymous gets `401`.
- The audit row carries actor, target, substance and request id.
- **The rollback proof**: `markPayoutFailed` writes its audit row first, inside
  the transaction, then discovers the payout is already settled and throws. The
  audit row genuinely existed for a moment — and the rollback took it with the
  failed decision. Neither the row nor the change survives.
- The audit table refuses `UPDATE` and `DELETE` through Prisma as well as psql.
- OTP unlock: five wrong codes lock the handshake; unlock without a note is
  `400`; unlock on an unlocked booking is `409`; after unlocking, the **original**
  code still works.
- Ops-cancel succeeds before arrival and is `409` after the job has started.
- Dues settlement posts a balanced `dues_settled` journal and zeroes the dues.
- Payout: close is `409` while a line is pending; mark-paid records the UTR in the
  audit payload and posts a balanced payout journal; then the batch closes.
- Hiding a reported review drops it out of the aggregate — average back to null,
  count back to zero.
- A parked delivery retried through the console actually reaches the transport.
- A failed webhook is re-published rather than applied inline.
- Turning on entry approval fills the queue; approving records who and when.

**Two test errors of mine, both corrected against the code:** an expected `409`
that was really a `404` on a non-existent payout (which proved nothing about
rollback, so the test was rebuilt around a real in-transaction failure), and a
teardown that tried to `DELETE` from the append-only audit table — the trigger
was right and the teardown was wrong.

## 6. Next steps

**Phase 12** is the Next.js customer web app at `apps/web` — SEO-first Hindi
landing pages, the APK download page, DPDP privacy/terms, and the full logged-in
booking experience through Razorpay web checkout.

Waiting after that:

- **A role-editor screen**, once there is more than one ops person. Today `admin`
  and `ops` see the same console and roles are granted in the database.
- **Users and cities screens** — the two admin endpoints without a page.
- **The real trust component array** on the provider aggregate, so the console can
  render the same breakdown a technician sees rather than the raw inputs.
- **One pagination spelling** across the API.
- **Playwright e2e** for the console if pilot volume justifies it (Phase 15).
- **Hindi in the console**, if ops hiring needs it.
- **The OTP-locked count** wants a Redis set rather than a key scan before
  volume makes the scan expensive.
