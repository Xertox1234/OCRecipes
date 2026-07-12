---
title: A rolling [now-Nd, now) instant window buckets into N+1 calendar dates — clamp before rendering X/N fractions
track: bug
category: logic-errors
tags: [timezone, date-bucketing, coach, prompt-context, fractions]
module: server
applies_to: ["server/services/**/*.ts", "server/storage/**/*.ts"]
symptoms: ["A fraction rendered as X/N shows X > N (e.g. 'logged food on 8/7 days')", "Counts derived from calendar-day bucketing exceed the nominal window length", "Bug only reproduces for users active on both the earliest partial day and today"]
created: 2026-07-12
severity: medium
---

# A rolling [now-Nd, now) instant window buckets into N+1 calendar dates — clamp before rendering X/N fractions

## Problem

The Coach fetches daily logs with a rolling instant window (`new Date(today); setDate(-7)` → `[now-7d, now)`) and then buckets them into calendar days in the user's timezone. Unless "now" is exactly midnight, that instant window overlaps parts of **eight** distinct calendar dates. A consistently-logging user — exactly the persona the positive-streak feature targets — hits all 8, and the system prompt rendered `logged food on 8/7 days`.

## Symptoms

- A fraction rendered as `X/N` shows `X > N`.
- Counts from calendar-day bucketing exceed the nominal window length by one.
- Only reproduces when the subject has activity on both the earliest partial day and the current day — easy to miss in tests that seed tidy midnight-aligned data.

## Root Cause

Two different day definitions in one pipeline: the fetch bounds are raw instants, but the aggregation is calendar dates. `⌈(7 days spanning a non-midnight boundary)⌉ = 8 dates`. Every pre-existing line in the summary used the derived `totalDays` as its own denominator (internally consistent); the new streak line introduced an independent external denominator (`windowDays`) without reconciling the two day definitions.

## Solution

Minimal: clamp the numerator — `Math.min(totalDays, windowDays)/${windowDays}` — which is honest ("logged on at least 7 of the last 7"). More correct where it matters: bucket the fetch itself by trailing calendar dates in the user's tz so numerator and denominator share one day definition.

## Prevention

Any value produced by calendar-bucketing a rolling instant window must be treated as ranging over `N+1`, not `N`. If it is rendered against an external denominator, clamp or re-bucket first — and add a test seeding activity on `N+1` consecutive calendar dates.

## Related Files

- `server/services/coach-pro-chat.ts` — `buildMealPatternSummary` clamp + comment
- `server/services/__tests__/coach-pro-chat.test.ts` — 8-calendar-day regression test

## See Also

- [../conventions/timezone-day-bucketing-threading-2026-06-10.md](../conventions/timezone-day-bucketing-threading-2026-06-10.md) — the tz-threading rules for calendar-bucketed reads
