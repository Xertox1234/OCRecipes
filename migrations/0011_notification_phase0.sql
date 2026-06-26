-- Phase 0: notification_sends ledger + additive notificationPrefs column + backfill.
-- Additive only — the running build ignores both (zero-downtime expand step).

CREATE TABLE IF NOT EXISTS notification_sends (
  id          serial PRIMARY KEY,
  user_id     varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    text NOT NULL,
  sent_at     timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_sends_user_category_day_idx
  ON notification_sends (user_id, category, DATE(sent_at AT TIME ZONE 'UTC'));
CREATE INDEX IF NOT EXISTS notification_sends_user_category_sent_idx
  ON notification_sends (user_id, category, sent_at);

-- notificationPrefs co-locates with reminder_mutes, which is on user_profiles.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE user_profiles
SET notification_prefs = jsonb_build_object(
  'categories', reminder_mutes,
  'quietHours', jsonb_build_object('start', '21:00', 'end', '08:00'),
  'ambientPush', false,
  'transactionalEnabled', true
)
WHERE notification_prefs = '{}'::jsonb;
