# Notifications

Everything the system did in Phases 1–9 happened silently. A booking request a
mistri never heard about expired. A suspension nobody explained lost a technician
forever. A cash payment the customer was never told about was an invitation to
fraud.

This is retention and fraud-sunlight infrastructure. It is not a texting feature.

---

## The routing table

`src/modules/notifications/routing.ts` is the whole thing. A row here plus two
strings in each locale file is a complete notification — no handler, no
subscriber, no `if`. There is a test that registers a topic this codebase has
never heard of and asserts the message arrives, because every route already in
the table was written by somebody who could also have edited the consumer.

| Topic                           | Who hears it                | Channels                    | Class    |
| ------------------------------- | --------------------------- | --------------------------- | -------- |
| `booking.requested`             | technician                  | in_app + whatsapp           | critical |
| `booking.accepted`              | customer                    | in_app + whatsapp           | critical |
| `booking.rejected`              | customer                    | in_app + whatsapp           | critical |
| `booking.expired`               | customer                    | in_app + whatsapp           | critical |
| `booking.cancelled_by_customer` | technician                  | in_app + whatsapp           | critical |
| `booking.cancelled_by_provider` | customer                    | in_app + whatsapp           | critical |
| `quotation.sent`                | customer                    | in_app + whatsapp           | critical |
| `quotation.approved`            | technician                  | in_app                      | standard |
| `quotation.rejected`            | technician                  | in_app                      | standard |
| `payment.captured`              | customer **and** technician | in_app                      | standard |
| `payment.cash_recorded`         | customer                    | in_app + whatsapp + **sms** | critical |
| `payout.paid`                   | technician                  | in_app + whatsapp           | standard |
| `provider.suspended`            | technician                  | in_app + whatsapp + **sms** | critical |
| `provider.reinstated`           | technician                  | in_app + whatsapp           | critical |
| `provider.badge_changed`        | technician                  | in_app + whatsapp           | standard |
| `complaint.opened`              | the accused                 | in_app                      | standard |
| `complaint.resolved`            | both parties                | in_app                      | standard |
| `complaint.dismissed`           | both parties                | in_app                      | standard |

**A topic with no row is not an error.** Most of what this system publishes is
for projections, not people — `booking.en_route` moves a status, `review.hidden`
moves a score, and neither is worth a buzz. Unroutable topics are logged at debug
and dropped.

### Choosing channels

**`in_app` is on everything, always.** It costs nothing, it is the only channel
that can hold a long message, and it is the record a dispute is settled from. A
test fails if any route omits it.

**`whatsapp` goes on anything a person is waiting for.** Cheap, renders
Devanagari properly on every phone, and outside the DLT regime entirely. For a
Jabalpur pilot it is also simply where people are: a customer will read a
WhatsApp and ignore an SMS.

**`sms` appears exactly twice**, and a test asserts that it is exactly those two:

- **`payment.cash_recorded`** — the anti-fraud message. Recording cash is the one
  thing a technician can do unilaterally about money. A customer who never sees
  it cannot dispute it, and a charge nobody can dispute is a charge somebody will
  eventually invent. It has to arrive with no data connection.
- **`provider.suspended`** — a technician whose work silently stops does not file
  a support ticket. They conclude the platform is broken and go back to the shop
  that phones them.

Every other SMS is a rupee spent on a message WhatsApp would have delivered
better, plus a DLT template to register and maintain.

### Two audiences, two sentences

`payment.captured` tells the customer a receipt and the technician a credit.
`complaint.resolved` tells the person who complained that they were believed and
the person complained about that it will affect their score. Same event, same
row in the table, different templates — because "tell both parties" is almost
never "tell both parties the same thing".

### Complaints are in-app only

Being complained about is not an emergency and it is not yet a finding — ops have
not looked at it. A WhatsApp at 9pm saying somebody has accused you of something,
with no decision attached, would do more harm than good.

---

## Criticality

**`critical`** reaches a person at 3am: an OTP they are waiting on, a job that was
just cancelled, a suspension, cash recorded against their name.

**`standard`** respects quiet hours, `22:00–07:00 IST` by default
(`QUIET_HOURS_START_IST` / `QUIET_HOURS_END_IST`).

**Held, never dropped.** A suppressed delivery keeps its row with
`status = suppressed_quiet_hours` and `scheduled_for` set to the exact instant the
window opens; a Redis-locked job every five minutes sends what is due, oldest
first. Dropping would be a silent loss the recipient could never detect. Waking
up to eleven messages in reverse chronological order tells the story backwards,
which is why the release is ordered.

**Quiet hours never apply to `in_app`.** Writing the row _is_ the delivery and it
buzzes nothing. Holding it back would only mean somebody who opens the app at 2am
sees an empty list about a booking that was cancelled an hour ago.

