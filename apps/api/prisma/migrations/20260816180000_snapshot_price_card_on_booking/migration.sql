-- ===========================================================================
-- Phase 7 carry-over: snapshot the price card onto the booking.
--
-- Phase 7 stored only `price_card_id` and read the amount at completion, which
-- meant a technician editing their rate while standing in someone's kitchen
-- would change that customer's bill. The visit fee was already snapshotted for
-- exactly this reason; the card should have been too.
--
-- HAND-EDITED: no `prisma migrate diff` DROP INDEX statements belong here. The
-- six raw-SQL indexes it cannot see (two GiST, two trigram, two covering) must
-- survive. See docs/geo-notes.md.
-- ===========================================================================

ALTER TABLE "bookings"
  ADD COLUMN "price_card_amount_paise" INTEGER,
  ADD COLUMN "price_card_type" "price_type";

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
--
-- Reads the card's *current* values, which is the only source available. The
-- assumption — stated plainly because it is an assumption, not a fact — is that
-- no price card has been edited since the bookings referencing it were made.
-- That holds for seeded and pilot-development data, which is all that exists.
-- For any booking whose card was edited before this ran, the backfilled number
-- is the edited one and cannot be recovered; from here on the snapshot is taken
-- at creation and the question does not arise again.
UPDATE "bookings" b
SET "price_card_amount_paise" = pc."amount_paise",
    "price_card_type"         = pc."price_type"
FROM "provider_price_cards" pc
WHERE pc."id" = b."price_card_id";

-- Deliberately NOT tied to `price_card_id` being present.
--
-- That column is `ON DELETE SET NULL`, so a coupling CHECK would make deleting a
-- price card fail against every historical booking — and the whole point of a
-- snapshot is that it survives the thing it copied.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_price_card_amount_check" CHECK (
    "price_card_amount_paise" IS NULL OR "price_card_amount_paise" >= 0
  );
