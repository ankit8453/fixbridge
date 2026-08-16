-- ===========================================================================
-- Phase 9 — reviews, complaints, the trust engine and suspension.
--
-- HAND-EDITED. `prisma migrate diff` proposed dropping NINE indexes it cannot
-- see, for the eighth phase running:
--
--   addresses_location_gist_idx
--   provider_profiles_base_location_gist_idx
--   categories_slug_trgm_idx
--   hinglish_synonyms_term_trgm_idx
--   provider_skills_category_provider_idx
--   provider_verification_summaries_badge_provider_idx
--   fee_config_scope_idx
--   commission_config_scope_idx
--   accounts_scope_idx
--
-- Raw-SQL GiST, GIN-trigram, covering and NULLS-NOT-DISTINCT indexes, all
-- invisible to the Prisma schema. Every DROP was removed. See docs/geo-notes.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "suspension_reason" AS ENUM ('auto_low_trust', 'auto_repeat_cancellation', 'complaint_severe', 'safety_pending_review', 'ops_manual');
CREATE TYPE "review_direction" AS ENUM ('customer_to_provider', 'provider_to_customer');
CREATE TYPE "review_status" AS ENUM ('published', 'hidden');
CREATE TYPE "complaint_category" AS ENUM ('overcharge', 'no_show', 'quality', 'behavior', 'cash_dispute', 'safety', 'other');
CREATE TYPE "complaint_status" AS ENUM ('open', 'in_review', 'resolved', 'dismissed');
CREATE TYPE "complaint_severity" AS ENUM ('minor', 'major', 'severe');

-- A complaint's every move lands on the booking's timeline. None of them move
-- the booking itself — a dispute is a parallel story about a job, not a state
-- the job is in.
ALTER TYPE "booking_event_type" ADD VALUE 'complaint_opened';
ALTER TYPE "booking_event_type" ADD VALUE 'complaint_in_review';
ALTER TYPE "booking_event_type" ADD VALUE 'complaint_resolved';
ALTER TYPE "booking_event_type" ADD VALUE 'complaint_dismissed';

-- ---------------------------------------------------------------------------
-- Suspension — a separate axis from verification
-- ---------------------------------------------------------------------------

ALTER TABLE "provider_profiles"
  ADD COLUMN "suspended_until" TIMESTAMPTZ(3),
  ADD COLUMN "suspended_at" TIMESTAMPTZ(3),
  ADD COLUMN "suspension_reason" "suspension_reason";

CREATE INDEX "provider_profiles_suspended_until_idx" ON "provider_profiles" ("suspended_until");

