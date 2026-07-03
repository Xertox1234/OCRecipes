---
title: 'Day-bucketed reads must thread tz end-to-end (header for requests, stored tz for jobs)'
track: knowledge
category: conventions
tags: [timezone, database, nutrition, coach, day-bounds]
created: '2026-06-10'
source: 2026-06-10 full audit (H1 + per-fix review + Phase 6)
---

## Rule

Every caller of a day-bucketed storage read (`getDailySummary`, `getDailyLogs`,
`getDayBounds`-based queries) must pass a timezone — never let the `tz = "UTC"`
default apply on a user-facing or user-specific surface:

- **Request paths:** `parseTimezone(req.headers["x-timezone"])` at the route,
  threaded through the service. The client hook must send
  `headers: { "X-Timezone": getDeviceTimezone() }` AND include `{ tz }` in the
  queryKey (per-timezone cache slots). Reference shape: `useDailyBudget`.
- **Background jobs:** the user's stored `users.timezone` via
  `parseTimezone(tzMap.get(userId))` — resolve it BEFORE the first
  day-bucketed call in the block (the scheduler bug was resolving tz after
  `getDailyLogs`).
- **Long call chains:** thread tz as an explicit param all the way down
  (chat route → handleCoachChat → generateCoachProResponse → executeToolCall →
  storage). Tool loops count.

**Date-param trap:** a `?date=YYYY-MM-DD` string parses server-side as a
UTC-midnight *instant*; `getDayBounds(instant, tz)` then returns the civil day
containing that instant — the *previous* local day for UTC-negative users for
most of the day. For "today", omit the date param and bucket the now-instant in
tz. Only send explicit dates for historical screens, and know they carry this
quirk (shared with the useDailyBudget family).

## Why

PR #289 made the canonical routes tz-aware but five service surfaces (profile
widget, coach context, coach-pro intake, coach tool, check-in notification)
kept UTC, so a non-UTC user saw different "today" totals on adjacent screens —
and the coach cited wrong intake. The same audit's reviews found two more
UTC stragglers (scheduler meal-log check, micronutrients route) and the
date-param trap. This class recurs every time a new day-bucketed surface ships.

## Examples

Fixed sites: `server/services/{profile-hub,coach-context-builder,coach-pro-chat,coach-tools,notification-scheduler}.ts`,
`server/routes/{profile-hub,coach-context,micronutrients}.ts`,
`client/hooks/{useProfileWidgets,useCoachContext,useMicronutrients}.ts`.

Known remaining (pre-existing, deliberately unfixed): `getConfirmedMealPlanItemIds`
/ `getPlannedNutritionSummary` UTC bounds inside `/api/daily-summary`;
coach-tools `parseIsoDate` explicit-date quirk.

## Related Files

- `server/routes/_helpers.ts` (parseTimezone)
- `server/storage/helpers.ts` (getDayBounds)
- `client/lib/timezone.ts` (getDeviceTimezone)

## See Also

- docs/audits/2026-06-10-full.md (H1)
- docs/rules/database.md
