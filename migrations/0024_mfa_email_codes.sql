-- Two-step by emailed code (owner ruling 4, 2026-10-12).
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle reads user_mfa.method on every two-step check and writes
-- mfa_email_codes on every emailed code, so both must exist before that bundle
-- deploys. Applying early is safe for the old bundle: a new table it never
-- reads, and a column with a default its inserts don't name. Additive and
-- idempotent; existing two-step rows become method 'totp' (what they are).
-- Constraint names match Drizzle's.

CREATE TABLE IF NOT EXISTS mfa_email_codes (
  user_id varchar NOT NULL PRIMARY KEY
    CONSTRAINT mfa_email_codes_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  code_hash text,
  expires_at timestamp with time zone,
  attempts integer DEFAULT 0 NOT NULL,
  issue_count integer DEFAULT 0 NOT NULL,
  window_start timestamp with time zone NOT NULL,
  last_sent_at timestamp with time zone NOT NULL
);

ALTER TABLE user_mfa ADD COLUMN IF NOT EXISTS method text DEFAULT 'totp' NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_mfa_method_check'
  ) THEN
    ALTER TABLE user_mfa
      ADD CONSTRAINT user_mfa_method_check CHECK (method IN ('totp', 'email'));
  END IF;
END $$;
