---
title: "PostgreSQL Session Timezone + Drizzle UTC Mismatch"
track: bug
category: logic-errors
tags: [drizzle, postgres, timezone, utc, daily-logs, date-helpers]
module: server
applies_to:
  ["server/db.ts", "server/storage/helpers.ts", "server/storage/**/*.ts"]
symptoms:
  - "Day-boundary queries return wrong results in non-UTC timezones"
  - "Item logged at 11 PM Eastern shows up as next-day in `getDailyLogs`"
  - "Tests pass on UTC CI but fail on a developer machine in America/New_York"
created: 2026-03-27
severity: high
---

# PostgreSQL Session Timezone + Drizzle UTC Mismatch

## Problem

Drizzle ORM interprets `timestamp` (without timezone) columns as UTC — it appends `+0000` when reading and sends `toISOString()` (UTC) when writing. PostgreSQL's `CURRENT_TIMESTAMP` and `now()` use the **session timezone** to produce values for `timestamp` columns. If the PostgreSQL server or the connection's session timezone is set to a non-UTC zone (e.g., `America/Toronto`), then `CURRENT_TIMESTAMP` default values are written in local time while Drizzle reads them as UTC. Day-boundary queries (`getDayBounds`, `getDailyLogs`) returned wrong results: items logged at 11 PM Eastern would appear as the next UTC day.

The same issue affected `getDayBounds()` and `getMonthBounds()` helpers, which used `setHours()` (local time) instead of `setUTCHours()`. CI was UTC, so tests passed. Any non-UTC dev machine surfaced the bug immediately.

## Symptoms

- `getDailyLogs(userId, today)` misses items logged late in the previous evening
- Date-bucketed statistics shift by one day in non-UTC environments
- Tests are green on CI, red on a dev machine in a non-UTC zone

## Root Cause

`timestamp` columns in PostgreSQL are timezone-naive but their inserted values reflect the session timezone at insert time. Drizzle assumes all values are UTC on read. The mismatch is invisible because both sides use the same `Date` JavaScript object on the client end — but the underlying UTC offset is wrong by however many hours separate the session timezone from UTC.

`setHours()` on a JavaScript `Date` uses the runtime's local timezone — so date-boundary helpers built with it also drift on non-UTC machines.

## Solution

Two changes:

1. Force the PostgreSQL session timezone to UTC at the connection-pool level:

```typescript
// server/db.ts
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c timezone=UTC",
});
```

2. Convert date helpers from local-time methods to UTC methods:

```typescript
// server/storage/helpers.ts
startOfDay.setUTCHours(0, 0, 0, 0); // was: setHours(0, 0, 0, 0)
endOfDay.setUTCHours(23, 59, 59, 999); // was: setHours(23, 59, 59, 999)
```

## Prevention

- When using Drizzle ORM with `timestamp` (not `timestamptz`), the PostgreSQL session timezone must be UTC — Drizzle silently assumes this.
- Use `setUTCHours` / `getUTCDate` / `Date.UTC()` everywhere in server code that computes date boundaries. `setHours()` is the runtime's local timezone.
- Tests in UTC-timezone CI will not catch this bug. Add a `TZ=America/New_York` test variant if timezone correctness matters.
- The `options: "-c timezone=UTC"` approach sets the timezone per-connection in the pool, so it works regardless of the server default.

## Related Files

- `server/db.ts` — `options: "-c timezone=UTC"` on Pool constructor
- `server/storage/helpers.ts` — `getDayBounds()`, `getMonthBounds()` now use UTC methods
- `server/storage/__tests__/helpers.test.ts` — tests updated to use UTC assertions

## See Also

- [Timestamp without TZ roundtrip — real DB tests](../design-patterns/timestamp-without-tz-roundtrip-real-db-tests-2026-05-13.md)
- [CURRENT_TIMESTAMP fixed at transaction start](./current-timestamp-fixed-at-transaction-start-2026-05-13.md)
