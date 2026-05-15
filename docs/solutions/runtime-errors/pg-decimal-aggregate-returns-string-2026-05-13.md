---
title: "PostgreSQL DECIMAL aggregates return strings — Drizzle sql<number> is a lie"
track: bug
category: runtime-errors
tags: [drizzle, postgresql, decimal, sql-template, arithmetic, type-coercion]
module: server
applies_to: ["server/storage/**/*.ts", "server/routes/medication.ts"]
symptoms:
  - "proteinGoal - totalProtein produces NaN or string concatenation"
  - "Aggregate SUM(CAST(... AS DECIMAL)) compiles as number but is a string at runtime"
  - "Suggestions or summaries show nonsense values"
created: 2026-02-24
severity: high
---

# PostgreSQL DECIMAL aggregates return strings — Drizzle sql<number> is a lie

## Problem

`getDailySummary()` used `sql<number>\`SUM(CAST(... AS DECIMAL))\``to aggregate calories, protein, carbs, and fat. The protein-suggestions route consumed`dailySummary.totalProtein`directly in arithmetic to compute remaining grams.`pg`returns DECIMAL/NUMERIC values as JavaScript strings (to preserve precision), so`proteinGoal - dailySummary.totalProtein` performed string concatenation (`"80-45.5"`→`NaN`).

## Symptoms

- Protein-suggestion route returns wildly wrong remaining-grams numbers
- TypeScript type-checks the field as `number` but `typeof` returns `"string"` at runtime
- Bug only reproduces against real PostgreSQL — mocked storage returns true numbers

## Root Cause

Drizzle's `sql<T>` generic is a compile-time annotation only — no runtime coercion. The `pg` driver parses DECIMAL/NUMERIC (OID 1700) as a string by default to avoid IEEE 754 precision loss.

```typescript
// Bad — totalProtein is a string at runtime, despite the type
const remaining = proteinGoal - dailySummary.totalProtein;
```

## Solution

Coerce with `Number()` (or `parseFloat()`) at the consumption point:

```typescript
// Good — explicit numeric coercion at the boundary
const remaining = proteinGoal - Number(dailySummary.totalProtein);
```

Alternative: cast to a numeric type in SQL that `pg` parses as a number:

```sql
-- string:  SUM(CAST(column AS DECIMAL))
-- number:  SUM(CAST(column AS FLOAT))
-- number:  SUM(CAST(column AS INTEGER))
```

`FLOAT`/`INTEGER` are appropriate when precision loss is acceptable (totals for UI display); keep `DECIMAL` plus `Number()` coercion when precision matters.

## Prevention

- Treat `sql<T>` as a developer hint, never a runtime guarantee.
- Wrap `sql<number>` aggregate results with `Number()` at the API boundary.
- Add a regression test that asserts the result `typeof === "number"` for any aggregate the storage layer claims is numeric.

## Related Files

- `server/storage/nutrition.ts` — `getDailySummary()`
- `server/routes/medication.ts` — protein-suggestions route

## See Also

- [Drizzle sql<T> is a type hint, not runtime coercion](../conventions/drizzle-sql-type-hint-not-runtime-coercion-2026-05-13.md)
- [node-postgres type parsing — NUMERIC (OID 1700)](https://node-postgres.com/features/types)
