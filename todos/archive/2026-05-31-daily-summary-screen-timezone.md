---
title: "Send X-Timezone on DailyNutritionDetailScreen and MealPlanHomeScreen daily-summary queries"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [reliability, data-integrity, react-native, deferred]
github_issue:
---

# Daily-summary screen timezone headers

## Summary

`DailyNutritionDetailScreen` and `MealPlanHomeScreen` query `/api/daily-summary` via the global `getQueryFn`, which doesn't support custom headers — so they don't send `X-Timezone` and still receive UTC-bucketed data for non-UTC users.

## Background

PR #289 threaded `X-Timezone` into 8 routes but these two screens use `getQueryFn` (the shared TanStack Query fetcher in `client/lib/query-client.ts`) which calls `apiRequest` without a headers option. The route-level fix already accepts the header; the gap is on the client call site.

Surfaced in the PR #289 code review as an unthreaded caller. Low severity because these screens are read-only summaries, not quota/entitlement-affecting paths.

## Acceptance Criteria

- [ ] `/api/daily-summary` calls from `DailyNutritionDetailScreen` and `MealPlanHomeScreen` include an `X-Timezone` header with the device's IANA timezone.
- [ ] Existing tests for these screens remain green.
- [ ] Non-UTC user sees their correct local-day summary (not UTC-day).

## Implementation Notes

- The cleanest fix: pass timezone as a query param (`?tz=America/Los_Angeles`) instead of a header — `getQueryFn` already appends query params from the query key. The route already has `parseTimezone` wired; add `parseTimezone(req.query.tz)` as a fallback before the header check.
- Alternative: use `apiRequest` directly in a custom `queryFn` for these two screens, adding `headers: { "X-Timezone": getDeviceTimezone() }`. This matches how `useDailyBudget.ts` does it.
- `getDeviceTimezone()` helper: `Intl.DateTimeFormat().resolvedOptions().timeZone` — extract from `client/hooks/useDailyBudget.ts` into a shared `client/lib/timezone.ts` if two or more callers need it.
- Files: `client/screens/DailyNutritionDetailScreen.tsx`, `client/screens/MealPlanHomeScreen.tsx` (or wherever they invoke the daily-summary query), `server/routes/nutrition.ts` (if adding query-param fallback).

## Dependencies

- PR #289 merged (X-Timezone support on the server side) ✓

## Risks

- Low — additive header/param threading, no business logic change.

## Updates

### 2026-05-31

- Created from PR #289 code review. Two screens left without timezone threading because they use `getQueryFn` without custom headers.
