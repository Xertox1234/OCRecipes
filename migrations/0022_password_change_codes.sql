-- Signed-in password change: the emailed code (change-password spec §4.2).
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle reads and writes password_change_codes on every code request and
-- every email-code password change, so the table must exist before that
-- bundle deploys. Applying early is safe for the old bundle: a new table it
-- never reads. Additive and idempotent; no backfill. Constraint names match
-- Drizzle's.

CREATE TABLE IF NOT EXISTS password_change_codes (
  user_id varchar NOT NULL PRIMARY KEY
    CONSTRAINT password_change_codes_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  code_hash text,
  expires_at timestamp with time zone,
  attempts integer DEFAULT 0 NOT NULL,
  issue_count integer DEFAULT 0 NOT NULL,
  window_start timestamp with time zone NOT NULL
);
