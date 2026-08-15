# Phase 04 — Verification Engine (manual-first)

**Date:** 2026-08-15 · **Phase 4 of 14**

---

## Goal

Make "verified" a concrete, auditable claim rather than a marketing word. A
four-level KYC ladder, an append-only event log the database itself refuses to
let anyone rewrite, private document storage the API never touches the bytes of,
an ops review queue where every decision _and every document view_ leaves a
trace, and a badge derived from the levels currently passed — so a failed
re-check withdraws it on its own.

The whole design answers one sentence: **"why did this technician have a badge on
the day of the incident?"**

Plus the two Phase 3 carry-overs: completeness hard gates, and the rate-limit
retune.

---

## What was built

### Carry-overs

1. **Completeness hard gates.** Already implemented at the end of Phase 3 on
   Ankit's instruction; this phase added `bio` as the eighth checklist item, so
   the soft set is now bio · years_experience · photo doc. Weights
   20/20/20/20/10 for the five hard gates, 3/3/4 for the soft items.
   `missingRequired` and `required: boolean` per breakdown entry let the Flutter
   onboarding render the two groups differently.
2. **Rate-limit retune.** Per-IP 5 → **30** (CGNAT: Indian carriers put many
   subscribers behind one public IP), per-phone 3 → **5**, plus a new
   **60-second resend cooldown** per phone. The cooldown uses `SET NX` — one
   atomic round trip — and deliberately does _not_ consume budget, because being
   twenty seconds early is impatience, not abuse.

### Object storage

- **MinIO** in compose (API on 9000, console on 9001, healthcheck, volume). The
  private bucket is created on API boot and by the seed.
- `StorageService` interface + one S3-compatible implementation using
  `@aws-sdk/client-s3` — chosen over the `minio` client precisely because the
  same code runs against S3 or R2 later with only config changes.
- Upload flow: client asks → API returns a **pre-signed PUT** → client uploads
  directly → client confirms → API `HEAD`s the object and records its real size.
  **File bytes never enter this process.**
- Keys are `kyc/{providerId}/{docType}/{uuid}` — provider first, so a DPDP
  erasure request is a prefix delete.

### Verification data model — migration `20260815140000_add_verification_and_storage`

| Table                             | Contents                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `verification_cases`              | `provider_id`, `level` 0–3, `status` (a projection), `opened_at`, `closed_at`.          |
| `verification_events`             | **Append-only.** `event_type`, `actor_type`, `actor_user_id`, `notes`, `payload` jsonb. |
| `provider_verification_summaries` | `levels_passed` int[], `badge`, `badge_since`. Derived.                                 |
| `kyc_access_logs`                 | Who looked at whose documents, and which.                                               |

`provider_documents` gained `content_type`, `size_bytes`, `uploaded_at`, a unique
`storage_key`, and real statuses `awaiting_upload → uploaded`.

Hand-written additions Prisma cannot express:

- **The append-only trigger** (below).
- Partial unique index: at most one live case per `(provider, level)`.
- CHECKs: level 0–3; `closed_at` present exactly when terminal; an event's actor
  is a user unless it is a `system` event; `levels_passed` is a subset of
  `{0,1,2,3}` with no duplicates; `badge_since` present exactly when a badge is.
- `int_array_is_distinct()` — a CHECK constraint cannot contain a subquery, so
  the duplicate test lives in an immutable function.

### The append-only guarantee

```sql
CREATE TRIGGER verification_events_no_update BEFORE UPDATE ON verification_events …
CREATE TRIGGER verification_events_no_delete BEFORE DELETE ON verification_events …
```

- **UPDATE is refused unconditionally.** No flag, no bypass. History is never
  rewritten.
- **DELETE is refused except** when a session sets
  `fixbridge.allow_kyc_purge = 'on'`.

That exemption is a deliberate deviation from the prompt's "no UPDATE or DELETE,
ever", and it exists because an unconditional DELETE block breaks two real
things: the `ON DELETE CASCADE` from `users` (so no user could ever be deleted),
and DPDP erasure, which is a legal obligation in Phase 14. It is scoped to a
single transaction via `SET LOCAL`, lives in exactly one repository function
(`purgeVerificationData`), and is tested three ways: UPDATE refused, DELETE
refused, **UPDATE still refused even with the flag set**.

### State machine and projection

`state-machine.ts` is pure: `applyEvent(from, event)` is the only place
transition rules exist, and `projectStatus(events)` folds a log into a status.
`verification_cases.status` is a cache of that fold, recomputed on every write,
and a test asserts `stored == projectStatus(events)` for a live case _and_ for
every seeded case. `projectStatus` **throws** on a log it cannot replay — if that
ever fires on real data, something wrote around the state machine.

`adapter_result_received` is legal from any non-terminal state and moves nothing:
a third-party answer is evidence, not a decision.

