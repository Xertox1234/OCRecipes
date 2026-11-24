---
title: "A test that formats a time in a zone with clock changes depends on the runner's timezone database — use a zone that never changes"
track: bug
category: logic-errors
tags: [testing, timezone, ci, intl]
module: server
applies_to: ["server/**/__tests__/**/*.ts", "client/**/__tests__/**/*.ts"]
symptoms: ["a test expecting '08:30' gets '09:30' in CI and passes locally", "only the hour differs, by exactly one", "the failing test passes a named IANA zone to Intl or a date helper"]
created: 2026-11-24
severity: low
---

# A test that formats a time in a zone with clock changes depends on the runner's timezone database

## Problem

A test for the Coach `get_daily_log_details` tool expected 15:30Z to print as `08:30` in `America/Edmonton`. It passed locally and failed in CI with `09:30` (PR #2010, both the coverage job and a test shard).

## Symptoms

- One-hour difference, in CI only.
- The test names a zone whose offset changes during the year, or whose rules have changed recently.

## Root Cause

`Intl.DateTimeFormat` reads the timezone database shipped with the Node build. Two machines can disagree about a zone's offset on a given date when their database versions differ. The test's fixed "now" fell on a date where they did.

## Solution

Use a zone with one offset all year in every database: `America/Phoenix` (UTC-7), `Asia/Kolkata` (UTC+5:30), or `UTC`. The test then checks the conversion, not the database.

## Prevention

- In a test that asserts a formatted local time, pick a zone without clock changes unless the clock change is the thing under test.
- When a clock change is under test, pin the date well inside one period and say so in a comment.

## Related Files

- `server/services/__tests__/coach-tools.test.ts`

## See Also

- [timezone-aware day boundaries](../conventions/timezone-aware-day-boundaries-intl-2026-05-31.md) — how production code derives the user's day
