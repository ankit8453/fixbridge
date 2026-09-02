-- Adds `paytm` to the payment gateway enum.
--
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on older
-- Postgres, and Prisma wraps migrations in one — `IF NOT EXISTS` keeps this
-- safe to re-run, which is what makes it survive a partially-applied state.
ALTER TYPE "payment_gateway_name" ADD VALUE IF NOT EXISTS 'paytm';
