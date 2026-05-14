---
title: "Drizzle sql<T> is a type hint, not a runtime coercion"
track: knowledge
category: conventions
tags: [database, drizzle, typescript, sql, postgres, type-safety]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# Drizzle sql<T> is a type hint, not a runtime coercion

## Rule

Drizzle's `sql<T>` generic parameter is a **compile-time type assertion** — it tells TypeScript what type to expect, but does **not** coerce the value at runtime. The PostgreSQL driver (node-postgres) determines the actual runtime type. Match the `sql<T>` type to what the driver actually returns.

## Smell patterns

- `sql<Date>` on a `max(timestamp)` or `min(timestamp)` expression — driver returns ISO strings, not `Date` objects
- Calling `.toISOString()` on a value typed as `Date` from a `sql<Date>` annotation

## Examples

```typescript
// BAD: sql<Date> lies — PG driver returns a string
const rows = await db.select({
  lastLogged: sql<Date>`max(${dailyLogs.loggedAt})`,
});
rows[0].lastLogged.toISOString(); // 💥 TypeError at runtime

// GOOD: Match the type to what the driver actually returns
const rows = await db.select({
  lastLogged: sql<string>`max(${dailyLogs.loggedAt})`,
});
// Already a string — use directly or wrap in new Date() if needed
```

**Safe types for common SQL expressions:**

| Expression                         | `sql<T>` type | Why                                    |
| ---------------------------------- | ------------- | -------------------------------------- |
| `count(*)`, `cast(... as int)`     | `sql<number>` | PG returns numeric types as JS numbers |
| `max(timestamp)`, `min(timestamp)` | `sql<string>` | PG returns timestamps as ISO strings   |
| `COALESCE(SUM(...), 0)`            | `sql<number>` | Numeric aggregation with fallback      |
| `DATE(... AT TIME ZONE ...)`       | `sql<string>` | Date formatting returns strings        |

## Related Files

- `server/storage/nutrition.ts` — `getFrequentItems()` uses `sql<string>` for `max(loggedAt)`
- `server/storage/nutrition.ts` — `getDailySummary()` uses `sql<number>` for aggregations

## See Also

- [Drizzle sql template treats ${column} as bound parameters](drizzle-sql-template-bound-parameters-2026-05-13.md)
