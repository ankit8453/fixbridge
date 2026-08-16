-- ===========================================================================
-- Phase 7 — quotations, quotation items and the visit-fee config table.
--
-- HAND-EDITED. `prisma migrate diff` proposed dropping SIX indexes it cannot
-- see, for the sixth phase running:
--
--   addresses_location_gist_idx
--   provider_profiles_base_location_gist_idx
--   categories_slug_trgm_idx
--   hinglish_synonyms_term_trgm_idx
--   provider_skills_category_provider_idx
--   provider_verification_summaries_badge_provider_idx
--
-- They are raw-SQL GiST, GIN-trigram and covering indexes, invisible to the
-- Prisma schema and therefore "unknown" to the differ. Every DROP was removed.
-- See docs/geo-notes.md before regenerating anything here.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "quotation_status" AS ENUM ('sent', 'approved', 'rejected', 'superseded', 'withdrawn');

CREATE TYPE "quotation_item_kind" AS ENUM ('part', 'labour_extra');

-- The booking machine is extended, not restructured: new rows in the transition
-- table need new values here. Quote events do not move a booking; `work_declined`
-- does.
ALTER TYPE "booking_event_type" ADD VALUE 'quote_sent';
ALTER TYPE "booking_event_type" ADD VALUE 'quote_withdrawn';
ALTER TYPE "booking_event_type" ADD VALUE 'quote_approved';
ALTER TYPE "booking_event_type" ADD VALUE 'quote_rejected';
ALTER TYPE "booking_event_type" ADD VALUE 'work_declined';

ALTER TYPE "booking_status" ADD VALUE 'CLOSED_QUOTE_DECLINED';

-- ---------------------------------------------------------------------------
-- Frozen payable
-- ---------------------------------------------------------------------------

-- What the customer owes, decided once at the terminal transition. Phase 8
-- charges this number and never recomputes one.
ALTER TABLE "bookings"
  ADD COLUMN "payable_paise" INTEGER,
  ADD COLUMN "payable_breakdown" JSONB;

-- ---------------------------------------------------------------------------
-- Fee config
-- ---------------------------------------------------------------------------

