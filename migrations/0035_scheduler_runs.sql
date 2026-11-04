-- Scheduler run claims (2026-11-01, todo P2-2026-10-30-scheduler-multi-instance-run-claim).
-- Each cron tick in server/services/notification-scheduler.ts now claims
-- (job_name, run_slot) before it sends anything; the unique index makes the
-- claim atomic, so a tick that fires on several server instances runs once.
-- run_slot is the tick's nearest UTC hour boundary, e.g. '2026-11-01T09'.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- server inserts into this table on its first tick after deploy, and a failed
-- claim skips that run. Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0035_scheduler_runs.sql
--
-- Verify (paste the output; expect one row: scheduler_runs, then one row:
-- scheduler_runs_job_slot_idx):
--   psql "$DATABASE_URL" -c "SELECT to_regclass('public.scheduler_runs');"
--   psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename = 'scheduler_runs' AND indexname = 'scheduler_runs_job_slot_idx';"

BEGIN;

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id serial PRIMARY KEY,
  job_name text NOT NULL,
  run_slot text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduler_runs_job_slot_idx
  ON scheduler_runs (job_name, run_slot);

COMMIT;
