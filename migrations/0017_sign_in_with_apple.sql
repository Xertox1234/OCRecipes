-- Sign in with Apple (and later Google): social-only accounts, linked
-- identities, single-use nonces, and short-lived sign-up/link tickets.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE (#1260, the
-- base of the Sign in with Apple stack). The new server bundle reads
-- user_identities on every /api/auth/me (signInMethods), so it must exist
-- before that bundle deploys. Applying early is safe for the old bundle:
--   - users.password DROP NOT NULL only widens what is accepted; the old
--     bundle always writes a password.
--   - the three tables are new; the old bundle never touches them.
-- Additive and idempotent (IF NOT EXISTS; DROP NOT NULL is a no-op when
-- already nullable); no backfill. Constraint names match Drizzle's so a later
-- db:push sees no drift (verified: pg_dump of these tables is identical to a
-- db:push-created dev DB).

ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

CREATE TABLE IF NOT EXISTS user_identities (
  id varchar DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT user_identities_user_id_users_id_fk
    REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_subject text NOT NULL,
  email text,
  is_private_relay boolean DEFAULT false NOT NULL,
  -- AES-256-GCM ciphertext (IDENTITY_TOKEN_ENC_KEY); revoked on account delete.
  apple_refresh_token_enc text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_used_at timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_provider_subject_unique
  ON user_identities (provider, provider_subject);
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_user_provider_unique
  ON user_identities (user_id, provider);
CREATE INDEX IF NOT EXISTS user_identities_user_id_idx
  ON user_identities (user_id);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce_hash text NOT NULL PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('sign_in', 'link', 'reauth')),
  -- NULL = public (pre-sign-in) nonce; set = bound to that signed-in user.
  user_id varchar
    CONSTRAINT auth_nonces_user_id_users_id_fk
    REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_nonces_expires_at_idx
  ON auth_nonces (expires_at);

CREATE TABLE IF NOT EXISTS pending_social_sign_ins (
  ticket_hash text NOT NULL PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('sign_up', 'link')),
  provider text NOT NULL,
  provider_subject text NOT NULL,
  email text NOT NULL,
  is_private_relay boolean DEFAULT false NOT NULL,
  provider_authoritative boolean NOT NULL,
  display_name text,
  apple_refresh_token_enc text,
  target_user_id varchar
    CONSTRAINT pending_social_sign_ins_target_user_id_users_id_fk
    REFERENCES users(id) ON DELETE CASCADE,
  attempts integer DEFAULT 0 NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  email_verified boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_social_sign_ins_expires_at_idx
  ON pending_social_sign_ins (expires_at);
