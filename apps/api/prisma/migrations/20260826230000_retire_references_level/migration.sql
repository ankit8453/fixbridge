-- References stops being a verification level.
--
-- Requiring two contactable referees assumed every technician has them, which
-- is not true of the people this platform is for: someone working alone, or
-- new to the trade, has no second employer to name. It gated the badge on a
-- social fact rather than on anything about their work.
--
-- Levels are NOT renumbered. `provider_verification_summaries.levels_passed`
-- and every row in the append-only event log refer to these numbers, and
-- shifting them would silently reinterpret history — someone who passed
-- "skill" would read as having passed something else. 3 simply stops being
-- asked for, and `computeBadge` ignores the extra entry, so everyone already
-- VERIFIED keeps their badge.
--
-- Open level-3 cases are the one thing needing attention: the technician has
-- no screen left to answer them on, so they would sit in the ops queue
-- forever. They are removed rather than closed, because closing them would
-- mean writing a `passed` the state machine does not allow from `needs_info`,
-- and the projection invariant (stored status = fold(events)) must hold.
--
-- The purge switch is the same one the DPDP erasure path uses — the only
-- sanctioned way past the append-only trigger.
SET LOCAL "fixbridge.allow_kyc_purge" = 'on';

DELETE FROM "verification_events"
WHERE case_id IN (
  SELECT c.id
  FROM "verification_cases" c
  WHERE c.level = 3 AND c.status <> 'passed'
);

DELETE FROM "verification_cases"
WHERE level = 3 AND status <> 'passed';
