-- Generated with `prisma migrate diff`, then hand-edited. Two things were
-- removed from the generated output and must never be added back:
--
--   DROP INDEX "addresses_location_gist_idx";
--   DROP INDEX "provider_profiles_base_location_gist_idx";
--
-- Prisma does not know those indexes exist (they sit on `Unsupported` geography
-- columns) so it reads them as drift and proposes dropping them. Losing them
-- silently turns every Phase 5 radius search into a sequential scan.
-- See docs/geo-notes.md.

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('submitted', 'in_review', 'needs_info', 'passed', 'failed');

-- CreateEnum
CREATE TYPE "verification_event_type" AS ENUM ('submitted', 'moved_to_review', 'info_requested', 'info_provided', 'passed', 'failed', 'adapter_result_received');

-- CreateEnum
CREATE TYPE "verification_actor_type" AS ENUM ('provider', 'ops', 'system');

-- CreateEnum
CREATE TYPE "badge" AS ENUM ('NONE', 'VERIFIED', 'SILVER', 'GOLD');

-- ---------------------------------------------------------------------------
-- provider_documents: metadata-only stub becomes a real upload record.
--
-- The generated cast (`status::text::new_enum`) would fail on existing rows,
-- because 'pending' has no counterpart in the new enum. Routing through TEXT
-- lets those rows be mapped first: a Phase 3 stub represented a document that
-- was already considered present, so it becomes 'uploaded'.
-- ---------------------------------------------------------------------------
ALTER TABLE "provider_documents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "provider_documents" ALTER COLUMN "status" TYPE TEXT USING "status"::text;
UPDATE "provider_documents" SET "status" = 'uploaded' WHERE "status" = 'pending';
DROP TYPE "provider_document_status";
CREATE TYPE "provider_document_status" AS ENUM ('awaiting_upload', 'uploaded');
ALTER TABLE "provider_documents"
  ALTER COLUMN "status" TYPE "provider_document_status" USING "status"::"provider_document_status";
ALTER TABLE "provider_documents" ALTER COLUMN "status" SET DEFAULT 'awaiting_upload';

-- Added with defaults so existing rows survive, then the defaults are dropped:
-- every new document must state its own content type and size.
ALTER TABLE "provider_documents" ADD COLUMN "content_type" VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE "provider_documents" ADD COLUMN "size_bytes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "provider_documents" ADD COLUMN "uploaded_at" TIMESTAMPTZ(3);
ALTER TABLE "provider_documents" ALTER COLUMN "content_type" DROP DEFAULT;
ALTER TABLE "provider_documents" ALTER COLUMN "size_bytes" DROP DEFAULT;
UPDATE "provider_documents" SET "uploaded_at" = "created_at" WHERE "status" = 'uploaded';

ALTER TABLE "provider_documents"
  ADD CONSTRAINT "provider_documents_size_bytes_check" CHECK ("size_bytes" >= 0),
  ADD CONSTRAINT "provider_documents_uploaded_at_check" CHECK (
    ("status" = 'uploaded' AND "uploaded_at" IS NOT NULL)
    OR ("status" = 'awaiting_upload' AND "uploaded_at" IS NULL)
  );

-- CreateTable
CREATE TABLE "verification_cases" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "level" SMALLINT NOT NULL,
    "status" "verification_status" NOT NULL DEFAULT 'submitted',
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_events" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "event_type" "verification_event_type" NOT NULL,
    "actor_type" "verification_actor_type" NOT NULL,
    "actor_user_id" UUID,
    "notes" VARCHAR(2000),
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_verification_summaries" (
    "provider_id" UUID NOT NULL,
    "levels_passed" INTEGER[],
    "badge" "badge" NOT NULL DEFAULT 'NONE',
    "badge_since" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_verification_summaries_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "kyc_access_logs" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "case_id" UUID,
    "document_ids" TEXT[],
    "action" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_cases_provider_id_level_idx" ON "verification_cases"("provider_id", "level");

-- CreateIndex
CREATE INDEX "verification_cases_status_opened_at_idx" ON "verification_cases"("status", "opened_at");

-- CreateIndex
CREATE INDEX "verification_events_case_id_created_at_idx" ON "verification_events"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_verification_summaries_badge_idx" ON "provider_verification_summaries"("badge");

