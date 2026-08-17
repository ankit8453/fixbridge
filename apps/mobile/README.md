# Mobile app (placeholder)

Nothing here yet. The customer and technician mobile apps are built in
**Phases 13–14**, in Flutter. Phase 12 is the Vite + React web app; Phase 15 is
launch hardening.

They will consume the `/api/v1/*` modules and the `hi` / `en` i18n keys the API
already ships (see [apps/api/src/core/locales/](../api/src/core/locales/)).

Push notifications land with these phases. The groundwork is already in the API:
every notification row carries a `deep_link` route hint, and the routing table
that decides who hears what is data rather than code — see
[docs/notifications.md](../../docs/notifications.md).

Do not add code here before Phase 13 — see the scope discipline note in the root
[README](../../README.md).
