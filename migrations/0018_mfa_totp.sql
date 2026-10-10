-- Second factor (authenticator app + recovery codes + trusted phones).
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle selects users.mfa_enabled_at on every user load (Drizzle lists columns
-- by name), so it must exist before that bundle deploys. Applying early is safe
-- for the old bundle: a new nullable column and four tables it never reads.
-- Additive and idempotent; no backfill. Constraint names match Drizzle's.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id varchar NOT NULL PRIMARY KEY
    CONSTRAINT user_mfa_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  totp_secret_enc text,
  totp_last_step integer,
  pending_secret_enc text,
  pending_expires_at timestamp with time zone,
  failed_attempts integer DEFAULT 0 NOT NULL,
  locked_until timestamp with time zone
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT mfa_recovery_codes_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_recovery_codes_user_hash_unique
  ON mfa_recovery_codes (user_id, code_hash);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash text NOT NULL PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT mfa_challenges_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  token_version integer NOT NULL,
  purpose text NOT NULL,
  link_ticket_hash text,
  link_mark_email_verified boolean DEFAULT false NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT mfa_challenges_purpose_check CHECK (purpose IN ('login', 'link')),
  CONSTRAINT mfa_challenges_link_ticket_check
    CHECK ((purpose = 'link') = (link_ticket_hash IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mfa_challenges_user_id_idx ON mfa_challenges (user_id);

-- An unmerged 2026-10-05 branch shipped a 0018 that created these same three
-- tables with identical columns but WITHOUT the link-ticket CHECK. It may have
-- been applied somewhere (owner: "not sure" for production), and CREATE TABLE
-- IF NOT EXISTS would then keep the old shape. Add the CHECK when missing —
-- nothing is dropped, and re-running is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mfa_challenges_link_ticket_check'
      AND conrelid = 'mfa_challenges'::regclass
  ) THEN
    ALTER TABLE mfa_challenges ADD CONSTRAINT mfa_challenges_link_ticket_check
      CHECK ((purpose = 'link') = (link_ticket_hash IS NOT NULL));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT mfa_trusted_devices_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_trusted_devices_key_hash_unique
  ON mfa_trusted_devices (key_hash);
CREATE INDEX IF NOT EXISTS mfa_trusted_devices_user_id_idx
  ON mfa_trusted_devices (user_id);
