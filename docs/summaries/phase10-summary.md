# Phase 10 — Notifications

## 1. Goal

Nine phases of machinery that never once opened its mouth. A booking request a
mistri never heard about expired. A suspension nobody explained lost a technician
forever. A cash payment the customer was never told about was an invitation to
fraud.

This phase is retention and fraud-sunlight infrastructure. Two routes carry most
of that weight — `payment.cash_recorded` and `provider.suspended` — and they are
the two the rest of the design exists to serve.

## 2. What was built

**Carry-overs first.**

`preferred_language` on `users` (`hi` | `en`, default `hi`), settable via
`PATCH /api/v1/auth/me`. Existing rows are backfilled by the column default,
which is the correct backfill: the launch city is Jabalpur.

A **scheduled trust recompute** — Redis-locked, on an interval, rescoring every
technician whether or not anything happened to them. It closes a structural blind
spot rather than a bug: a technician who stops working generates no events, so
the recency component that exists to decay freezes on the day they went quiet.
Snapshots are written only when the score actually moves.

**Migration `20260817090000_add_notifications`** — hand-written after removing
nine proposed `DROP INDEX` statements, the ninth phase running. Adds
`notifications`, `notification_deliveries`, four enums, and the `preferred_language`
column. No append-only trigger on either table: a notification is personal data
about one person and nothing depends on it, so DPDP erasure is a plain cascade —
unlike the ledger, where the row must survive and only the link is severed.

**The routing table** (`routing.ts`) — eighteen topics, each mapping to audiences,
channels, criticality and templates. Data, not code.

**The templates** (`templates.ts` + `notif.*` in both locale files) — twenty-two
messages, Hindi written for a Jabalpur reader rather than translated from the
English.

**The consumer** — one outbox subscriber. Resolve who cares, resolve the facts,
write the inbox row and the per-channel delivery rows in one transaction, then
send.

**Four transports** behind one interface: `fake`, `console`, `msg91`,
`whatsapp_cloud`. The last two are written against the vendors' documented HTTP
shapes and constructor-gated on credentials.

**Quiet hours**, a release job, the inbox API, and a seeded set of inboxes with
something in them.

## 3. Key decisions and deviations

**Adding a notification is a table row and two strings.** The test that proves it
registers a topic the codebase has never heard of and asserts the message
arrives — the only honest way to check, because every route already in the table
was written by somebody who could also have edited the consumer.

**One parameter bag per event, not one per route.** That claim only holds if the
facts a future template might want are already there, so the resolver assembles
everything an event could reasonably say and each template takes the subset it
declares. The cost is a few unused joins; the alternative puts code back in the
middle of the thing that was supposed to be data.

**Parameters are stored tagged and rendered late.** A row keeps
`{"amount":{"t":"money","v":26900}}`, not "₹269". Two things fall out for free:
switching language translates a person's whole history, and a suspension reason —
decided by the trust engine hours earlier, in no language at all — becomes Hindi
or English at the moment somebody reads it.

**A missing parameter is a loud failure.** `undefined` interpolated into a
customer's WhatsApp is the classic way a templating system embarrasses a company,
and it is always found by a customer rather than by a developer. Where a
parameter can legitimately vanish — the start OTP expiring out of Redis before an
asynchronous consumer reaches it — the **route** declares a fallback template
rather than the consumer coding around it.

**Idempotency lives in a unique index**, on
`(topic, aggregate_id, recipient_user_id, channel)`. A replay loses the insert in
the database, where a race cannot get past it. Delivery status does the rest: a
row already `sent` is never sent again, so a partial failure resends only the
channel that actually failed.

**No second retry machine.** A failed send throws and the outbox's existing
backoff waits. Once the attempt budget is spent it stops throwing and the row is
left `failed` — a message nobody can send is a fact for ops, not a reason to keep
one event circling and blocking the batch.

**SMS exactly twice, and a test asserts exactly which two.** Every SMS costs
money and needs its own DLT template. Cash recorded and suspension both have to
arrive with no data connection, and both cost the recipient money if they do not.
Everything else is a rupee spent on a message WhatsApp would have delivered
better.

**In-app on everything, and never held.** It costs nothing, it is the only
channel that can hold a long message, and it is the record a dispute is settled
from. Writing the row _is_ the delivery and it buzzes nothing, so quiet hours do
not apply — holding it would only mean somebody who opens the app at 2am sees an
empty list about a booking cancelled an hour ago.

**Held, never dropped.** A suppressed delivery keeps its row with the exact
instant it will go out. Dropping would be a silent loss the recipient could never
detect.

**Complaints are in-app only.** Being complained about is not an emergency and
not yet a finding — ops have not looked at it. A WhatsApp at 9pm saying somebody
has accused you of something, with no decision attached, does more harm than good.

**Equal quiet hours mean off, not always.** "Always" would silently stop every
standard notification in the product, which is the kind of config mistake nobody
notices for a week.

**Deviations from the prompt, both additive:**

- **`provider.reinstated` and `complaint.dismissed` were added.** Neither is in
  the required table. A technician told they are suspended and never told they
  are not, and somebody cleared of an accusation who never hears it said, are
  both obviously wrong — and both cost a table row and two strings, which is
  rather the point of the design.
- **`provider.badge_changed` is emitted only on a promotion.** The prompt asked
  for it if missing; it was. Announcing a demotion costs more goodwill than it
  buys.

## 4. Assumptions and missing inputs

