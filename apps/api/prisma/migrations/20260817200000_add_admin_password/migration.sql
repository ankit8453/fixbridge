-- Phase 12 — a password as the ops console's FIRST factor.
--
-- HAND-EDITED: `prisma migrate diff` proposed the same nine `DROP INDEX`
-- statements it has proposed since Phase 3 (partial, expression, GiST and
-- trigram indexes created by raw SQL that Prisma cannot see in the datamodel).
-- Removed, as in every previous phase — dropping them would turn every geo and
-- fuzzy-text query into a sequential scan and remove three uniqueness
-- guarantees.
--
-- ---------------------------------------------------------------------------
--
-- Phase 2 said there would never be a password column. For customers and
-- technicians there still is not, and that has not changed: a phone is the one
-- credential everybody in this market already has and nobody has to remember.
--
-- This is one narrow exception. An ops person signs in dozens of times a day at
-- a desk, and an SMS round-trip on every sign-in is the kind of friction that
-- ends with somebody staying permanently logged in on a shared machine — which
-- is a worse security outcome than the password.
--
-- It is a **first factor, not the only one**: `POST /auth/admin/password`
-- verifies it and then issues an OTP, and no session exists until that OTP is
-- verified too. The account that can refund a customer and mark a payout paid
-- does not get weaker authentication than the customer's.
ALTER TABLE "users" ADD COLUMN "password_hash" VARCHAR(400);
ALTER TABLE "users" ADD COLUMN "password_updated_at" TIMESTAMPTZ(3);

-- Nobody but ops and admin may hold one.
--
-- Enforced by the database rather than only in the service, because "only staff
-- get passwords" is the kind of rule that quietly stops being true when a later
-- feature reuses the column for something convenient. A customer with a password
-- would be a second, weaker way into an account that is supposed to be
-- phone-only.
--
-- Written as a trigger rather than a CHECK because the roles live in a separate
-- table, and a CHECK cannot see another row.
CREATE OR REPLACE FUNCTION users_password_staff_only() RETURNS trigger AS $$
BEGIN
  IF NEW.password_hash IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = NEW.id AND role IN ('ops', 'admin')
  ) THEN
    RAISE EXCEPTION
      'only ops and admin accounts may hold a password (user=%)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_password_staff_only
  BEFORE INSERT OR UPDATE OF password_hash ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_password_staff_only();

-- The other half: losing the staff role must take the password with it.
--
-- Otherwise an account demoted out of ops keeps a working first factor, and the
-- revocation everybody believed happened did not.
CREATE OR REPLACE FUNCTION clear_password_on_role_loss() RETURNS trigger AS $$
BEGIN
  IF OLD.role IN ('ops', 'admin') THEN
    UPDATE users
    SET password_hash = NULL, password_updated_at = NULL
    WHERE id = OLD.user_id
      AND NOT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = OLD.user_id
          AND role IN ('ops', 'admin')
      );
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clear_password_on_role_loss
  AFTER DELETE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION clear_password_on_role_loss();
