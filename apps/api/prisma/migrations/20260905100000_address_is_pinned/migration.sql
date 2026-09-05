-- Records whether an address's coordinates are real.
--
-- When a customer does not pin their address, the geocoder derives a point by
-- hashing the address text into somewhere inside Jabalpur. It looks like a
-- coordinate and is not where anybody lives — and once stored, nothing could
-- tell the two apart, so a technician was handed an invented pin and drove to
-- a stranger's street.
--
-- Existing rows default to false. That is the honest answer for all of them:
-- we cannot now tell which were pinned, and treating a guess as real is the
-- failure this column exists to stop.
ALTER TABLE "addresses"
  ADD COLUMN "is_pinned" BOOLEAN NOT NULL DEFAULT false;
