-- ===========================================================================
-- Phase 8 — the ledger, payments, refunds and payouts.
--
-- THE TWO LAWS (docs/money.md):
--   1. Money exists ONLY as double-entry ledger rows. No balance column, ever.
--   2. The gateway webhook is the only source of payment truth.
--
-- HAND-EDITED. `prisma migrate diff` proposed dropping SEVEN indexes it cannot
-- see, for the seventh phase running:
--
--   addresses_location_gist_idx
--   provider_profiles_base_location_gist_idx
--   categories_slug_trgm_idx
--   hinglish_synonyms_term_trgm_idx
--   provider_skills_category_provider_idx
--   provider_verification_summaries_badge_provider_idx
--   fee_config_scope_idx            (new this time — the NULLS NOT DISTINCT one)
--
-- Every DROP was removed. See docs/geo-notes.md before regenerating anything.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "account_type" AS ENUM ('gateway_cash', 'provider_payable', 'provider_dues', 'platform_revenue', 'refunds_payable');
CREATE TYPE "account_owner_type" AS ENUM ('platform', 'provider', 'customer');
CREATE TYPE "ledger_journal_type" AS ENUM ('payment_captured', 'cash_collected', 'refund', 'payout', 'dues_settled', 'adjustment');
CREATE TYPE "ledger_direction" AS ENUM ('debit', 'credit');
CREATE TYPE "payment_purpose" AS ENUM ('final_bill', 'visit_fee_upfront');
CREATE TYPE "payment_method" AS ENUM ('online', 'cash');
CREATE TYPE "payment_gateway_name" AS ENUM ('fake', 'razorpay');
CREATE TYPE "payment_status" AS ENUM ('created', 'captured', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE "refund_status" AS ENUM ('created', 'processed', 'failed');
CREATE TYPE "payout_batch_status" AS ENUM ('draft', 'processing', 'completed');
CREATE TYPE "payout_status" AS ENUM ('pending', 'paid', 'failed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "account_type" "account_type" NOT NULL,
    "owner_type" "account_owner_type" NOT NULL,
    "owner_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_journals" (
    "id" UUID NOT NULL,
    "journal_type" "ledger_journal_type" NOT NULL,
    "booking_id" UUID,
    "payment_id" UUID,
    "memo" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_journals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commission_config" (
    "id" UUID NOT NULL,
    "city_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "rate_bps" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commission_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID,
    "purpose" "payment_purpose" NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "commission_bps_snapshot" INTEGER NOT NULL,
    "gateway" "payment_gateway_name",
    "gateway_order_id" VARCHAR(120),
    "gateway_payment_id" VARCHAR(120),
    "status" "payment_status" NOT NULL DEFAULT 'created',
    "checkout_verified_at" TIMESTAMPTZ(3),
    "captured_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "gateway_refund_id" VARCHAR(120),
    "status" "refund_status" NOT NULL DEFAULT 'created',
    "reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "gateway" VARCHAR(40) NOT NULL,
    "gateway_event_id" VARCHAR(200) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "processing_error" VARCHAR(1000),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payout_batches" (
    "id" UUID NOT NULL,
    "status" "payout_batch_status" NOT NULL DEFAULT 'draft',
    "created_by" UUID,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "payout_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'pending',
    "utr_ref" VARCHAR(60),
    "paid_at" TIMESTAMPTZ(3),
    "failure_note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX "ledger_journals_journal_type_created_at_idx" ON "ledger_journals" ("journal_type", "created_at");
CREATE INDEX "ledger_journals_booking_id_idx" ON "ledger_journals" ("booking_id");
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries" ("account_id", "created_at");
CREATE INDEX "ledger_entries_journal_id_idx" ON "ledger_entries" ("journal_id");
CREATE INDEX "commission_config_city_id_is_active_effective_from_idx" ON "commission_config" ("city_id", "is_active", "effective_from");
CREATE INDEX "payments_booking_id_idx" ON "payments" ("booking_id");
CREATE INDEX "payments_status_created_at_idx" ON "payments" ("status", "created_at");
CREATE INDEX "refunds_payment_id_idx" ON "refunds" ("payment_id");
CREATE UNIQUE INDEX "webhook_events_gateway_event_id_key" ON "webhook_events" ("gateway_event_id");
CREATE INDEX "webhook_events_processed_at_received_at_idx" ON "webhook_events" ("processed_at", "received_at");
CREATE INDEX "webhook_events_event_type_idx" ON "webhook_events" ("event_type");
CREATE INDEX "payout_batches_status_created_at_idx" ON "payout_batches" ("status", "created_at");
CREATE INDEX "payouts_provider_id_created_at_idx" ON "payouts" ("provider_id", "created_at");
CREATE UNIQUE INDEX "payouts_batch_id_provider_id_key" ON "payouts" ("batch_id", "provider_id");

-- One account per (type, owner). `NULLS NOT DISTINCT` because platform accounts
-- have a NULL owner and, under the ordinary rule, two NULLs are different —
-- which would let a second `platform_revenue` account exist and silently split
-- the platform's income across both.
CREATE UNIQUE INDEX "accounts_scope_idx"
  ON "accounts" ("account_type", "owner_type", "owner_id") NULLS NOT DISTINCT;

-- Same shape as fee_config: one rate per scope per effective date.
CREATE UNIQUE INDEX "commission_config_scope_idx"
  ON "commission_config" ("city_id", "category_id", "effective_from") NULLS NOT DISTINCT;

-- ===========================================================================
-- ONE LIVE PAYMENT PER BOOKING PER PURPOSE
--
-- `failed` is excluded so a customer whose UPI dropped can try again, and the
-- purpose is in the key so an upfront visit fee and a final bill can coexist on
-- the same booking when COLLECT_FEE_AT_BOOKING is on.
--
-- NULLS DISTINCT (the default) is deliberate here, unlike the accounts index
-- above: `booking_id` is nulled on erasure, and purged rows must not start
-- colliding with each other years later.
-- ===========================================================================
CREATE UNIQUE INDEX "payments_one_live_per_purpose_idx"
  ON "payments" ("booking_id", "purpose")
  WHERE ("status" <> 'failed');

-- ===========================================================================
-- ONE PAYMENT PER GATEWAY ORDER
--
-- A gateway order id identifies exactly one attempt to collect exactly one
-- bill, and the webhook handler finds a payment *by* that id — so two payments
-- sharing one would make the lookup ambiguous and the capture land on whichever
-- row happened to come back first. Enforcing it here means the question cannot
-- arise, rather than being answered correctly by convention.
-- ===========================================================================
CREATE UNIQUE INDEX "payments_gateway_order_id_key"
  ON "payments" ("gateway_order_id")
  WHERE ("gateway_order_id" IS NOT NULL);

-- Same reasoning for the refund's own id: the `refund.processed` webhook is
-- matched on it.
CREATE UNIQUE INDEX "refunds_gateway_refund_id_key"
  ON "refunds" ("gateway_refund_id")
  WHERE ("gateway_refund_id" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

-- SET NULL, not CASCADE, on every link from money to a person's booking.
--
-- A financial record is not personal data and must survive a DPDP erasure —
-- what gets cut is the link to the human, not the money. This is also why the
-- ledger tables below have no purge escape hatch at all.
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey"
  FOREIGN KEY ("journal_id") REFERENCES "ledger_journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: an account with entries against it can never be removed.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commission_config" ADD CONSTRAINT "commission_config_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commission_config" ADD CONSTRAINT "commission_config_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

-- A platform account has no owner; anybody else's must have one.
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_owner_check" CHECK (
    ("owner_type" = 'platform' AND "owner_id" IS NULL)
    OR ("owner_type" <> 'platform' AND "owner_id" IS NOT NULL)
  );

-- A zero-value entry is not a movement of money; a negative one is a direction
-- written the wrong way round. Both are bugs, and both are refused.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_check" CHECK ("amount_paise" > 0);

ALTER TABLE "commission_config"
  ADD CONSTRAINT "commission_config_rate_check" CHECK ("rate_bps" >= 0 AND "rate_bps" <= 10000);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK ("amount_paise" > 0),
  ADD CONSTRAINT "payments_commission_check" CHECK (
    "commission_bps_snapshot" >= 0 AND "commission_bps_snapshot" <= 10000
  ),
  -- Cash has no gateway, no order and no webhook. Saying so in the schema stops
  -- three columns from being permanently null with nothing explaining why.
  ADD CONSTRAINT "payments_rail_check" CHECK (
    ("method" = 'online' AND "gateway" IS NOT NULL AND "gateway_order_id" IS NOT NULL)
    OR ("method" = 'cash' AND "gateway" IS NULL AND "gateway_order_id" IS NULL
        AND "gateway_payment_id" IS NULL AND "checkout_verified_at" IS NULL)
  ),
  ADD CONSTRAINT "payments_captured_check" CHECK (
    ("status" IN ('captured', 'refunded', 'partially_refunded') AND "captured_at" IS NOT NULL)
    OR ("status" IN ('created', 'failed') AND "captured_at" IS NULL)
  );

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_check" CHECK ("amount_paise" > 0);

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amount_check" CHECK ("amount_paise" > 0),
  ADD CONSTRAINT "payouts_paid_check" CHECK (
    ("status" = 'paid' AND "paid_at" IS NOT NULL AND "utr_ref" IS NOT NULL)
    OR ("status" <> 'paid')
  );

ALTER TABLE "payout_batches"
  ADD CONSTRAINT "payout_batches_totals_check" CHECK ("total_paise" >= 0 AND "payout_count" >= 0);

-- ===========================================================================
-- LAW #1, ENFORCED
--
-- Every journal must balance: Σ debits = Σ credits.
--
-- This is a DEFERRED constraint trigger, which is the only way to express it:
-- entries are inserted one at a time, so any check that ran per-statement would
-- fail on the first row of a perfectly good journal. Deferring to COMMIT means
-- the assertion is made about the finished journal, and a transaction that
-- would leave the books unbalanced cannot commit at all.
--
-- Note what this is NOT: a validation in the service. The service validates too,
-- because a clear error beats a constraint violation — but if the two ever
-- disagree, this one wins, and money cannot go missing because somebody wrote a
-- new repository that forgot to call the old one.
-- ===========================================================================
CREATE OR REPLACE FUNCTION ledger_journal_must_balance(target UUID) RETURNS void AS $$
DECLARE
  debits BIGINT;
  credits BIGINT;
  lines INT;
BEGIN
  SELECT
    coalesce(sum("amount_paise") FILTER (WHERE "direction" = 'debit'), 0),
    coalesce(sum("amount_paise") FILTER (WHERE "direction" = 'credit'), 0),
    count(*)
  INTO debits, credits, lines
  FROM "ledger_entries"
  WHERE "journal_id" = target;

  -- A journal with one line cannot be double entry, whatever the arithmetic.
  IF lines < 2 THEN
    RAISE EXCEPTION 'ledger journal % has % entries; double entry needs at least two', target, lines
      USING ERRCODE = 'check_violation';
  END IF;

  IF debits <> credits THEN
    RAISE EXCEPTION 'ledger journal % does not balance: debits=% credits=%', target, debits, credits
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ledger_entry_balance_check() RETURNS trigger AS $$
BEGIN
  PERFORM ledger_journal_must_balance(NEW.journal_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ledger_journal_balance_check() RETURNS trigger AS $$
BEGIN
  PERFORM ledger_journal_must_balance(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_entries_must_balance"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_balance_check();

-- The journal-side trigger catches the case the entry-side one cannot see: a
-- journal written with no entries at all.
CREATE CONSTRAINT TRIGGER "ledger_journals_must_balance"
  AFTER INSERT ON "ledger_journals"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_journal_balance_check();

-- ===========================================================================
-- APPEND-ONLY, WITH NO ESCAPE HATCH
--
-- `verification_events` and `booking_events` allow DELETE under the DPDP purge
-- flag because they describe a person. Ledger rows describe money: they are not
-- personal data, they carry statutory retention, and an erasure request cuts the
-- link (`booking_id` → NULL) rather than the record. So there is no flag here,
-- and a correction is an `adjustment` journal — which is what double entry is
-- for in the first place.
-- ===========================================================================
CREATE OR REPLACE FUNCTION ledger_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% is immutable: % is never permitted — post an adjustment journal instead',
    TG_TABLE_NAME,
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

/**
 * Journals are immutable with exactly one exception: **cutting the link to a
 * person**.
 *
 * `booking_id` and `payment_id` are ON DELETE SET NULL precisely so an erasure
 * can remove the booking and leave the money — and SET NULL is an UPDATE, so a
 * blanket refusal would make erasure impossible instead of making the ledger
 * safe. The rule is therefore narrow and stated exactly: those two columns may
 * go from a value to NULL, and nothing else about a journal may ever change.
 */
CREATE OR REPLACE FUNCTION ledger_journal_update_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.id = OLD.id
     AND NEW.journal_type = OLD.journal_type
     AND NEW.created_at = OLD.created_at
     AND NEW.memo IS NOT DISTINCT FROM OLD.memo
     -- Only ever value → NULL, never NULL → value and never value → other value.
     AND (NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id OR NEW.booking_id IS NULL)
     AND (NEW.payment_id IS NOT DISTINCT FROM OLD.payment_id OR NEW.payment_id IS NULL)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ledger_journals is immutable: only booking_id and payment_id may be cleared (erasure) — post an adjustment journal instead'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_journals_no_update"
  BEFORE UPDATE ON "ledger_journals"
  FOR EACH ROW EXECUTE FUNCTION ledger_journal_update_guard();

CREATE TRIGGER "ledger_journals_no_delete"
  BEFORE DELETE ON "ledger_journals"
  FOR EACH ROW EXECUTE FUNCTION ledger_is_immutable();

CREATE TRIGGER "ledger_entries_no_update"
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_is_immutable();

CREATE TRIGGER "ledger_entries_no_delete"
  BEFORE DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_is_immutable();

-- ===========================================================================
-- BALANCES ARE VIEWS
--
-- Law #1 again, in the shape it takes at read time. There is no balance column
-- to drift, no cache to invalidate, and no way for a balance to be wrong that
-- does not involve the entries themselves being wrong.
--
-- Sign conventions, stated once:
--   asset      (gateway_cash, provider_dues)                debits − credits
--   liability  (provider_payable, refunds_payable)          credits − debits
--   revenue    (platform_revenue)                           credits − debits
-- ===========================================================================
CREATE OR REPLACE VIEW "account_balances" AS
SELECT
  a."id"           AS account_id,
  a."account_type" AS account_type,
  a."owner_type"   AS owner_type,
  a."owner_id"     AS owner_id,
  coalesce(sum(CASE WHEN e."direction" = 'debit' THEN e."amount_paise" ELSE 0 END), 0)::BIGINT  AS debits_paise,
  coalesce(sum(CASE WHEN e."direction" = 'credit' THEN e."amount_paise" ELSE 0 END), 0)::BIGINT AS credits_paise,
  -- Signed so that a positive number always means "this account holds value",
  -- whichever side of the books it lives on.
  CASE
    WHEN a."account_type" IN ('gateway_cash', 'provider_dues')
      THEN coalesce(sum(CASE WHEN e."direction" = 'debit' THEN e."amount_paise" ELSE -e."amount_paise" END), 0)
    ELSE coalesce(sum(CASE WHEN e."direction" = 'credit' THEN e."amount_paise" ELSE -e."amount_paise" END), 0)
  END::BIGINT AS balance_paise
FROM "accounts" a
LEFT JOIN "ledger_entries" e ON e."account_id" = a."id"
GROUP BY a."id", a."account_type", a."owner_type", a."owner_id";

CREATE OR REPLACE VIEW "provider_balances" AS
SELECT
  b.owner_id AS provider_id,
  coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'provider_payable'), 0)::BIGINT AS payable_paise,
  coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'provider_dues'), 0)::BIGINT    AS dues_paise,
  (
    coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'provider_payable'), 0)
    - coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'provider_dues'), 0)
  )::BIGINT AS net_paise