-- CreateIndex
CREATE INDEX "kyc_access_logs_provider_id_created_at_idx" ON "kyc_access_logs"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "kyc_access_logs_actor_user_id_created_at_idx" ON "kyc_access_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_documents_storage_key_key" ON "provider_documents"("storage_key");

-- CreateIndex
CREATE INDEX "provider_documents_provider_id_status_idx" ON "provider_documents"("provider_id", "status");

-- AddForeignKey
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_events" ADD CONSTRAINT "verification_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_summaries" ADD CONSTRAINT "provider_verification_summaries_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions. Prisma cannot express any of the following.
-- ---------------------------------------------------------------------------

-- Levels are 0 identity, 1 background, 2 skill, 3 references. Nothing else.
ALTER TABLE "verification_cases"
  ADD CONSTRAINT "verification_cases_level_check" CHECK ("level" BETWEEN 0 AND 3),
  ADD CONSTRAINT "verification_cases_closed_at_check" CHECK (
    ("status" IN ('passed', 'failed') AND "closed_at" IS NOT NULL)
    OR ("status" NOT IN ('passed', 'failed') AND "closed_at" IS NULL)
  );

-- At most one live case per (provider, level). A provider retries a failed level
-- by opening a NEW case; the closed one stays untouched forever, which is what
-- makes the history reconstructable.
CREATE UNIQUE INDEX "verification_cases_one_open_per_level_idx"
  ON "verification_cases" ("provider_id", "level")
  WHERE "status" NOT IN ('passed', 'failed');

-- A human action must name the human; a system action must not invent one.
ALTER TABLE "verification_events"
  ADD CONSTRAINT "verification_events_actor_check" CHECK (
    ("actor_type" = 'system' AND "actor_user_id" IS NULL)
    OR ("actor_type" <> 'system' AND "actor_user_id" IS NOT NULL)
  );

-- Levels recorded as passed must be real levels, and each at most once.
--
-- The duplicate test lives in a function because a CHECK constraint may not
-- contain a subquery, and de-duplicating an array needs one. Immutable, so it is
-- safe to constrain on.
CREATE OR REPLACE FUNCTION int_array_is_distinct(arr integer[]) RETURNS boolean AS $$
  SELECT arr IS NULL
      OR cardinality(arr) = (SELECT count(DISTINCT value) FROM unnest(arr) AS value);
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE "provider_verification_summaries"
  ADD CONSTRAINT "provider_verification_summaries_levels_check" CHECK (
    "levels_passed" <@ ARRAY[0, 1, 2, 3]
    AND int_array_is_distinct("levels_passed")
  ),
  ADD CONSTRAINT "provider_verification_summaries_badge_since_check" CHECK (
    ("badge" = 'NONE' AND "badge_since" IS NULL)
    OR ("badge" <> 'NONE' AND "badge_since" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- The append-only guarantee.
--
-- "Why did this technician have a badge on the day of the incident?" is only
-- answerable if no row in the event log can ever be edited or quietly removed.
-- Application discipline is not enough — this is enforced by the database, so a
-- stray UPDATE from a migration, a console session or a future bug cannot
-- rewrite history.
--
-- UPDATE is refused unconditionally. DELETE is refused too, except when the
-- session explicitly sets `fixbridge.allow_kyc_purge = 'on'` — the deliberate
-- escape hatch for DPDP erasure (Phase 14) and for test fixture teardown, which
-- is also what lets the ON DELETE CASCADE from users work at all. Erasing a
-- person's data has to be possible; doing it by accident must not be.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verification_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('fixbridge.allow_kyc_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'verification_events is append-only: % is not permitted (id=%)',
    TG_OP,
    CASE TG_OP WHEN 'DELETE' THEN OLD.id ELSE NEW.id END
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER verification_events_no_update
  BEFORE UPDATE ON "verification_events"
  FOR EACH ROW EXECUTE FUNCTION verification_events_append_only();

CREATE TRIGGER verification_events_no_delete
  BEFORE DELETE ON "verification_events"
  FOR EACH ROW EXECUTE FUNCTION verification_events_append_only();
