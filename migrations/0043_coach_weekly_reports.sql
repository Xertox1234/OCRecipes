-- Coach weekly report (spec docs/superpowers/specs/2026-11-10-coach-weekly-report-design.md).
-- One report per user per Sunday–Saturday week, written Sunday evening, kept in
-- the profile. Delivery (push or popup) is claimed once on the row.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Purely
-- additive and idempotent; the old server never reads these tables.
-- (Follows 0042, the coach write cards table from #1812.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0043_coach_weekly_reports.sql
--
-- Verify (paste the output; expect "true|true|1"):
--   psql "$DATABASE_URL" -Atc "SELECT (to_regclass('public.coach_weekly_reports') IS NOT NULL) || '|' || (to_regclass('public.coach_weekly_report_settings') IS NOT NULL) || '|' || (SELECT count(*) FROM pg_constraint WHERE conname = 'coach_weekly_reports_user_week_unique');"

BEGIN;

CREATE TABLE IF NOT EXISTS coach_weekly_reports (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  facts jsonb NOT NULL,
  content jsonb NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen_at timestamptz,
  celebration_shown_at timestamptz,
  push_due_at timestamptz,
  delivered_via text,
  delivered_at timestamptz,
  CONSTRAINT coach_weekly_reports_source_check CHECK (source IN ('ai', 'template')),
  CONSTRAINT coach_weekly_reports_delivered_via_check CHECK (delivered_via IS NULL OR delivered_via IN ('push', 'popup')),
  CONSTRAINT coach_weekly_reports_user_week_unique UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS coach_weekly_reports_user_week_idx
  ON coach_weekly_reports (user_id, week_start DESC);

CREATE INDEX IF NOT EXISTS coach_weekly_reports_push_due_idx
  ON coach_weekly_reports (push_due_at)
  WHERE delivered_via IS NULL AND push_due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS coach_weekly_report_settings (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  report_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
