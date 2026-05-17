-- Convert all timestamp columns to timestamptz (todo M4 / timezone consistency).
--
-- WARNING: This file MUST be run before `npm run db:push` picks up the
-- shared/schema.ts change. db:push connects without a UTC session pin, so its
-- auto-generated ALTER could interpret stored values under a non-UTC timezone
-- and silently shift data. This file pins the session to UTC explicitly.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0002_timestamps_to_timestamptz.sql
-- Safe to re-run: ALTER on an already-timestamptz column is a no-op, and the
-- DROP/CREATE INDEX pair is idempotent.

BEGIN;
SET LOCAL timezone = 'UTC';

-- Drop the two DATE() expression indexes first. ALTER COLUMN TYPE would
-- otherwise try to rebuild them as DATE(timestamptz), which fails because
-- DATE(timestamptz) is STABLE, not IMMUTABLE.
DROP INDEX IF EXISTS pending_reminders_user_type_day_idx;
DROP INDEX IF EXISTS weight_logs_user_date_idx;

ALTER TABLE users ALTER COLUMN goals_calculated_at TYPE timestamptz;
ALTER TABLE users ALTER COLUMN last_goal_adjustment_at TYPE timestamptz;
ALTER TABLE users ALTER COLUMN subscription_expires_at TYPE timestamptz;
ALTER TABLE users ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE user_profiles ALTER COLUMN glp1_start_date TYPE timestamptz;
ALTER TABLE user_profiles ALTER COLUMN health_data_consent_at TYPE timestamptz;
ALTER TABLE user_profiles ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE user_profiles ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE pending_reminders ALTER COLUMN scheduled_for TYPE timestamptz;
ALTER TABLE pending_reminders ALTER COLUMN acknowledged_at TYPE timestamptz;
ALTER TABLE pending_reminders ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE scanned_items ALTER COLUMN scanned_at TYPE timestamptz;
ALTER TABLE scanned_items ALTER COLUMN discarded_at TYPE timestamptz;
ALTER TABLE daily_logs ALTER COLUMN logged_at TYPE timestamptz;
ALTER TABLE nutrition_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE nutrition_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE micronutrient_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE micronutrient_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE suggestion_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE suggestion_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE instruction_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE favourite_scanned_items ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE favourite_recipes ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE community_recipes ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE community_recipes ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE community_recipes ALTER COLUMN canonicalized_at TYPE timestamptz;
ALTER TABLE community_recipes ALTER COLUMN canonical_enriched_at TYPE timestamptz;
ALTER TABLE recipe_generation_log ALTER COLUMN generated_at TYPE timestamptz;
ALTER TABLE taste_picks ALTER COLUMN picked_at TYPE timestamptz;
ALTER TABLE meal_plan_recipes ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE meal_plan_recipes ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE meal_plan_items ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE weight_logs ALTER COLUMN logged_at TYPE timestamptz;
ALTER TABLE healthkit_sync ALTER COLUMN last_sync_at TYPE timestamptz;
ALTER TABLE chat_conversations ALTER COLUMN pinned_at TYPE timestamptz;
ALTER TABLE chat_conversations ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE chat_conversations ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE chat_messages ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE fasting_logs ALTER COLUMN started_at TYPE timestamptz;
ALTER TABLE fasting_logs ALTER COLUMN ended_at TYPE timestamptz;
ALTER TABLE medication_logs ALTER COLUMN taken_at TYPE timestamptz;
ALTER TABLE menu_scans ALTER COLUMN scanned_at TYPE timestamptz;
ALTER TABLE receipt_scans ALTER COLUMN scanned_at TYPE timestamptz;
ALTER TABLE goal_adjustment_logs ALTER COLUMN applied_at TYPE timestamptz;
ALTER TABLE transactions ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE transactions ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE grocery_lists ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE grocery_lists ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE grocery_list_items ALTER COLUMN checked_at TYPE timestamptz;
ALTER TABLE pantry_items ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE pantry_items ALTER COLUMN added_at TYPE timestamptz;
ALTER TABLE pantry_items ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE meal_suggestion_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE meal_suggestion_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE coach_response_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE coach_response_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE coach_notebook ALTER COLUMN follow_up_date TYPE timestamptz;
ALTER TABLE coach_notebook ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE coach_notebook ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE cookbooks ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE cookbooks ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE cookbook_recipes ALTER COLUMN added_at TYPE timestamptz;
ALTER TABLE barcode_verifications ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE barcode_verifications ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE verification_history ALTER COLUMN front_label_scanned_at TYPE timestamptz;
ALTER TABLE verification_history ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE reformulation_flags ALTER COLUMN detected_at TYPE timestamptz;
ALTER TABLE reformulation_flags ALTER COLUMN resolved_at TYPE timestamptz;
ALTER TABLE api_keys ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE api_keys ALTER COLUMN revoked_at TYPE timestamptz;
ALTER TABLE api_key_usage ALTER COLUMN last_request_at TYPE timestamptz;
ALTER TABLE barcode_nutrition ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE barcode_nutrition ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE recipe_dismissals ALTER COLUMN dismissed_at TYPE timestamptz;
ALTER TABLE carousel_suggestion_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE carousel_suggestion_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE push_tokens ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE push_tokens ALTER COLUMN updated_at TYPE timestamptz;

-- Recreate the expression indexes with the immutable, UTC-zoned expression.
CREATE UNIQUE INDEX pending_reminders_user_type_day_idx
  ON pending_reminders (user_id, type, DATE(scheduled_for AT TIME ZONE 'UTC'))
  WHERE acknowledged_at IS NULL;
CREATE UNIQUE INDEX weight_logs_user_date_idx
  ON weight_logs (user_id, DATE(logged_at AT TIME ZONE 'UTC'));

COMMIT;
