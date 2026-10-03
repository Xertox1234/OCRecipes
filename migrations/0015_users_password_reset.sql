-- users.reset_code_* / reset_issue_*: password reset by emailed 6-digit code
-- (todos/P1-2026-09-26-no-password-reset-or-account-recovery.md; spec
-- docs/superpowers/specs/2026-10-03-password-reset-design.md §3).
--
-- reset_code_hash is an HMAC (never the code); NULL = no live code. Both
-- timestamps are timestamptz and are only ever written/compared in SQL
-- against now(), so the 15-minute window cannot drift with a session TZ.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle reads and writes these columns on login (getUserByEmailForAuth
-- selects the full row) and on both reset routes. The old running bundle
-- never touches them (Drizzle selects named columns), so applying early is
-- safe. Additive only: nullable or NOT NULL DEFAULT 0, no backfill.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_code_hash text,
  ADD COLUMN IF NOT EXISTS reset_code_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reset_code_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reset_issue_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reset_issue_window_start timestamp with time zone;
