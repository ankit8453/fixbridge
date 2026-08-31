-- `marketing_discount` is an expense, so it is debit-natured.
--
-- The `account_balances` view signs every balance so that a positive number
-- means "this account holds value", whichever side of the books it lives on.
-- It does that by naming the debit-natured account types explicitly and
-- treating everything else as credit-natured.
--
-- When `marketing_discount` was added it was not added to that list, so a
-- coupon the platform funded reported a *negative* balance — the discount
-- looked like money the platform had gained rather than spent. Nothing else
-- read the value, so the only symptom was a failing ledger test, but it is the
-- kind of sign error that turns into a wrong number on a money screen the
-- moment somebody surfaces it.
--
-- The view is a pure projection over `ledger_entries`; replacing it rewrites no
-- data and every historical journal re-reads with the correct sign.
CREATE OR REPLACE VIEW "account_balances" AS
SELECT
  a."id"           AS account_id,
  a."account_type" AS account_type,
  a."owner_type"   AS owner_type,
  a."owner_id"     AS owner_id,
  coalesce(sum(CASE WHEN e."direction" = 'debit' THEN e."amount_paise" ELSE 0 END), 0)::BIGINT  AS debits_paise,
  coalesce(sum(CASE WHEN e."direction" = 'credit' THEN e."amount_paise" ELSE 0 END), 0)::BIGINT AS credits_paise,
  -- Signed so that a positive number always means "this account holds value",
  -- whichever side of the books it lives on. Assets and expenses grow by
  -- debit; liabilities and revenue grow by credit.
  CASE
    WHEN a."account_type" IN ('gateway_cash', 'provider_dues', 'marketing_discount')
      THEN coalesce(sum(CASE WHEN e."direction" = 'debit' THEN e."amount_paise" ELSE -e."amount_paise" END), 0)
    ELSE coalesce(sum(CASE WHEN e."direction" = 'credit' THEN e."amount_paise" ELSE -e."amount_paise" END), 0)
  END::BIGINT AS balance_paise
FROM "accounts" a
LEFT JOIN "ledger_entries" e ON e."account_id" = a."id"
GROUP BY a."id", a."account_type", a."owner_type", a."owner_id";
