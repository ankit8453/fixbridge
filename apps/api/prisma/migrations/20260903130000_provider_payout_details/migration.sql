-- Where a technician's money goes.
--
-- One row per technician, created the first time they fill the form — which is
-- before their first payout, not at signup. Until then there is no row, and
-- `buildPayoutBatch` skips them with a reason rather than drafting a transfer
-- nobody can make.

CREATE TYPE "payout_method" AS ENUM ('bank', 'upi');

CREATE TABLE "provider_payout_details" (
  "user_id"        UUID PRIMARY KEY,
  "method"         "payout_method" NOT NULL,

  -- Whole, not last-four. Somebody has to type this into a banking screen for
  -- the money to move, which is the difference between this and the identity
  -- numbers in verification.
  "account_number" VARCHAR(20),
  "ifsc"           VARCHAR(11),
  "account_holder" VARCHAR(120),

  "upi_id"         VARCHAR(120),
  "pan"            VARCHAR(10),

  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "provider_payout_details_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "provider_profiles"("user_id") ON DELETE CASCADE
);

-- The service validates this too, but the constraint is what makes it true of
-- every row that has ever existed. A half-filled bank record is worse than an
-- empty one: it looks answered on the screen and cannot be paid.
ALTER TABLE "provider_payout_details"
  ADD CONSTRAINT "provider_payout_details_method_complete" CHECK (
    (
      "method" = 'bank'
      AND "account_number" IS NOT NULL
      AND "ifsc" IS NOT NULL
      AND "account_holder" IS NOT NULL
    )
    OR (
      "method" = 'upi'
      AND "upi_id" IS NOT NULL
    )
  );