FROM "account_balances" b
WHERE b.owner_type = 'provider'
GROUP BY b.owner_id;

CREATE OR REPLACE VIEW "platform_revenue_view" AS
SELECT
  coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'platform_revenue'), 0)::BIGINT AS revenue_paise,
  coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'gateway_cash'), 0)::BIGINT     AS gateway_cash_paise,
  coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'provider_payable'), 0)::BIGINT AS owed_to_providers_paise,
  coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'provider_dues'), 0)::BIGINT    AS owed_by_providers_paise,
  coalesce(sum(b.balance_paise) FILTER (WHERE b.account_type = 'refunds_payable'), 0)::BIGINT  AS refunds_pending_paise
FROM "account_balances" b;

-- ---------------------------------------------------------------------------
-- Payout batch totals
-- ---------------------------------------------------------------------------
--
-- A batch header that disagrees with its own lines is how a payout run quietly
-- pays the wrong amount. Deferred, because the header is written before the
-- lines it describes.
CREATE OR REPLACE FUNCTION payout_batch_totals_match() RETURNS trigger AS $$
DECLARE
  line_total BIGINT;
  line_count INT;
BEGIN
  SELECT coalesce(sum("amount_paise"), 0), count(*)
  INTO line_total, line_count
  FROM "payouts" WHERE "batch_id" = NEW."id";

  IF line_total <> NEW."total_paise" OR line_count <> NEW."payout_count" THEN
    RAISE EXCEPTION
      'payout batch % header says %p over % payouts but its lines say %p over %',
      NEW."id", NEW."total_paise", NEW."payout_count", line_total, line_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "payout_batches_totals_match"
  AFTER INSERT ON "payout_batches"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_batch_totals_match();
