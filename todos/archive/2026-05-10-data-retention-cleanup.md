---
title: "Data retention cleanup job"
status: in-progress
priority: medium
created: 2026-05-10
updated: 2026-05-11
assignee:
labels: [compliance, privacy, performance, deferred]
github_issue:
---

# Data Retention Cleanup Job

## Summary

Implement a scheduled server-side job that purges old user data beyond configurable retention windows — satisfying the CCPA/PIPEDA data minimization principle and reducing storage costs over time.

## Background

Privacy laws including CCPA and PIPEDA require that personal data not be retained longer than necessary for its stated purpose. For a nutrition tracking app, indefinite retention of granular daily food logs and AI chat history is hard to justify. A documented and enforced retention policy ("we keep food logs for X years") also strengthens the app's privacy posture in the event of a breach or regulatory inquiry. Additionally, unbounded growth in `scannedItems`, `chatMessages`, and `nutritionLogs` tables will degrade query performance over time.

## Acceptance Criteria

- [ ] A retention policy is defined as constants (e.g. `SCANNED_ITEMS_RETENTION_DAYS = 365`, `CHAT_MESSAGES_RETENTION_DAYS = 180`, `NUTRITION_LOG_RETENTION_DAYS = 730`)
- [ ] A cleanup function purges rows older than the retention window for: `scannedItems`, `chatMessages`/`chatConversations`, and `nutritionLogs` (or equivalent daily-log tables)
- [ ] Cleanup runs on a schedule (daily, off-peak) — use `node-cron` or a simple `setInterval` in the server process, OR a standalone script runnable via `npm run cleanup:retention`
- [ ] Cleanup is scoped by `userId` + `createdAt` — never a bulk table truncate
- [ ] Cleanup deletes in batches (e.g. 1000 rows/pass) to avoid long-running transactions
- [ ] A `LOG_LEVEL=info` log line is emitted after each domain purge: `{ domain, rowsDeleted, retentionDays }`
- [ ] The job refuses to run in `NODE_ENV=production` without the `RETENTION_CLEANUP_ENABLED=true` env var (safety gate, same pattern as seed scripts)
- [ ] Unit test: verify the cleanup function deletes rows older than the window and preserves rows within it

## Implementation Notes

- Retention constants: `server/lib/retention-policy.ts` (new file)
- Cleanup function: `server/scripts/cleanup-retention.ts` (runnable standalone) — follow pattern of `cleanup-seeds.ts` if it exists
- Scheduled invocation: wire into `server/index.ts` as a daily cron only when `RETENTION_CLEANUP_ENABLED=true`
- Use Drizzle `lt(table.createdAt, cutoffDate)` with `and(eq(table.userId, userId))` for scoped deletes — or a bulk delete with only the date filter if per-user scoping is not required by policy
- Bulk delete pattern (preferred for scale): `DELETE FROM scanned_items WHERE created_at < $cutoff LIMIT 1000` via raw SQL or Drizzle `.limit()` — loop until rowsDeleted < batchSize
- Chat conversations: deleting a conversation cascades to messages (FK cascade already in schema)
- Do NOT delete data for users who have an active subscription or recent login — add a `lastActiveWithin` guard (e.g. skip users active in last 30 days) to avoid deleting data from paying/active users unexpectedly
- Eligible for Copilot delegation (no auth/health-data mutations — data hygiene only)

## Dependencies

- Confirm which tables represent "daily nutrition logs" — `scannedItems` with a `loggedAt` date? A separate `nutritionLogs` table? Audit schema before implementing
- `node-cron` may need to be added as a dependency if not already present

## Risks

- Irreversible: deleted rows cannot be recovered. The batch + logging pattern and the `RETENTION_CLEANUP_ENABLED` gate mitigate accidental runs
- Users may not expect their data to be deleted — retention window should be disclosed in the Privacy Policy before this job is enabled in production
- Chat history deletion may remove context the AI coach would otherwise use — acceptable tradeoff given privacy posture

## Updates

### 2026-05-10

- Created from compliance review (North America launch planning)
