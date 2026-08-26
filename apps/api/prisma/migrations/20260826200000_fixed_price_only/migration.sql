-- One honest number per service.
--
-- `starting_from` ("from ₹200") and `inspection_based` ("I need to see it")
-- both let a listed price differ from the price charged, which is the exact
-- gap the labour rules exist to close. A customer should know the cost before
-- booking; anything beyond it goes through extra labour, itemised and with a
-- written reason they approve.
--
-- Existing rows keep their amount and become `fixed`. An `inspection_based`
-- card has no amount by definition, so it cannot be converted — those are
-- deactivated instead, and the technician re-prices the service to be
-- bookable in it again. The enum keeps all three values: dropping a value
-- from a Postgres enum requires rewriting the type, and the two dead ones are
-- harmless once nothing writes them.
UPDATE "provider_price_cards"
SET "price_type" = 'fixed'
WHERE "price_type" = 'starting_from' AND "amount_paise" IS NOT NULL;

UPDATE "provider_price_cards"
SET "is_active" = false
WHERE "price_type" = 'inspection_based' OR "amount_paise" IS NULL;

-- Bookings already taken keep their snapshot untouched: the rate a customer
-- agreed to is frozen at booking and must never be rewritten underneath them.