CREATE TABLE "fee_config" (
    "id" UUID NOT NULL,
    "city_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "visit_fee_paise" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_config_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fee_config_city_id_is_active_effective_from_idx"
  ON "fee_config" ("city_id", "is_active", "effective_from");

ALTER TABLE "fee_config" ADD CONSTRAINT "fee_config_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fee_config" ADD CONSTRAINT "fee_config_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fee_config"
  ADD CONSTRAINT "fee_config_amount_check" CHECK ("visit_fee_paise" >= 0);

-- One row per scope per effective date.
--
-- `NULLS NOT DISTINCT` (Postgres 15+) is what makes this work: `category_id` is
-- NULL for a city default, and under the ordinary rule two NULLs are considered
-- different, so a plain unique index would happily allow two conflicting city
-- defaults for the same date — and the resolver would then have to pick one
-- arbitrarily.
CREATE UNIQUE INDEX "fee_config_scope_idx"
  ON "fee_config" ("city_id", "category_id", "effective_from") NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------

CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "quotation_status" NOT NULL DEFAULT 'sent',
    "labour_paise" INTEGER NOT NULL,
    "parts_total_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "created_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotation_items" (
    "id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "kind" "quotation_item_kind" NOT NULL,
    "description" VARCHAR(120) NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_paise" INTEGER NOT NULL,
    "line_total_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quotations_booking_id_created_at_idx" ON "quotations" ("booking_id", "created_at");

CREATE UNIQUE INDEX "quotations_booking_id_version_key" ON "quotations" ("booking_id", "version");

CREATE INDEX "quotation_items_quotation_id_idx" ON "quotation_items" ("quotation_id");

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- THE PRICING WALL
--
-- At most one quotation per booking may be `sent` or `approved`.
--
-- This single partial index closes both races the phase cares about:
--
--   * two providers' devices sending a revision at once — both would insert a
--     `sent` row, and one is refused;
--   * a customer approving v1 while the provider sends v2 — the approval leaves
--     v1 live and the insert of v2 collides, so exactly one commits.
--
-- Application code narrows the window and turns the loss into a friendly 409.
-- This is the part that makes it impossible.
-- ===========================================================================
CREATE UNIQUE INDEX "quotations_one_live_per_booking_idx"
  ON "quotations" ("booking_id")
  WHERE ("status" IN ('sent', 'approved'));

-- ---------------------------------------------------------------------------
-- Money math, enforced by the database
-- ---------------------------------------------------------------------------

-- Totals are derived, so they are checked rather than trusted. A service bug
-- that miscomputes a total cannot reach a customer's screen.
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "quotations_labour_check" CHECK ("labour_paise" >= 0),
  ADD CONSTRAINT "quotations_parts_check" CHECK ("parts_total_paise" >= 0),
  ADD CONSTRAINT "quotations_total_check" CHECK ("total_paise" = "labour_paise" + "parts_total_paise"),
  -- A pure-labour quote is legal. An empty one is not: "₹0, please approve"
  -- is not a price, it is a bug.
  ADD CONSTRAINT "quotations_nonempty_check" CHECK ("total_paise" > 0),
  -- `sent` is the only live state, and the only one without a decision time.
  ADD CONSTRAINT "quotations_decided_check" CHECK (
    ("status" = 'sent' AND "decided_at" IS NULL)
    OR ("status" <> 'sent' AND "decided_at" IS NOT NULL)
  ),
  -- A reason only makes sense on a rejection.
  ADD CONSTRAINT "quotations_decision_note_check" CHECK (
    "decision_note" IS NULL OR "status" = 'rejected'
  );

ALTER TABLE "quotation_items"
  ADD CONSTRAINT "quotation_items_qty_check" CHECK ("qty" >= 1),
  ADD CONSTRAINT "quotation_items_unit_check" CHECK ("unit_paise" > 0),
  ADD CONSTRAINT "quotation_items_line_total_check" CHECK ("line_total_paise" = "qty" * "unit_paise"),
  ADD CONSTRAINT "quotation_items_description_check" CHECK (length(btrim("description")) > 0);

-- ===========================================================================
-- IMMUTABILITY
--
-- The customer saw v1. v1 has to survive forever, exactly as it was shown —
-- that is the entire trust proposition of an itemised quote, and a convention
-- enforced only in TypeScript is not a proposition, it is a hope.
--
-- Quotations accept exactly one kind of UPDATE: leaving `sent`. Nothing else
-- about a quotation may ever change, and its items may not change at all.
-- ===========================================================================
CREATE OR REPLACE FUNCTION quotations_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('fixbridge.allow_kyc_purge', true), '') = 'on' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'quotations are append-only: DELETE is not permitted (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Only a live quote can move, and only out of `sent`.
  IF OLD.status <> 'sent' THEN
    RAISE EXCEPTION 'quotation % is already %; it cannot be changed', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'sent' THEN
    RAISE EXCEPTION 'quotation % cannot be updated while it stays sent', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Everything that made up the price is frozen.
  IF NEW.id <> OLD.id
     OR NEW.booking_id <> OLD.booking_id
     OR NEW.version <> OLD.version
     OR NEW.labour_paise <> OLD.labour_paise
     OR NEW.parts_total_paise <> OLD.parts_total_paise
     OR NEW.total_paise <> OLD.total_paise
     OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at
     OR NEW.note IS DISTINCT FROM OLD.note
  THEN
    RAISE EXCEPTION 'quotation % is immutable: only status, decided_at and decision_note may change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotations_immutable_update
  BEFORE UPDATE ON "quotations"
  FOR EACH ROW EXECUTE FUNCTION quotations_immutable();

CREATE TRIGGER quotations_immutable_delete
  BEFORE DELETE ON "quotations"
  FOR EACH ROW EXECUTE FUNCTION quotations_immutable();

CREATE OR REPLACE FUNCTION quotation_items_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('fixbridge.allow_kyc_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'quotation_items is append-only: % is not permitted (id=%)',
    TG_OP,
    CASE TG_OP WHEN 'DELETE' THEN OLD.id ELSE NEW.id END
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotation_items_no_update
  BEFORE UPDATE ON "quotation_items"
  FOR EACH ROW EXECUTE FUNCTION quotation_items_immutable();

CREATE TRIGGER quotation_items_no_delete
  BEFORE DELETE ON "quotation_items"
  FOR EACH ROW EXECUTE FUNCTION quotation_items_immutable();
