-- Reports on AI replies (privacy audit 2026-11-10, G7 — Google Play asks for an
-- in-app way to report AI-generated content). A row holds the reply's id, a
-- reason from a fixed list and who reported: never the reply's text. Both
-- foreign keys cascade, so a report goes when its reply or its account goes.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Purely
-- additive and idempotent; the old server never reads this table.
-- (Follows 0045, the coach weekly reports.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0046_chat_message_reports.sql
--
-- Verify (paste the output; expect "true|1|2"):
--   psql "$DATABASE_URL" -Atc "SELECT (to_regclass('public.chat_message_reports') IS NOT NULL) || '|' || (SELECT count(*) FROM pg_constraint WHERE conname = 'chat_message_reports_reason_check') || '|' || (SELECT count(*) FROM pg_indexes WHERE tablename = 'chat_message_reports' AND indexname IN ('chat_message_reports_user_message_idx', 'chat_message_reports_message_idx'));"

BEGIN;

CREATE TABLE IF NOT EXISTS chat_message_reports (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id integer NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chat_message_reports_reason_check CHECK (reason IN ('inaccurate', 'harmful', 'offensive', 'other'))
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_message_reports_user_message_idx
  ON chat_message_reports (user_id, message_id);

CREATE INDEX IF NOT EXISTS chat_message_reports_message_idx
  ON chat_message_reports (message_id);

COMMIT;
