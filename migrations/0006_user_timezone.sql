-- Add IANA timezone to the users table.
--
-- Used by server-side day-boundary helpers to bucket meal logs, generation
-- quotas, coach cache, and reminders in the user's local calendar day rather
-- than UTC.  NULL = "not yet captured" (treated as UTC on the server).
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0006_user_timezone.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text;
