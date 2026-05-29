---
title: "Timezone-aware day boundaries (meal log, generation quota, coach cache, reminders)"
status: backlog
priority: high
created: 2026-05-29
updated: 2026-05-29
assignee:
labels: [reliability, data-integrity, deferred, database]
github_issue:
---

# Timezone-aware day boundaries

## Summary

Day membership is computed on **server UTC** everywhere (`getDayBounds` uses `setUTCHours`), and the client never transmits its timezone. Non-UTC users get meals, premium quotas, coach answers, and reminders bucketed to the wrong calendar day. Make day-bucketing aware of the user's IANA timezone.

## Background

From the 2026-05-29 reliability audit (Class 9). Four findings share one root (`server/storage/helpers.ts` `getDayBounds` + `coach-pro-chat.ts` `getUtcDayBucket`):

- **C2 (Critical, fires today):** meal-log day boundary. `dailyLogs` insert sets no explicit `loggedAt` (UTC `now()` default); `useDailyBudget` sends `?date=` with no tz → an 11pm meal in UTC−7 lands on the next UTC day.
- **H8 (High, entitlement-adjacent):** daily premium recipe-generation quota (`community-generation-log.ts:14,53`) — user near local midnight wrongly hit 429 or gets a fresh quota mid-afternoon.
- **M5 (Medium):** coach response-cache day buckets in UTC (`coach-pro-chat.ts:185`).
- **M11 (Medium):** "pending reminders today" UTC bucket (`reminders.ts:23`).

Deduped against `docs/superpowers/specs/2026-05-16-timestamp-timezone-consistency-design.md`: that spec normalizes column **type** (`timestamp`→`timestamptz`) but deliberately **keeps UTC day-bucketing**, so it does NOT address this. The two interact (both touch `getDayBounds` and the `DATE(... AT TIME ZONE 'UTC')` indexes) — sequence them together.

## Acceptance Criteria

- [ ] Client transmits its IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) on day-scoped requests (daily budget/summary, generation quota, coach, reminders).
- [ ] Server computes day bounds in the user's timezone (not server UTC) for those paths.
- [ ] `dailyLogs` day-membership is correct for non-UTC users (decide: store `loggedAt` explicitly, or query relative to user tz).
- [ ] Genuine-empty-vs-error preserved: an empty day for a valid user is NOT mislabeled as an error.
- [ ] Regression tests covering a non-UTC user across a local-midnight boundary for meal log + generation quota.

## Implementation Notes

- **Doc-recommended approach (Phase 2.5 docs-researcher):** add `@date-fns/tz` (no date lib in the project today) and compute `startOfDay(date, { in: tz(userTz) })` / `endOfDay(...)`. Uses built-in `Intl`, no bundled tz data.
- Thread user tz from the client (or store on the user profile) into `getDayBounds(date, tz)`.
- Fold in the two incidental siblings the researcher flagged: `getMonthBounds` (`helpers.ts:25-36`, UTC) and `parseQueryDate` (`server/routes/_helpers.ts:112`, `new Date(value)` → UTC midnight).
- Files: `server/storage/helpers.ts`, `server/storage/nutrition.ts:327`, `client/hooks/useDailyBudget.ts`, `server/storage/community-generation-log.ts`, `server/services/coach-pro-chat.ts`, `server/storage/reminders.ts`, `server/routes/_helpers.ts`.

## Dependencies

- Interacts with the pending 2026-05-16 timestamptz migration (`todos/2026-03-27-timestamp-timezone-consistency.md`) — coordinate the `DATE(... AT TIME ZONE 'UTC')` index expressions.

## Risks

- Touches the daily-budget and premium-quota paths — high blast radius; needs the regression tests above before merge.
- A naive fix can mislabel a legitimately empty day as an error (genuine-empty-vs-error).

## Updates

### 2026-05-29

- Created from the reliability audit (C2/H8/M5/M11). Deferred: real fix is a feature (new dep + client tz + server signature changes), not a surgical audit edit.