Setting both hours to the same value turns the feature off. It means _never_
quiet, not always — "always" would silently stop every standard notification in
the product, and that is the kind of config mistake nobody notices for a week.

---

## Templates

The **shape** of a message lives in `templates.ts`, in TypeScript, where a test
can enumerate it. The **wording** lives in `core/locales/{hi,en}.json` under
`notif.*`, where somebody who is not a programmer can fix a clumsy sentence.

Four tests join them, per locale:

1. Every template has a title and a body. `translate` falls back to the _key_, so
   a missing Hindi string would send a customer the literal
   `notif.booking.accepted.body`.
2. Every key reached indirectly through a parameter exists too.
3. Every declared parameter actually appears in the text — an unused one is a
   fact that silently never reaches anybody.
4. Every placeholder in the text is declared — the reverse, which catches a typo
   in a locale file.

**Hindi is the primary text, not a translation of the English.** It is written
the way somebody in Jabalpur speaks: "कारीगर", not "सेवा प्रदाता".

### Parameters are stored raw and rendered late

A notification row keeps template keys and **tagged** parameters, never the
finished sentence:

```json
{
  "amount": { "t": "money", "v": 26900 },
  "time": { "t": "time", "v": "2026-08-16T11:30:00.000Z" },
  "reason": { "t": "key", "v": "trust.suspension.repeatCancellation" }
}
```

Five tags: `text`, `num`, `money`, `time`, `key`. Money is formatted with Indian
grouping, instants in IST in the reader's language, and `key` is resolved as a
nested i18n lookup.

Two things fall out of this that would otherwise be work:

- **Switching language translates your whole history.** The inbox re-renders from
  the same row, so a person who moves to English does not keep a Hindi archive.
- **A suspension reason has no language until somebody reads it.** The trust
  engine decided it hours earlier, in no language at all.

### A missing parameter is a failure, loudly

`renderMessage` refuses to render if a declared parameter is absent, and names
exactly which. The alternative — `undefined` interpolated into a customer's
WhatsApp — is the classic way a templating system embarrasses a company, and it
is always found by a customer rather than by a developer.

Where a parameter can legitimately go missing, the **route** declares a fallback
rather than the consumer coding around it. There is one today: an accepted
booking whose start OTP has already expired out of Redis falls back to
`bookingAcceptedNoOtp`, a template that never mentions a code.

### What never goes in a notification

- **No full phone numbers.** Unmasking lives in the apps, behind a booking that
  is actually in progress. A notification travels over channels the recipient
  does not control — a forwarded WhatsApp outlives everything.
- **No card, UPI or bank details.** The payout message carries a UTR, which is
  the number a technician quotes at their own bank; it identifies a transfer, not
  an account.
- **No KYC facts.** Ever.

Names are first names only. A full name plus a time and a trade is enough to find
somebody.

The sweep that enforces this runs in three places: a static check that no
template declares a phone-shaped parameter, a static check that no locale string
contains a ten-digit run, and a whole-suite check over every message the
integration tests produced.

**Start OTPs do go out**, on `booking.accepted`, and that is deliberate: for a web
user with no app there is nowhere else the code can come from. It is why that
route is critical.

---

## Idempotency

The outbox is at-least-once by design, so this consumer will be called twice for
the same event. That is the deal, not a bug.

A projection can shrug off a replay. A message cannot: the human sees it twice,
and after the third identical WhatsApp about one booking they stop reading any of
them. Two things stop that:

1. **A unique index** on `(topic, aggregate_id, recipient_user_id, channel)`. A
   redelivery loses the insert instead of messaging somebody again — in the
   database, where a race cannot get past it.
2. **Delivery status.** A row that is already `sent` is never sent again, so a
   redelivery that _does_ find work — because the vendor was down the first time
   — resends only the channel that actually failed.

Together they make a replay free and a partial failure resumable, which is what
the outbox's contract actually requires. Proved by delivering the same event four
times and asserting one inbox row, one delivery per channel, and one external
send.

---

## Retry and parking

There is no second retry machine. A send that fails **throws**, and the outbox's
existing backoff does the waiting — same table, same exponential schedule, same
ops view.

Once `NOTIFY_MAX_ATTEMPTS` is spent the delivery stops throwing and is left
`failed` with its `last_error`. A message nobody can send is a fact for ops, not
a reason to keep one event circling and blocking the batch. Phase 11 gives the
parked rows a screen.

One channel failing is never the message failing: the inbox row is written and
`sent` before any external send is attempted.

---

## Transports

