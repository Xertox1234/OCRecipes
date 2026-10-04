-- users.last_active_at: when this account last used the app (any
-- authenticated request), so the retention cleanup can skip anyone who used
-- the app in the last 30 days, not only users who scanned, logged or chatted.
-- Written by requireAuth through touchLastActive, at most once an hour
-- (guarded in SQL against now()), so it is timestamptz and never compared in
-- a session time zone.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle writes this column on every authenticated request and getActiveUserIds
-- reads it. The old running bundle never touches it (Drizzle selects named
-- columns), so applying early is safe. Additive only: nullable, no backfill
-- (NULL = not seen since this shipped; the older activity signals still count).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at timestamp with time zone;
