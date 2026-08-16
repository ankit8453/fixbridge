-- Phase 10 — notifications.
--
-- HAND-EDITED. `prisma migrate diff` proposed NINE `DROP INDEX` statements, and
-- every one of them was wrong. They are indexes created by earlier raw-SQL
-- migrations that Prisma cannot see in the datamodel — partial, expression,
-- GiST and trigram indexes it has no way to express — so every diff since Phase
-- 3 has offered to drop them. Removed here, as in every previous phase:
--
--   accounts_scope_idx                              (NULLS NOT DISTINCT, Phase 8)
--   addresses_location_gist_idx                     (PostGIS, Phase 3)
--   categories_slug_trgm_idx                        (pg_trgm, Phase 3)
--   commission_config_scope_idx                     (NULLS NOT DISTINCT, Phase 8)
--   fee_config_scope_idx                            (NULLS NOT DISTINCT, Phase 7)
--   hinglish_synonyms_term_trgm_idx                 (pg_trgm, Phase 5)
--   provider_profiles_base_location_gist_idx        (PostGIS, Phase 3)
--   provider_skills_category_provider_idx           (covering, Phase 5)
--   provider_verification_summaries_badge_provider_idx (covering, Phase 5)
--
-- Dropping them would silently turn every geo and fuzzy-text query into a
-- sequential scan and remove three uniqueness guarantees.

-- CreateEnum
CREATE TYPE "language" AS ENUM ('hi', 'en');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('in_app', 'whatsapp', 'sms');

-- CreateEnum
CREATE TYPE "notification_criticality" AS ENUM ('critical', 'standard');

-- CreateEnum
CREATE TYPE "notification_delivery_status" AS ENUM ('queued', 'sent', 'failed', 'suppressed_quiet_hours');

-- AlterTable
--
-- Every existing row becomes `hi` by the column default, which is the backfill:
-- the launch city is Jabalpur and Hindi is what people there read. A NOT NULL
-- column with a default needs no separate UPDATE pass.
ALTER TABLE "users" ADD COLUMN     "preferred_language" "language" NOT NULL DEFAULT 'hi';

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "topic" VARCHAR(120) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "title_key" VARCHAR(160) NOT NULL,
    "body_key" VARCHAR(160) NOT NULL,
    "params" JSONB NOT NULL,
    "deep_link" VARCHAR(200),
    "criticality" "notification_criticality" NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "topic" VARCHAR(120) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "transport" VARCHAR(40) NOT NULL,
    "status" "notification_delivery_status" NOT NULL DEFAULT 'queued',
    "transport_ref" VARCHAR(200),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(1000),
    "scheduled_for" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_scheduled_for_idx" ON "notification_deliveries"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");

-- CreateIndex
--
-- THE WALL AGAINST MESSAGING SOMEBODY TWICE.
--
-- The outbox is at-least-once by design, so this consumer will be called more
-- than once for the same event — that is the deal, not a bug. For a projection a
-- replay is harmless. For a message it is not: the human sees it twice, and
-- after the third identical WhatsApp about one booking they stop reading any of
-- them. The insert loses instead, in the database, where a race cannot get past
-- it.
CREATE UNIQUE INDEX "notification_deliveries_topic_aggregate_id_recipient_user_i_key" ON "notification_deliveries"("topic", "aggregate_id", "recipient_user_id", "channel");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- CASCADE on both, and no append-only trigger on either table. A notification is
-- personal data about one person and nothing else depends on it, so DPDP erasure
-- is a plain cascade from `users` — unlike the ledger, where the row must
-- survive and only the link to the person is severed.
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