-- Suspended or not, coherently. A profile cannot carry an end date with no
-- reason, or a reason with no end date — either would leave ops guessing.
ALTER TABLE "provider_profiles"
  ADD CONSTRAINT "provider_profiles_suspension_check" CHECK (
    ("suspended_until" IS NULL AND "suspended_at" IS NULL AND "suspension_reason" IS NULL)
    OR ("suspended_until" IS NOT NULL AND "suspended_at" IS NOT NULL AND "suspension_reason" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Provider stats — reviews, settled work, complaints, trust
-- ---------------------------------------------------------------------------

ALTER TABLE "provider_stats"
  ADD COLUMN "avg_stars" DOUBLE PRECISION,
  ADD COLUMN "review_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tag_counts" JSONB,
  ADD COLUMN "settled_jobs_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_settled_at" TIMESTAMPTZ(3),
  ADD COLUMN "complaints_minor_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "complaints_major_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "complaints_severe_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trust_score" INTEGER,
  ADD COLUMN "trust_score_updated" TIMESTAMPTZ(3);

ALTER TABLE "provider_stats"
  ADD CONSTRAINT "provider_stats_stars_check" CHECK (
    "avg_stars" IS NULL OR ("avg_stars" >= 1 AND "avg_stars" <= 5)
  ),
  -- Null means "no data yet", which the ranking treats as neutral. Zero means
  -- "we scored them and they scored zero". Keeping both possible, and distinct,
  -- is the whole reason this column is nullable.
  ADD CONSTRAINT "provider_stats_trust_check" CHECK (
    "trust_score" IS NULL OR ("trust_score" >= 0 AND "trust_score" <= 100)
  ),
  ADD CONSTRAINT "provider_stats_counts_nonneg_check" CHECK (
    "review_count" >= 0 AND "settled_jobs_count" >= 0
    AND "complaints_minor_count" >= 0 AND "complaints_major_count" >= 0
    AND "complaints_severe_count" >= 0
  );

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "direction" "review_direction" NOT NULL,
    "author_user_id" UUID NOT NULL,
    "subject_user_id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "tags" TEXT[],
    "text" VARCHAR(500),
    "status" "review_status" NOT NULL DEFAULT 'published',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "review_reports" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- One review per side per booking. Both sides may rate; neither may rate twice.
CREATE UNIQUE INDEX "reviews_booking_id_direction_key" ON "reviews" ("booking_id", "direction");
CREATE INDEX "reviews_subject_user_id_status_created_at_idx" ON "reviews" ("subject_user_id", "status", "created_at");

CREATE INDEX "review_reports_review_id_idx" ON "review_reports" ("review_id");
-- Reporting the same review twice is not two reports.
CREATE UNIQUE INDEX "review_reports_review_id_reporter_user_id_key" ON "review_reports" ("review_id", "reporter_user_id");

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_user_id_fkey"
  FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporter_user_id_fkey"
  FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_stars_check" CHECK ("stars" >= 1 AND "stars" <= 5),
  -- Nobody rates themselves.
  ADD CONSTRAINT "reviews_parties_check" CHECK ("author_user_id" <> "subject_user_id"),
  -- Five tags is already more than anybody reads on a phone.
  ADD CONSTRAINT "reviews_tags_check" CHECK (array_length("tags", 1) IS NULL OR array_length("tags", 1) <= 5);

-- ===========================================================================
-- REVIEWS ARE APPEND-ONLY, EXCEPT FOR MODERATION
--
-- A review is somebody's account of what happened to them. Editing it after the
-- fact — by us, by the author, by anyone — would make every other review
-- unreliable, because a reader could no longer tell which ones had been touched.
--
-- The single permitted change is `status`, so ops can hide something abusive.
-- Hidden reviews are excluded from every aggregate on the next recompute; the
-- row survives, because deleting evidence of a moderation decision is its own
-- kind of dishonesty.
-- ===========================================================================
CREATE OR REPLACE FUNCTION reviews_moderation_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('fixbridge.allow_kyc_purge', true), '') = 'on' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'reviews are append-only: DELETE is not permitted (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.id = OLD.id
     AND NEW.booking_id = OLD.booking_id
     AND NEW.direction = OLD.direction
     AND NEW.author_user_id = OLD.author_user_id
     AND NEW.subject_user_id = OLD.subject_user_id
     AND NEW.stars = OLD.stars
     AND NEW.tags IS NOT DISTINCT FROM OLD.tags
     AND NEW.text IS NOT DISTINCT FROM OLD.text
     AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'review % is immutable: only status may change (moderation)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reviews_moderation_only_update"
  BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION reviews_moderation_only();

CREATE TRIGGER "reviews_no_delete"
  BEFORE DELETE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION reviews_moderation_only();

-- ---------------------------------------------------------------------------
-- Complaints
-- ---------------------------------------------------------------------------

CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "raised_by_user_id" UUID NOT NULL,
    "against_user_id" UUID NOT NULL,
    "category" "complaint_category" NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "status" "complaint_status" NOT NULL DEFAULT 'open',
    "resolution_note" VARCHAR(1000),
    "severity_on_resolution" "complaint_severity",
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "complaints_against_user_id_status_idx" ON "complaints" ("against_user_id", "status");
CREATE INDEX "complaints_status_created_at_idx" ON "complaints" ("status", "created_at");
CREATE INDEX "complaints_booking_id_idx" ON "complaints" ("booking_id");

ALTER TABLE "complaints" ADD CONSTRAINT "complaints_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_raised_by_user_id_fkey"
  FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_against_user_id_fkey"
  FOREIGN KEY ("against_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolved_by_user_id_fkey"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "complaints"
  ADD CONSTRAINT "complaints_parties_check" CHECK ("raised_by_user_id" <> "against_user_id"),
  -- A resolution needs a note and a severity; a dismissal needs a note and
  -- **no** severity. An accusation that did not stand up is not a record
  -- against anybody, and giving it a severity would make it one.
  ADD CONSTRAINT "complaints_resolution_check" CHECK (
    ("status" = 'resolved' AND "resolution_note" IS NOT NULL AND "severity_on_resolution" IS NOT NULL AND "resolved_at" IS NOT NULL)
    OR ("status" = 'dismissed' AND "resolution_note" IS NOT NULL AND "severity_on_resolution" IS NULL AND "resolved_at" IS NOT NULL)
    OR ("status" IN ('open', 'in_review') AND "severity_on_resolution" IS NULL AND "resolved_at" IS NULL)
  );

-- ---------------------------------------------------------------------------
-- Trust score snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE "trust_score_snapshots" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "components" JSONB NOT NULL,
    "badge_band_after" "badge" NOT NULL,
    "trigger_topic" VARCHAR(120) NOT NULL,
    "trigger_aggregate_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_score_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trust_score_snapshots_provider_id_created_at_idx"
  ON "trust_score_snapshots" ("provider_id", "created_at");

ALTER TABLE "trust_score_snapshots" ADD CONSTRAINT "trust_score_snapshots_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trust_score_snapshots"
  ADD CONSTRAINT "trust_score_snapshots_score_check" CHECK ("score" >= 0 AND "score" <= 100);

-- ===========================================================================
-- SNAPSHOTS ARE APPEND-ONLY
--
-- A snapshot is the answer to "why was my score 62 last Tuesday". Rewriting one
-- would destroy the only record of what the engine actually did, which is the
-- whole reason the table exists rather than a single mutable column.
--
-- A recompute writes a new row. It never edits the last one.
-- ===========================================================================
CREATE OR REPLACE FUNCTION trust_snapshots_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('fixbridge.allow_kyc_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'trust_score_snapshots is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trust_score_snapshots_no_update"
  BEFORE UPDATE ON "trust_score_snapshots"
  FOR EACH ROW EXECUTE FUNCTION trust_snapshots_append_only();

CREATE TRIGGER "trust_score_snapshots_no_delete"
  BEFORE DELETE ON "trust_score_snapshots"
  FOR EACH ROW EXECUTE FUNCTION trust_snapshots_append_only();