### Levels, badge, adapters

- Per-level Zod schemas (`requirements.ts`), all `.strict()`. Level 0 accepts
  **only the last 4 digits** of an ID. Level 3 requires exactly two distinct
  references, phones normalised to E.164.
- `computeBadge(passedLevels)` — all four → `VERIFIED`, else `NONE`. Derived from
  the _latest closed case per level_, so a failed re-check drops the badge with
  no revoke path to forget. `SILVER`/`GOLD` exist in the enum but are
  unreachable (Phase 9).
- `KycAdapter` interface + `ManualAdapter` (default) and `FakeAdapter` (resolves
  on a later tick, proving the async result path).

### Endpoints

Provider (`technician`): request upload URL · confirm upload · list documents ·
own download URL · submit level N · list own cases + summary · case detail ·
provide requested info.

Ops (`ops`/`admin`, under `/api/v1/admin/verification`): paginated oldest-first
queue with status/level/city filters · case detail with signed document URLs ·
move to review · decide (`pass`/`fail`/`request_info`).

The ops routes are mounted under the admin prefix but the code lives in the
verification module — the `admin` module stays empty until Phase 11.

### Seed

12 VERIFIED · 3 mid-pipeline · 2 not started, of the 17 listed technicians.
Written as **event scripts**, not final states — seeding a `passed` case with no
events would produce data the projection test would rightly reject. Some
histories include a needs-info detour. A dedicated **ops-only** user is seeded
(`+919999900002`), separate from the admin, so an ops route accidentally
requiring `admin` cannot hide.

### Docs

`docs/verification.md` — the ladder, a mermaid state diagram, the append-only
rationale, the storage flow, the identity-number policy, and a step-by-step plan
for wiring a real KYC vendor. `docs/API.md` covers every endpoint.

---

## Key decisions & deviations

### Versions

Two new runtime dependencies: **`@aws-sdk/client-s3` 3.1111.0** and
**`@aws-sdk/s3-request-presigner` 3.1111.0**. Everything else unchanged —
Node v20.12.2, Prisma 6.19.3, TypeScript 5.9.3, Express 4.22.2, Zod 4.4.3,
Vitest 3.2.7. MinIO image `RELEASE.2025-04-22T22-12-26Z`.

### Decisions

1. **The DELETE escape hatch** (above). The single most significant deviation,
   and the reasoning is in `docs/verification.md`.
2. **`kyc_access_logs` is a separate table**, not an event on the case. A read is
   not a state transition; mixing them would bury the handful of rows an incident
   review needs under a pile of "someone looked at this". The prompt allowed
   either.
3. **The upload size is signed, not promised.** A pre-signed PUT cannot express
   "at most N bytes" — only a pre-signed POST policy has `content-length-range`.
   Rather than accept a limit we only check afterwards, the client declares its
   size, the API validates it against the cap, and signs `ContentLength` so
   **storage itself** rejects anything else. `HEAD` at confirm is the second
   line. A test uploads an oversized body against a valid URL and asserts storage
   refuses it.
4. **Document management moved out of the providers module.** Phase 3's
   `POST /providers/me/documents` let a technician declare a document with an
   arbitrary `storageKey` and no file behind it. With real uploads that is worse
   than useless, so those endpoints were **removed** — documents are created only
   by the verification upload flow, and appear read-only on the profile. This is
   a breaking change to a Phase 3 endpoint; nothing consumes it yet.
5. **Ops notes are invisible to providers**, and reference phone numbers are
   masked in the provider's own view while ops see them in full. A reviewer's
   reasoning ("photo looks doctored") is an internal record; the submission log
   should not become a way to re-read a third party's number.
6. **`badge_since` restarts if a badge is lost and re-earned.** It answers "how
   long have they been verified?", and the honest answer after a lapse is "since
   the second time".
7. **The bucket check does not block boot.** A storage outage should surface when
   someone tries to upload, not stop every unrelated endpoint.
8. **The identity-number guard exempts keys by name.** See the bug below.

### Three bugs the tests caught

**The raw-ID guard rejected valid submissions.** `looksLikeFullIdNumber` stripped
every non-digit and flagged anything with ≥8 digits — which made a document UUID
(`11111111-1111-4111-…`) look like an identity number, so submitting level 0 with
perfectly good document ids failed as a privacy violation. Fixed by matching only
digits-and-separators and exempting id-bearing keys by name. The regression test
spells out that an all-numeric UUID _is_ still indistinguishable by shape, and
that the key exemption is what actually covers it.

**The migration wanted to drop the PostGIS GIST indexes.** `prisma migrate diff`
does not know about indexes on `Unsupported` columns, so it read them as drift
and proposed `DROP INDEX` for both. Silently losing them would have turned every
Phase 5 radius search into a sequential scan — exactly the hazard flagged in
`docs/geo-notes.md` at the end of Phase 3. Removed from the migration, with a
banner at the top of the file explaining why, and a fresh-database run confirms
both indexes survive.

