# Customer app — Flutter

Android-first customer app for the marketplace. Talks to the same
`/api/v1` the web app does; see [docs/API-REFERENCE.md](../../docs/API-REFERENCE.md)
for every endpoint and [docs/FLUTTER-APP-PLAN.md](../../docs/FLUTTER-APP-PLAN.md)
for the build plan.

**Getting it running:** [SETUP.md](SETUP.md). Short version, once Flutter is
installed — `flutter pub get`, then `flutter run` with the API up.

---

## What is built

| Area | State |
|---|---|
| Design system — colour, type, spacing, motion | Done |
| HTTP client, error envelope, refresh mutex, retry policy | Done |
| Session storage, device id | Done |
| Models for every customer-facing response | Done |
| Repositories for auth, catalog, bookings, account | Done |
| Language picker → phone → OTP → name | Done |
| Home, bookings list, inbox, account | Done |
| Search, technician profile, booking detail | **Next** |
| Quotation approval, payment, reviews, complaints | **Next** |

The three unbuilt screens exist as routes that say what they will be and
which endpoints they use, so navigation and deep links are exercised from
the start.

---

## Layout

```
lib/
  core/
    api/          Dio client, error envelope
    config/       build-time settings
    storage/      keystore + preferences
    theme/        colour, type, spacing, motion
    providers.dart   the dependency graph
  data/
    models/       hand-written, no codegen
    repositories/ one per API area
  features/
    auth/ home/ bookings/ notifications/ account/ shell/
  shared/widgets/ buttons, cards, fields, states, avatars
  app/            router, theme wiring, splash
```

**No `build_runner`.** Models are hand-written and Riverpod is used without
codegen, so `flutter pub get` and `flutter run` are the whole setup. It costs
some boilerplate in `data/models/` and buys a project that starts first time.

---

## Decisions worth knowing before you change something

**Refreshes are serialised.** The API rotates refresh tokens on every use and
treats a second presentation of an already-rotated one as theft — it revokes
every token for that device. Two screens hitting a 401 at the same moment and
each firing its own refresh is a silent logout, not a slow path. The mutex in
[`api_client.dart`](lib/core/api/api_client.dart) is what prevents that; do not
remove it.

**Only GETs are retried.** `POST /bookings` and `POST /bookings/:id/payments`
are not idempotent from the client's side. A retry that succeeds after the app
gave up is a double booking or a double charge.

**Nothing about a booking is cached.** The end OTP exists only while the
booking is `IN_PROGRESS`; a cached booking redrawing a stale code is worse
than a spinner, because it leaves a technician unable to close a job.

**There is no realtime.** No WebSocket or SSE exists in the API. Booking state,
the unread badge and payment capture are all polled — 10s while waiting for a
reply, 20s once accepted, foreground only, stopped on terminal statuses.

**Money is integer paise, and the server formats it.** Every amount arrives as
both a `…Paise` integer and a `…Display` string. Render the string. Re-deriving
it on the client is how the app and the receipt end up disagreeing.

**`labelKey` is an i18n key, not text.** `PayableComponent.labelKey` must be
resolved, never printed.

**Both languages are equal.** The picker is the first screen, nothing is
preselected, and the device locale is deliberately ignored — a phone set to
English is not a statement about what its owner reads best. `DEFAULT_LOCALE`
being `hi` on the API is only the fallback for a client that sends no
`Accept-Language` at all.

**Light theme only, on purpose.** These screens are read outdoors, in
doorways, at midday, on cheap LCDs. Following the system into dark would hand
somebody a dark screen in the one lighting condition the app has to survive.

---

## Design

Direction: white space, one blue accent, soft depth, motion only as feedback.
Tokens live in [`core/theme/`](lib/core/theme/). The single gradient in the
whole app is the live-booking card — spending it anywhere else would stop it
meaning anything.

Fonts are fetched at runtime via `google_fonts` for now. SETUP.md has the step
to bundle them before release; an unresolved face renders as blank boxes, and
Hindi is the default language.