- **No credentials for either vendor yet.** DLT registration is in progress. Both
  transports are coded and constructor-gated; going live is an env change, and
  the checklist is in `docs/notifications.md`.
- **The DLT text, not ours, is what an SMS recipient reads.** Our copy is the
  local record of what we meant. Keeping the two in step is a manual discipline;
  when they drift, DLT wins. Worth re-reading when the templates are registered.
- **The login OTP still goes over the development logger.** Phase 10 built the
  transports for _notifications_; routing the login OTP through them needs its
  own DLT template and its own rate-limit thinking. `createOtpTransport` still
  refuses to start in production, which is the correct failure. Flagged for
  Phase 15.
- **No per-topic opt-outs**, deliberately and documented. Everything routed is
  transactional; switching off "booking accepted" would break the product for
  whoever did it. Opt-outs are for marketing, which does not exist here.
- **No vendor delivery receipts consumed.** `transport_ref` is stored so a
  delivery can be chased by hand. Consuming WhatsApp's status webhooks is a real
  feature and not one the pilot needs.
- **Quiet hours are a single global window**, not per-user and not per-timezone.
  One city, one timezone; revisit at the second city.
- **The seeded notifications are written directly rather than replayed through
  the consumer.** The seed holds a bare Prisma client with no app context, and
  faking one would make the seed depend on the whole runtime. Template ids and
  parameter shapes are imported from the real registry, so a renamed template
  breaks the seed at compile time rather than seeding rubbish.

## 5. Verification results

```
npm run typecheck      clean
npm run lint           clean
npm run format:check   clean
npm run build          clean
npm test               958 passed / 958 across 48 files, three consecutive runs
```

New coverage: 30 pure template/render/routing tests, 11 quiet-hours tests, 30
notification integration tests, 6 scheduled-recompute tests.

**Fresh-database verification.** All 12 migrations applied to an empty database
produce an object inventory identical to the incrementally migrated dev database
— 131 indexes, 21 triggers, 60 CHECK constraints, 5 views, and all 14 raw-SQL
indexes `migrate diff` keeps offering to drop.

**Seed idempotency.** Seeded the fresh database twice; the second run reported
`0` for every section and all twelve table counts were identical — including 6
notifications, 12 deliveries, and 23 users all on `hi`.

Proved end to end:

- Every row of the routing table fires: correct audience, correct channels,
  correct criticality, correct deep link, and the right content in the message.
- The technician hears about a request and the customer does not; each
  cancellation tells the other side and nobody is told what they did.
- `booking.accepted` carries the live start OTP, and degrades to the no-OTP
  template when the code has expired — with no `undefined` and no `{{` in the
  text.
- `payment.cash_recorded` reaches the customer on all three channels with the
  right rupee figure and the sentence telling them how to dispute it.
- `provider.suspended` reaches the technician on all three channels with the
  reason resolved into Hindi rather than left as an i18n key.
- Delivering the same event four times leaves one inbox row, one delivery per
  channel, and one external send.
- 23:00 IST: a standard message is held with `scheduled_for` at exactly 07:00,
  a critical one goes immediately, and the in-app row is written either way. The
  release job does nothing at 02:00 and sends at 07:00. All on an injected clock.
- An `en` reader gets English from a request that carried `Accept-Language: hi`,
  while the technician on the same booking still gets Hindi.
- Switching language re-renders an **existing** inbox row, same id, into English.
- A failed WhatsApp leaves the delivery `failed` with its error while the inbox
  row stays `sent`; the retry succeeds and the message is still sent exactly
  once. Exhausting the budget parks it and stops throwing.
- A synthetic topic, registered at runtime with no handler written for it, is
  delivered on two channels with the right deep link.
- Template × locale completeness in both directions: no missing string, no unused
  parameter, no undeclared placeholder.
- The phone-redaction sweep: no ten-digit run in any template text, no
  phone-shaped parameter declared, and no recipient's own number in any of the
  messages the whole integration suite produced.
- 45 days of inactivity drops the score, and it is the recency component that
  moved. Repeated sweeps write no snapshot; every event-driven recompute still
  writes one.

**One cross-suite hazard found and handled.** `recomputeAllProviders` recounts
`settled_jobs_count` from real bookings, which undoes the two volumes the Phase 9
seed sets by hand to manufacture a SILVER and a GOLD holder. Other suites assert
against those bands. The sweep test restores them explicitly rather than leaving
the next file to discover it.

**Two test errors of mine, both corrected against the code rather than the other
way round:** an expected cash figure that ignored the ₹49 visit fee, and an
English-reader fixture trying to book with somebody else's address — which the
API correctly refused with a 404.

## 6. Next steps

**Phase 11 (admin console)** now has a further queue to build: parked deliveries.
`notification_deliveries` carries `status`, `attempts`, `last_error` and
`transport_ref` for exactly that screen, and "did they get the message" is a
question about that table, not about anybody's inbox.

Also waiting:

- **Before launch (Phase 15):** register the DLT templates and the WhatsApp
  templates in _both_ languages, then flip two env vars. Nothing else changes.
- **Phase 15 also owns the login OTP transport**, which is still the development
  logger and still refuses to start in production.
- **Phase 14** brings push notifications; `deep_link` is already on every row.
- **Worth revisiting with real data:** whether quiet hours should be per-user,
  and whether `payment.captured` deserves WhatsApp as well as the inbox. Both are
  one-line changes in the routing table, which is the point.