**A CHECK constraint cannot contain a subquery.** The duplicate-levels check
failed the migration outright (`0A000`). Postgres rolled the whole file back
cleanly, `prisma migrate resolve --rolled-back` cleared the failure, and the
check now lives in an immutable function.

### Known warnings

Unchanged: `eslint-visitor-keys` EBADENGINE on Node 20.12.2 (use 20.19+), and
Prisma's `package.json#prisma` deprecation.

---

## Assumptions & missing inputs

**Needed from Ankit:**

1. **Virus scanning is not implemented** and is explicitly out of scope, but it
   is worth saying plainly: today a technician can upload any 10 MB file of an
   allowed content type and an ops reviewer will open it in a browser. That is a
   real path to an ops workstation. Flagged for Phase 14; bring it forward if
   ops will be reviewing at volume sooner.
2. **Nothing gates entry to the technician role.** Still true from Phase 3, and
   more pointed now: anyone can self-register, submit four levels and enter the
   ops queue. Verification gates _trust_ and completeness gates _listing_, but
   the queue itself is open to anyone who signs up.
3. **Which KYC vendor?** Surepass, OnGrid, DigiLocker — the adapter interface is
   ready and the wiring plan is in `docs/verification.md`. The decision affects
   contract lead time more than code.
4. **Should a vendor result auto-decide a case?** Today it is recorded as
   evidence and a human still decides. That is right for a pilot; at volume it
   should probably auto-pass clean results. Worth being a deliberate policy
   choice rather than something that arrives with the integration.
5. **Reference calling is manual.** Ops ring the two numbers and record the
   outcome through the decide endpoint. No tooling, no call log, no recording —
   fine for pilot volume, and the first thing ops will ask for.
6. **Hindi copy is still mine**, now including the verification strings.
7. **Git remote** — still none, so CI has still never run. It now needs a MinIO
   service container, which is configured but unproven.

**Assumed:**

- One open case per (provider, level) is the right constraint; a provider cannot
  submit level 0 twice concurrently.
- Ops reviewers are trusted with full document access; there is no
  need-to-know narrowing beyond the role check. The access log is the control.
- Seeded documents are marked `uploaded` with no object behind them. A signed URL
  for one will 404 at storage — correct, and better than pretending.
- 10 MB is enough for a photo of an ID card or a certificate.

---

## Verification results

Windows 11, Node v20.12.2, Docker 28.0.4, MinIO in compose.

| Check                                                   | Result                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run lint` / `format:check`                         | Clean                                                                      |
| `npm run typecheck` / `npm run build`                   | Clean                                                                      |
| `npm test`                                              | **436 passed** (23 files)                                                  |
| Stability                                               | Suite run **3×**, 436/436 each time                                        |
| Fresh DB (`down -v` → `up -d` → `migrate:deploy`)       | All **5** migrations apply to a virgin database                            |
| GIST indexes + append-only triggers after fresh migrate | Both indexes and both triggers present                                     |
| `npm run seed` × 2                                      | Identical: 12 VERIFIED, 3 in progress, 2 not started; 54 cases, 165 events |

### Done criteria

| Criterion                                         | Where it is proven                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Carry-overs                                    | Hard gates from Phase 3 + `bio`; rate-limit defaults asserted in `config.test.ts`; cooldown has its own test                                                                                                                                                               |
| 2. Full e2e green                                 | `walks all four levels to a VERIFIED badge, then loses it to a failed re-check` — real MinIO upload, four submissions, ops queue, needs-info detour, provider response, all pass, badge with `badgeSince`, failed re-check, badge → `NONE`, original passed case untouched |
| 3. Append-only proven                             | Four trigger tests; `projection == fold(events)` asserted on a live case and across all 54 seeded cases                                                                                                                                                                    |
| 4. No raw Aadhaar                                 | `no-raw-id-numbers.test.ts` walks every `.ts`/`.json`/`.sql`/`.md`/`.prisma` file in `apps/api/src`, `apps/api/prisma`, `packages/shared/src` and `docs`                                                                                                                   |
| 5. Clean build, fresh migrations, idempotent seed | Above                                                                                                                                                                                                                                                                      |
| 6. Docs                                           | `docs/API.md` + `docs/verification.md`                                                                                                                                                                                                                                     |

### Test coverage worth calling out

- **Signed-URL expiry is actually tested** — issue a 1-second URL, fetch it
  (200), wait, fetch again, assert 403.
- **AuthZ**: provider A gets 404 on provider B's case; a customer gets 403 on
  every verification route including the ops queue; a technician gets 403 on the
  queue and on decide.
- **Ops notes redaction** asserts a specific secret string is absent from the
  provider's view and present in the ops view.
- **The scan test asserts it found files first**, so a broken path cannot make it
  pass vacuously.

### Working curl examples

```bash
# 1. Ask for an upload URL (size is signed into it)
$ curl -X POST http://localhost:3000/api/v1/verification/documents/upload-url \
    -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
    -d '{"docType":"id_proof","contentType":"image/png","sizeBytes":10240}'
{"document":{"id":"…","status":"awaiting_upload",…},
 "upload":{"url":"http://localhost:9000/fixbridge-kyc/kyc/…","requiredHeaders":{…},
           "expiresInSeconds":300}}

