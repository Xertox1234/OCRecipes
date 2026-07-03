---
title: Drizzle sql<Date> on aggregates is a type lie — PG returns strings
track: bug
category: runtime-errors
module: server
severity: critical
tags: [drizzle, sql-template, postgresql, timestamp, type-coercion]
symptoms: ['TypeError: maxLoggedAt.toISOString is not a function', Compiles cleanly but crashes on the first real request, Aggregate of timestamp column returns string at runtime]
applies_to: [server/storage/**/*.ts]
created: '2026-03-21'
---

# Drizzle sql<Date> on aggregates is a type lie — PG returns strings

## Problem

A `getRecentQuickLogs` query used `sql<Date>\`max(${dailyLogs.loggedAt})\``to annotate a max-timestamp aggregate, then called`.toISOString()`on the result. The code compiled, but`node-postgres`returns timestamp values as ISO strings — not`Date` objects — so the method call crashed on the first request.

## Symptoms

- `TypeError: ... .toISOString is not a function` in production
- Local tests pass when they mock the storage layer
- Drizzle types claim the value is `Date`

## Root Cause

`sql<T>` is a compile-time assertion only. It does not coerce values at runtime. The `pg` driver returns DECIMAL/NUMERIC/timestamp aggregates as strings to preserve precision.

```typescript
// Bad — sql<Date> lies; runtime value is a string
const [row] = await db
  .select({ maxLoggedAt: sql<Date>`max(${dailyLogs.loggedAt})` })
  .from(dailyLogs);
row.maxLoggedAt.toISOString(); // TypeError: not a function
```

## Solution

Type the column annotation as `string` and coerce at the boundary if needed:

```typescript
// Good — type matches the driver's actual return
const [row] = await db
  .select({ maxLoggedAt: sql<string>`max(${dailyLogs.loggedAt})` })
  .from(dailyLogs);
const lastLoggedAt = row.maxLoggedAt ? new Date(row.maxLoggedAt) : null;
```

## Prevention

- Treat `sql<T>` as a developer hint, not a runtime guarantee.
- For timestamp aggregations, default to `sql<string>` and parse to `Date` explicitly where needed.
- For numeric aggregates, see the decimal-aggregate companion learning.

## Related Files

- `server/storage/nutrition.ts` — Quick Log recent items query

## See Also

- [Drizzle sql<T> is a type hint, not runtime coercion](../conventions/drizzle-sql-type-hint-not-runtime-coercion-2026-05-13.md)
- [PostgreSQL decimal aggregates return strings](./pg-decimal-aggregate-returns-string-2026-05-13.md)
