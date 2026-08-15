-- Generated with `prisma migrate diff`, then hand-edited. The generated output
-- began by dropping SIX hand-written indexes it cannot see in the schema:
--
--   addresses_location_gist_idx
--   provider_profiles_base_location_gist_idx
--   categories_slug_trgm_idx
--   hinglish_synonyms_term_trgm_idx
--   provider_skills_category_provider_idx
--   provider_verification_summaries_badge_provider_idx
--
-- All six are removed here. The list grows every phase, because Prisma reads any
-- index it did not author as drift. See docs/geo-notes.md.

-- CreateExtension
-- Required by the exclusion constraint below: it lets a GiST index hold the
-- plain-equality half (provider_id) alongside the range-overlap half.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "slot_status" AS ENUM ('open', 'held', 'booked', 'blocked');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('REQUESTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'WORK_DONE', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER');

-- CreateEnum
CREATE TYPE "booking_event_type" AS ENUM ('requested', 'accepted', 'rejected', 'expired', 'en_route', 'arrived', 'work_started', 'work_done', 'cancelled_by_customer', 'cancelled_by_provider', 'otp_failed', 'otp_locked');

-- CreateEnum
CREATE TYPE "booking_actor_type" AS ENUM ('customer', 'provider', 'system', 'ops');

-- CreateTable
CREATE TABLE "slots" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "time_range" tstzrange NOT NULL,
    "status" "slot_status" NOT NULL DEFAULT 'open',
    "source_template_id" UUID,
    "booking_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "category_id" INTEGER NOT NULL,
    "price_card_id" UUID,
    "address_id" UUID,
    "address_snapshot" JSONB NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "problem_note" VARCHAR(500),
    "visit_fee_paise" INTEGER NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'REQUESTED',
    "rescheduled_from_booking_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "event_type" "booking_event_type" NOT NULL,
    "actor_type" "booking_actor_type" NOT NULL,
    "actor_user_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(120) NOT NULL,
    "aggregate_type" VARCHAR(60) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(2000),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_stats" (
    "provider_id" UUID NOT NULL,
    "accepted_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "expired_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_by_provider_count" INTEGER NOT NULL DEFAULT 0,
    "acceptance_rate" DOUBLE PRECISION,
    "window_days" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_stats_pkey" PRIMARY KEY ("provider_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slots_booking_id_key" ON "slots"("booking_id");

-- CreateIndex
CREATE INDEX "slots_provider_id_starts_at_idx" ON "slots"("provider_id", "starts_at");

-- CreateIndex
CREATE INDEX "slots_status_starts_at_idx" ON "slots"("status", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_customer_id_created_at_idx" ON "bookings"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "bookings_provider_id_created_at_idx" ON "bookings"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "bookings_status_created_at_idx" ON "bookings"("status", "created_at");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events"("booking_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_processed_at_next_attempt_at_idx" ON "outbox"("processed_at", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_aggregate_type_aggregate_id_idx" ON "outbox"("aggregate_type", "aggregate_id");

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "provider_availability_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_price_card_id_fkey" FOREIGN KEY ("price_card_id") REFERENCES "provider_price_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_stats" ADD CONSTRAINT "provider_stats_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- THE DOUBLE-BOOKING WALL
--
-- This is the reason the phase exists. Two customers hitting "book" on the same
-- hour at the same instant must not both succeed, and no amount of application
-- care can guarantee that — a check-then-insert is a race however carefully it
-- is written, and a Redis lock disappears the moment Redis blinks.
--
-- So the guarantee lives in the database. Postgres will refuse to hold two
-- overlapping live slots for one provider, whatever the caller believes.
--
-- `WHERE status IN ('held','booked')` matters: `open` and `blocked` slots are
-- allowed to overlap, which is what makes template regeneration possible.
-- ===========================================================================
ALTER TABLE "slots"
  ADD CONSTRAINT "slots_no_double_booking"
  EXCLUDE USING gist (provider_id WITH =, time_range WITH &&)
  WHERE (status IN ('held', 'booked'));

-- `time_range` is derived, never supplied. Keeping it in a trigger means it
-- cannot drift from starts_at/ends_at, and lets Prisma insert rows normally
-- despite the column being NOT NULL and Unsupported — BEFORE triggers run
-- ahead of the NOT NULL check.
CREATE OR REPLACE FUNCTION slots_sync_time_range() RETURNS trigger AS $$
BEGIN
  NEW.time_range := tstzrange(NEW.starts_at, NEW.ends_at, '[)');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER slots_sync_time_range_trigger
  BEFORE INSERT OR UPDATE OF starts_at, ends_at ON "slots"
  FOR EACH ROW EXECUTE FUNCTION slots_sync_time_range();

ALTER TABLE "slots"
  ADD CONSTRAINT "slots_time_order_check" CHECK ("ends_at" > "starts_at"),
  -- A booked slot must name its booking; an open one must not.
  ADD CONSTRAINT "slots_booking_link_check" CHECK (
    ("status" IN ('held', 'booked') AND "booking_id" IS NOT NULL)
    OR ("status" IN ('open', 'blocked') AND "booking_id" IS NULL)
  );

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_order_check" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "bookings_visit_fee_check" CHECK ("visit_fee_paise" >= 0);

-- ===========================================================================
-- APPEND-ONLY BOOKING HISTORY
--
-- Identical discipline to verification_events, and for the same reason: "what
-- actually happened on this job" has to survive a dispute months later. UPDATE
-- is refused outright; DELETE only under the same explicit purge flag, which is
-- what lets ON DELETE CASCADE and DPDP erasure work at all.
-- ===========================================================================
CREATE OR REPLACE FUNCTION booking_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('fixbridge.allow_kyc_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'booking_events is append-only: % is not permitted (id=%)',
    TG_OP,
    CASE TG_OP WHEN 'DELETE' THEN OLD.id ELSE NEW.id END
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_events_no_update
  BEFORE UPDATE ON "booking_events"
  FOR EACH ROW EXECUTE FUNCTION booking_events_append_only();

CREATE TRIGGER booking_events_no_delete
  BEFORE DELETE ON "booking_events"
  FOR EACH ROW EXECUTE FUNCTION booking_events_append_only();

ALTER TABLE "booking_events"
  ADD CONSTRAINT "booking_events_actor_check" CHECK (
    ("actor_type" = 'system' AND "actor_user_id" IS NULL)
    OR ("actor_type" <> 'system' AND "actor_user_id" IS NOT NULL)
  );

-- The dispatcher's hot query: unprocessed rows whose backoff has elapsed.
CREATE INDEX "outbox_pending_idx"
  ON "outbox" ("next_attempt_at", "created_at")
  WHERE "processed_at" IS NULL;

ALTER TABLE "outbox"
  ADD CONSTRAINT "outbox_attempts_check" CHECK ("attempts" >= 0);

ALTER TABLE "provider_stats"
  ADD CONSTRAINT "provider_stats_counts_check" CHECK (
    "accepted_count" >= 0 AND "rejected_count" >= 0
    AND "expired_count" >= 0 AND "cancelled_by_provider_count" >= 0
  ),
  ADD CONSTRAINT "provider_stats_rate_check" CHECK (
    "acceptance_rate" IS NULL OR ("acceptance_rate" >= 0 AND "acceptance_rate" <= 1)
  );

-- Search asks "does this provider have an open slot covering the window?" on
-- every availability-filtered query.
CREATE INDEX "slots_open_provider_window_idx"
  ON "slots" ("provider_id", "starts_at", "ends_at")
  WHERE "status" = 'open';