| Config value        | Implementation            | Notes                                                    |
| ------------------- | ------------------------- | -------------------------------------------------------- |
| `console` (default) | logs the rendered message | the whole pipeline works with no vendor account          |
| `fake`              | records in memory         | what the tests assert against; **refused in production** |
| `msg91`             | MSG91 flow API            | SMS. Needs DLT.                                          |
| `whatsapp_cloud`    | WhatsApp Cloud API        | Needs registered templates.                              |

Set per channel: `NOTIFY_WHATSAPP_TRANSPORT`, `NOTIFY_SMS_TRANSPORT`.

`in_app` has no transport and never will — the row _is_ the delivery, and
inventing a null transport for it would only invite somebody to make it failable.

The two real transports are **constructor-gated on credentials**: with no keys
they are never instantiated, enforced by the config schema rather than by a
runtime check somebody can forget. Production also refuses `fake`, the same guard
as the payment gateway: a build that pretends to send would drop every suspension
notice while every dashboard stayed green. Worse than an outage, because an
outage is visible.

---

## Go-live checklist

Everything below is paperwork plus environment variables. No code changes.

### WhatsApp Cloud API

1. Meta Business account verified; a WhatsApp Business Account created.
2. A phone number registered to it — **not** anybody's personal number, and not
   the number on the app's support page unless you intend to receive replies.
3. Register **every template in both `hi` and `en`**. The `language.code` sent is
   the recipient's own, so a Hindi registration missing for one template means
   that one message fails for every Hindi user. The list of stems is
   `TEMPLATE_IDS` in `templates.ts`; the text must match the locale files, since
   Meta's copy is what actually gets delivered.
4. Templates are `TRANSACTIONAL`/`UTILITY` category. Do not file them as
   marketing — different rules, different rate limits, and a rejection risk.
5. Set:
   ```
   NOTIFY_WHATSAPP_TRANSPORT=whatsapp_cloud
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_ACCESS_TOKEN=...            # a permanent system-user token
   WHATSAPP_API_VERSION=v21.0
   WHATSAPP_TEMPLATE_MAP={"booking.accepted":"booking_accepted",...}
   ```
6. A stem with no mapping is **refused**, not sent as something else.

### MSG91 / DLT

1. Register the entity on a DLT portal (Jio, Airtel, Vodafone — one registration
   propagates).
2. Register the **header** — a 6-character sender id, e.g. `FIXBRG`.
3. Register a **content template** for each of the two SMS messages
   (`payment.cashRecorded`, `provider.suspended`) in Hindi. Variables are
   positional; ours go over as `var1…varN` in the order declared in
   `templates.ts`, so the DLT template's variables must be in the same order.
4. File them as **transactional**, not promotional. This is a legal distinction
   as well as a commercial one.
5. Set:
   ```
   NOTIFY_SMS_TRANSPORT=msg91
   MSG91_AUTH_KEY=...
   MSG91_SENDER_ID=FIXBRG
   MSG91_TEMPLATE_MAP={"payment.cashRecorded":"1707…","provider.suspended":"1707…"}
   ```
6. **What the customer reads is the DLT-registered text, not ours.** Our copy is
   the local record of what we meant. Keeping the two in step is a manual
   discipline; when they drift, DLT wins.

Adding a third SMS route means new DLT paperwork, a two-week lead time, and a
per-message cost. That is why the table has exactly two.

---

## Language

`users.preferred_language` (`hi` | `en`, default `hi`) is the single setting that
governs every message a person receives, and the inbox renders in it too.

It is a **column, not a header**, because notifications are asynchronous: a
WhatsApp composed by a background job three hours later has no `Accept-Language`
to read, and guessing wrong means a Jabalpur mistri gets their suspension
explained in English.

Set it with `PATCH /api/v1/auth/me`. It lives on the user rather than on the
customer or technician profile because most people here are both, and nobody
expects to set their language twice.

The inbox deliberately ignores `Accept-Language` and uses this instead: an inbox
that disagreed with the WhatsApp somebody already received would read as two
different notifications.

---

## What is deliberately not here

**No per-topic opt-outs.** Everything routed is transactional — a job, a payment,
a suspension — and letting somebody switch off "booking accepted" would break the
product for them silently. Opt-outs are for marketing, which does not exist here
and is a different DLT category besides.

**No push notifications.** They arrive with the Flutter apps in Phase 14. The
`deep_link` column is their groundwork and nothing consumes it yet.

**No email.** Not a pilot channel. Nobody in this market is waiting on one.

**No digests or batching.** At pilot volume a person gets a handful of messages a
week, and batching them would delay the ones that matter to save nothing.

**No ops broadcast tool.** Phase 11 at most, and it needs a rate limit and an
approval step before it needs a UI.

**No read receipts from the vendors.** `transport_ref` is stored so a delivery can
be chased by hand; consuming WhatsApp's delivery webhooks is a real feature and
not one the pilot needs to answer "did they get it".
