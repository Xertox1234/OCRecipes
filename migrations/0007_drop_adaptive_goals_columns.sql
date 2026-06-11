-- Drop the orphaned adaptive-goals columns from the users table.
--
-- PR #384 removed the adaptive-goals feature; these two columns survived as
-- dead weight (nothing reads or writes them — the GDPR export passthrough and
-- the update-field allowlist were removed in the same change as this file).
-- Pre-drop null-data check (2026-06-10, dev DB, 4853 rows): 0 rows with
-- adaptive_goals_enabled distinct from false, 0 rows with a non-NULL
-- last_goal_adjustment_at. Run the same check against prod before applying:
--
--   SELECT count(*) FROM users
--   WHERE adaptive_goals_enabled IS DISTINCT FROM false
--      OR last_goal_adjustment_at IS NOT NULL;
--
-- ORDERING: deploy the new server bundle FIRST, then apply this migration.
-- The previous bundle's getTableColumns(users)-derived SELECT lists still name
-- both columns and fail with "column does not exist" if the drop lands first.
-- Note: migrations/0002 (line 22) references last_goal_adjustment_at and is no
-- longer replayable on a DB where this migration has been applied.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0007_drop_adaptive_goals_columns.sql

ALTER TABLE users DROP COLUMN IF EXISTS adaptive_goals_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS last_goal_adjustment_at;
