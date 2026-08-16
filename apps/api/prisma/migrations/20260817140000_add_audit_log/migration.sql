-- Phase 11 — the audit log, and the per-city entry-approval flag.
--
-- HAND-EDITED. `prisma migrate diff` proposed the same NINE `DROP INDEX`
-- statements it has proposed since Phase 3 — partial, expression, GiST and
-- trigram indexes created by raw SQL that Prisma cannot see in the datamodel.
-- Removed here, as in every previous phase:
--
--   accounts_scope_idx, addresses_location_gist_idx, categories_slug_trgm_idx,
--   commission_config_scope_idx, fee_config_scope_idx,
--   hinglish_synonyms_term_trgm_idx, provider_profiles_base_location_gist_idx,
--   provider_skills_category_provider_idx,
--   provider_verification_summaries_badge_provider_idx
--
-- Dropping them would turn every geo and fuzzy-text query into a sequential scan
-- and remove three uniqueness guarantees.

-- AlterTable
--
-- Off by default, including for Jabalpur. The pilot cannot afford a human in the
-- path of every signup, and completeness + verification already keep an
-- unverified profile out of search. The flag exists per-city because the first
-- city where we do not know the trades personally is exactly where somebody will
-- want it on, and discovering then that it needs a migration is the wrong time.
ALTER TABLE "cities" ADD COLUMN     "require_entry_approval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
--
-- The other half of the flag. Null means "never needed": with the city flag off
-- these columns are simply never read, so turning the feature on later is a
-- config change rather than a backfill.
ALTER TABLE "provider_profiles" ADD COLUMN     "entry_approved_at" TIMESTAMPTZ(3);
ALTER TABLE "provider_profiles" ADD COLUMN     "entry_approved_by" UUID;

-- CreateIndex
--
-- The pending-approval queue: everybody a human has not yet waved through.
-- Partial, because the queue is the small set and the approved are the many.
CREATE INDEX "provider_profiles_pending_entry_idx"
  ON "provider_profiles" ("city_id", "created_at")
  WHERE "entry_approved_at" IS NULL;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" VARCHAR(120),
    "payload" JSONB NOT NULL,
    "ip" VARCHAR(64),
    "request_id" VARCHAR(140),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- AddForeignKey
--
-- SET NULL, not CASCADE. Same reasoning as the ledger: DPDP erasure must be able
-- to remove a person without erasing the record that a decision was taken. The
-- action survives; the link to the human does not.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------
--
-- An audit log that can be edited is not an audit log. UPDATE is refused
-- outright **except** the one narrow case the SET NULL above requires: severing
-- `actor_user_id` when the actor exercises erasure. Without that exception the
-- foreign key could never fire and DPDP erasure of an ops user would be
-- impossible — the same trap `ledger_journals` fell into in Phase 8.
--
-- DELETE is refused unless the purge flag is set, which only
-- `set_config('fixbridge.allow_kyc_purge', 'on', true)` inside a deliberate
-- erasure transaction does.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('fixbridge.allow_kyc_purge', true), '') = 'on' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'audit_logs is append-only: DELETE is not permitted (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The only permitted UPDATE: anonymising the actor. Everything else about the
  -- row — what was done, to whom, with what substance — must be identical.
  IF NEW.id = OLD.id
     AND NEW.action = OLD.action
     AND NEW.target_type = OLD.target_type
     AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
     AND NEW.payload::text = OLD.payload::text
     AND NEW.created_at = OLD.created_at
     AND NEW.actor_user_id IS NULL
     AND OLD.actor_user_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only: row % may not be modified', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
