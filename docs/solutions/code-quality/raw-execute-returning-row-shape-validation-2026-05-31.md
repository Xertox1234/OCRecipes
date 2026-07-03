---
title: Raw db.execute() RETURNING rows need column aliasing + Zod validation
track: bug
category: code-quality
module: server
severity: medium
tags: [drizzle, drizzle-zod, raw-sql, execute, returning, timestamp, snake-case, type-safety, zod]
symptoms: [A field typed `Date` (e.g. `loggedAt`) is a string at runtime after a raw `db.execute(...RETURNING)` — `.toISOString()` / date math fails, 'A camelCase property read off `result.rows[0]` is `undefined` because the driver key is snake_case (`logged_at`)', '`result.rows[0] as WeightLog` / `execute<WeightLog>()` compiles but the object''s real shape does not match the type']
applies_to: [server/storage/**/*.ts]
created: '2026-05-31'
---

# Raw db.execute() RETURNING rows need column aliasing + Zod validation

## Problem

A raw `db.execute(sql`...RETURNING *`)` call does **not** go through
Drizzle's query-builder column mapping. `result.rows[0]` is a driver-native
`node-postgres` row, which means:

1. Keys are SQL **snake_case** (`user_id`, `logged_at`) — **not** the camelCase
   Drizzle field names.
2. `timestamptz` and `decimal`/`numeric` columns come back as **strings**, not
   `Date` / `number` — Drizzle's per-column parsers are bypassed for raw
   `execute`.

So casting `result.rows[0] as WeightLog` (or `execute<WeightLog>()`) is a
compile-time-only lie: at runtime `loggedAt` is actually a string and the keys
are snake_case. The cast hides both mismatches.

## Symptoms

- A field typed `Date` is a string at runtime after a raw `RETURNING` — date
  methods / arithmetic fail.
- Reading a camelCase property off `result.rows[0]` returns `undefined`
  (the real key is snake_case).
- `as T` / `execute<T>()` compiles but the object's real shape differs from `T`.

## Root Cause

The type-safe query builder (`.returning()`) maps driver rows onto the Drizzle
column definitions — camelCase renaming **and** type coercion (timestamps →
`Date`, etc.). `db.execute()` is a low-level escape hatch that returns the raw
driver result and bypasses all of that. The `execute<T>()` generic and `as T`
are compile-time assertions only; there is no runtime transformation.

## Solution

Alias every `RETURNING` column to its camelCase field name in the SQL, then
runtime-validate with `createSelectSchema(table, { <field>: z.coerce.date() })`.
The per-field override coerces the string timestamp back to the `Date` the
inferred select type expects, and the parse catches schema drift
(added/renamed columns) at runtime.

```typescript
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// timestamptz comes back as a string from raw execute -> coerce it to Date.
const weightLogSelectSchema = createSelectSchema(weightLogs, {
  loggedAt: z.coerce.date(),
});

const result = await db.execute(
  sql`INSERT INTO weight_logs (user_id, weight, unit, source, note)
      VALUES (${log.userId}, ${log.weight}, ${log.unit ?? "lb"},
              ${log.source ?? "manual"}, ${log.note ?? null})
      ON CONFLICT (user_id, DATE(logged_at AT TIME ZONE 'UTC'))
      DO UPDATE SET weight = EXCLUDED.weight, unit = EXCLUDED.unit,
                    source = EXCLUDED.source, note = EXCLUDED.note
      RETURNING id,
                user_id   AS "userId",
                weight,
                unit,
                source,
                note,
                logged_at AS "loggedAt"`,
);
return weightLogSelectSchema.parse(result.rows[0]); // fully-typed WeightLog
```

`createSelectSchema` and its field-refinement second argument are available in
`drizzle-zod` 0.7.x (the version this repo is pinned to). `weight` is a
`decimal` and `node-postgres` returns it as a string, which already matches the
schema's `z.string()` — only `loggedAt` needed an override here.

**Contrast with the typed query builder:** `db.insert(table).values(...).returning()`
already remaps keys to camelCase and parses timestamps to `Date`, so
`.returning()` rows need no aliasing or coercion. Only raw `execute()` does.

## Prevention

- Prefer `.returning()` over raw `execute(...RETURNING)` whenever the query
  builder can express the statement. Reach for raw `execute` only when the SQL
  is otherwise inexpressible (e.g. an `ON CONFLICT` against a functional
  expression index, as in `createWeightLog`).
- When raw `execute` + `RETURNING` is unavoidable: explicitly list and alias the
  columns to camelCase, then `createSelectSchema(...).parse(result.rows[0])`
  with `z.coerce.date()` / `z.coerce.number()` overrides for string-returned
  columns. Never `as T` the raw row.
- **Test gotcha (advisor-confirmed):** mocked storage tests that return a
  hand-built camelCase row will NOT catch the snake_case / string-vs-Date
  mismatch — a real-DB integration test exercising the `create` function is
  required. And any mock row must include **all** columns the select schema
  requires: a row omitting a nullable column like `source`/`note` is rejected by
  `.parse()` (`note: Required`), which is correct but surprises tests that
  previously hand-built partial rows.

## Related Files

- `server/storage/health.ts` — `createWeightLog` / `createWeightLogAndUpdateUser`,
  the original cast sites, now aliased + Zod-parsed.
- `server/storage/cookbooks.ts` — `addRecipeToCookbook` already aliases its
  `RETURNING` columns to camelCase (the precedent that confirmed the snake_case
  behavior).

## See Also

- [Drizzle sql<Date> on aggregates is a type lie — PG returns strings](../runtime-errors/drizzle-sql-date-type-lie-pg-strings-2026-05-13.md)
- [Drizzle SQL type hint is not a runtime coercion](../conventions/drizzle-sql-type-hint-not-runtime-coercion-2026-05-13.md)
