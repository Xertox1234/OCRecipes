-- Health-data consent: record the policy version and the withdrawal time
-- (privacy audit 2026-11-10, finding H2 — "no consent, no health data").
--
--   health_data_consent_version       the privacy-policy version (its effective
--                                     date) the current consent was given against
--   health_data_consent_withdrawn_at  when the user last withdrew; the server
--                                     clears every health field in the same
--                                     transaction
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Purely
-- additive and idempotent (two nullable columns, no default, no backfill); the
-- old server never reads them. (Follows 0042, the coach write cards.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0043_health_consent_version_and_withdrawal.sql
--
-- Verify (paste the output; expect "2"):
--   psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name IN ('health_data_consent_version', 'health_data_consent_withdrawn_at');"

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS health_data_consent_version text,
  ADD COLUMN IF NOT EXISTS health_data_consent_withdrawn_at timestamptz;

COMMIT;
