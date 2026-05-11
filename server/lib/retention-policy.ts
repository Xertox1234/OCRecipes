/**
 * Data retention policy.
 *
 * Defines how long different categories of user data are retained before
 * being purged by the cleanup job in `server/scripts/cleanup-retention.ts`.
 *
 * Why constants live here:
 *   - Privacy laws (CCPA, PIPEDA) require that personal data not be kept
 *     longer than necessary for its stated purpose. Centralising the
 *     windows makes the policy reviewable and auditable.
 *   - The Privacy Policy must disclose these windows to users before the
 *     cleanup job is enabled in production. Treat any change here as
 *     user-visible.
 *
 * Tuning guidance:
 *   - Windows are stored in days for readability. Convert to ms with
 *     `daysToMs()` or to a cutoff `Date` with `cutoffFor()`.
 *   - To skip a domain entirely, set its constant to `Infinity` — the
 *     purge helpers treat `Infinity` as "retain forever" and bail out
 *     without issuing a DELETE.
 *
 * Active-user guard:
 *   - The cleanup job MUST NOT delete data for users with an active
 *     subscription. Users with a recent activity signal (chat or scan
 *     within `ACTIVE_USER_WINDOW_DAYS`) are also exempt. See
 *     `cleanup-retention.ts::getActiveUserIds` for the implementation.
 */

export const SCANNED_ITEMS_RETENTION_DAYS = 365;
export const CHAT_RETENTION_DAYS = 180;
export const DAILY_LOGS_RETENTION_DAYS = 730;

/**
 * Interaction note — daily_logs ↔ scanned_items cascade:
 * `daily_logs.scanned_item_id` has `ON DELETE CASCADE` on `scanned_items`.
 * The cleanup script runs the `daily_logs` purge BEFORE the `scanned_items`
 * purge so the `logged_at` window applies first. Afterwards, any
 * remaining scan-sourced log row whose parent scanned_item is older than
 * `SCANNED_ITEMS_RETENTION_DAYS` is cascade-deleted by the scanned_items
 * purge — that is intentional. The effective retention for scan-sourced
 * daily_logs is therefore `min(SCANNED_ITEMS_RETENTION_DAYS,
 * DAILY_LOGS_RETENTION_DAYS)`. Recipe-sourced logs (no scanned_item_id)
 * are only governed by `DAILY_LOGS_RETENTION_DAYS`.
 */

/**
 * A user counts as "active" if they have a chat or scan signal within
 * this window. Active users are exempt from retention purges so a paying
 * customer who briefly stops using the app doesn't lose history.
 */
export const ACTIVE_USER_WINDOW_DAYS = 30;

/** Number of rows deleted per DELETE statement. Keeps each statement short
 *  so it doesn't hold long row locks or blow up the WAL on busy tables. */
export const BATCH_SIZE = 1000;

export function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Compute the cutoff timestamp: rows older than this are eligible for
 * purge. `Infinity` returns a date far in the past so callers can use the
 * value uniformly without special-casing, but the caller should still
 * skip the DELETE entirely when retention is disabled.
 */
export function cutoffFor(retentionDays: number, now: Date = new Date()): Date {
  if (!Number.isFinite(retentionDays)) {
    return new Date(0);
  }
  return new Date(now.getTime() - daysToMs(retentionDays));
}
