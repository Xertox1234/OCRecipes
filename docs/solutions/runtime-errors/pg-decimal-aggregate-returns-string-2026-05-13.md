---
title: PostgreSQL DECIMAL and timestamp aggregates return strings — Drizzle sql<T> is a lie
track: bug
category: runtime-errors
module: server
severity: high
tags: [drizzle, postgresql, decimal, timestamp, sql-template, arithmetic, type-coercion]
symptoms: [proteinGoal - totalProtein produces NaN or string concatenation, Aggregate SUM(CAST(... AS DECIMAL)) compiles as number but is a string at runtime, 'TypeError: maxLoggedAt.toISOString is not a function', Compiles cleanly but crashes or produces nonsense on the first real request, Bug only reproduces against real PostgreSQL — mocked storage returns true numbers/Dates]
applies_to: [server/storage/**/*.ts, server/routes/medication.ts]
created: '2026-02-24'
last_updated: '2026-08-10'
---

# PostgreSQL DECIMAL and timestamp aggregates return strings — Drizzle sql<T> is a lie

## Problem

Two incidents, one root cause: `sql<T>` promised a type the driver never delivers.

**DECIMAL (2026-02-24):** `getDailySummary()` used `sql<number>\`SUM(CAST(... AS DECIMAL))\`` to aggregate calories, protein, carbs, and fat. The protein-suggestions route consumed `dailySummary.totalProtein` directly in arithmetic — `pg` returns DECIMAL/NUMERIC values as JavaScript strings (to preserve precision), so `proteinGoal - dailySummary.totalProtein` performed string concatenation (`"80-45.5"` → `NaN`).

**Timestamp (2026-03-21):** `getRecentQuickLogs` used `sql<Date>\`max(${dailyLogs.loggedAt})\`` and called `.toISOString()` on the result. `node-postgres` returns timestamp aggregates as ISO strings, not `Date` objects, so the method call crashed on the first request.

## Symptoms

- Arithmetic on an aggregate produces `NaN` or concatenated strings; summaries show nonsense values
- `TypeError: ....toISOString is not a function` in production
- TypeScript type-checks the field as `number`/`Date` but `typeof` returns `"string"` at runtime
- Local tests pass when they mock the storage layer — the bug only reproduces against real PostgreSQL

## Root Cause

Drizzle's `sql<T>` generic is a compile-time annotation only — no runtime coercion. The `pg` driver parses DECIMAL/NUMERIC (OID 1700) as a string by default to avoid IEEE 754 precision loss, and returns timestamp values as ISO strings.

```typescript
// Bad — totalProtein is a string at runtime, despite the type
const remaining = proteinGoal - dailySummary.totalProtein;

// Bad — sql<Date> lies; runtime value is a string
const [row] = await db
  .select({ maxLoggedAt: sql<Date>`max(${dailyLogs.loggedAt})` })
  .from(dailyLogs);
row.maxLoggedAt.toISOString(); // TypeError: not a function
```

## Solution

Coerce at the consumption boundary, with the annotation matching what the driver actually returns:

```typescript
// Numeric aggregates — explicit coercion at the boundary
const remaining = proteinGoal - Number(dailySummary.totalProtein);

// Timestamp aggregates — annotate as string, parse where needed
const [row] = await db
  .select({ maxLoggedAt: sql<string>`max(${dailyLogs.loggedAt})` })
  .from(dailyLogs);
const lastLoggedAt = row.maxLoggedAt ? new Date(row.maxLoggedAt) : null;
```

Alternative for numerics: cast to a type `pg` parses as a number, when precision loss is acceptable:

```sql
-- string:  SUM(CAST(column AS DECIMAL))
-- number:  SUM(CAST(column AS FLOAT))
-- number:  SUM(CAST(column AS INTEGER))
```

`FLOAT`/`INTEGER` are appropriate for UI-display totals; keep `DECIMAL` plus `Number()` coercion when precision matters.

## Prevention

- Treat `sql<T>` as a developer hint, never a runtime guarantee.
- Wrap `sql<number>` aggregate results with `Number()` at the API boundary; default timestamp aggregations to `sql<string>` and parse to `Date` explicitly.
- Add a regression test that asserts `typeof === "number"` for any aggregate the storage layer claims is numeric.

## Related Files

- `server/storage/nutrition.ts` — `getDailySummary()` (numeric aggregates), Quick Log recent-items query (timestamp aggregate)
- `server/routes/medication.ts` — protein-suggestions route

## See Also

- [Drizzle sql<T> is a type hint, not runtime coercion](../conventions/drizzle-sql-type-hint-not-runtime-coercion-2026-05-13.md) — the distilled rule, with the safe-types table
- [node-postgres type parsing — NUMERIC (OID 1700)](https://node-postgres.com/features/types)