# 2. Upload straight to storage, then confirm
$ curl -X PUT "$UPLOAD_URL" -H 'Content-Type: image/png' -H 'Content-Length: 10240' \
    --data-binary @id.png
$ curl -X POST http://localhost:3000/api/v1/verification/documents/$DOC/confirm \
    -H "Authorization: Bearer $ACCESS"
# → status "uploaded", sizeBytes = the real size

# 3. Submit identity — last 4 digits only, never the full number
$ curl -X POST http://localhost:3000/api/v1/verification/levels/0/submit \
    -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
    -d '{"idType":"aadhaar","idLast4":"4321","idProofDocumentId":"…","selfieDocumentId":"…"}'
# → 201, case in "submitted"

# 4. Ops works the queue, oldest first
$ curl 'http://localhost:3000/api/v1/admin/verification/queue?level=0' \
    -H "Authorization: Bearer $OPS"

# 5. Ops asks for more (notes mandatory) — and this view is itself logged
$ curl -X POST http://localhost:3000/api/v1/admin/verification/cases/$CASE/decide \
    -H "Authorization: Bearer $OPS" -H 'Content-Type: application/json' \
    -d '{"decision":"request_info","notes":"The selfie is too dark to compare."}'

# 6. A failed re-check withdraws the badge immediately
$ curl -X POST http://localhost:3000/api/v1/admin/verification/cases/$RECHECK/decide \
    -H "Authorization: Bearer $OPS" -H 'Content-Type: application/json' \
    -d '{"decision":"fail","notes":"Background check returned an unresolved case."}'
{"summary":{"badge":"NONE","badgeSince":null,"levelsPassed":[0,2,3]},…}
```

```sql
-- History is reconstructable from events alone
SELECT e.created_at, e.event_type, e.actor_type, e.notes
FROM verification_events e
JOIN verification_cases c ON c.id = e.case_id
WHERE c.provider_id = '…' AND c.level = 0
ORDER BY e.created_at;

-- And it cannot be rewritten
UPDATE verification_events SET notes = 'nope' WHERE id = '…';
-- ERROR: verification_events is append-only: UPDATE is not permitted
```

### Not verified

- **CI going green** — no git remote. The workflow now also needs a MinIO service
  container, which is configured but has never run.
- **Graceful shutdown under a real signal** — unchanged; Windows limitation.
- **Real KYC vendor behaviour** — adapters are stubs by design.
- **Virus-scanning** — not implemented, see above.

---

## Next steps — Phase 5 (geo-search & matching)

**Ready to build on:**

- `is_listed` (Phase 3) and `badge` (Phase 4) are both accurate and maintained
  transactionally. Search requires `is_listed = true AND badge >= 'VERIFIED'`;
  `badgeAtLeast()` already exists for that comparison.
- GIST indexes on `provider_profiles.base_location` and `addresses.location` are
  in place and verified to survive migration regeneration. `ST_DWithin` is ready.
- A partial index on `(city_id) WHERE is_listed` is exactly the search filter.
- The seeded distribution is deliberate: 20 technicians, 17 listed, 12 verified,
  spread across ten real Jabalpur localities with radii 3–15 km. Ranking tests
  have something meaningful to rank.
- `provider_availability_templates` stores minutes-from-midnight, so
  availability-window coverage is integer arithmetic.
- `pg_trgm` has been enabled since Phase 1 for the Hinglish synonym work.

**Phase 5 will need to decide:**

- Whether the technician's `service_radius_km` and the customer's search radius
  are both required to match (mutual containment) or only one.
- Where the Hinglish synonym table lives — its own table, or seeded rows in
  `categories`. "motor jal gayi" → motor rewinding is a data problem, not a code
  one.
- Whether ranking weights are config or database rows. Config is simpler; rows
  let ops tune without a deploy.

**Carried forward, still deliberately not built:** the transactional outbox and
dispatcher, Razorpay/UPI, WhatsApp messaging adapters, OpenAPI generation,
session-listing endpoints, account deletion (DPDP, Phase 14), admin UI, trust
score and SILVER/GOLD, auto-suspension, virus scanning, and document OCR.
