---
title: Drizzle sql template expands a JavaScript array into a parameter list, so array casts and ANY/ALL/unnest fail
track: bug
category: runtime-errors
module: server
severity: high
tags: [database, drizzle, sql-template, postgresql, array, in-array, sql-param]
symptoms: ['PostgreSQL error: cannot cast type record to text[]', 'PostgreSQL error: malformed array literal', 'PostgreSQL error: op ANY/ALL (array) requires array on right side', Failure only appears when the JavaScript array is non-empty, Unit tests with a fake db pass because the SQL never reaches Postgres]
applies_to: [server/storage/**/*.ts, server/scripts/**/*.ts]
created: '2026-05-15'
last_updated: '2026-11-03'
---

# Drizzle sql template expands a JavaScript array into a parameter list, so array casts and ANY/ALL/unnest fail

## Problem

A JavaScript array interpolated into Drizzle's `sql` template does not reach Postgres as an array. Three incidents so far:

- `getRecipesWithEmptyMealTypes` (2026-05-15): `` sql`${col} = ANY(${recipeIds})` ``
- `cleanup-retention.ts` `purgeBatch` (found 2026-11-03): `` sql`${userId} <> ALL(${excludedUserIds}::text[])` ``. Every nightly retention purge would have failed as soon as one user was active. It went unnoticed only because the app has no users yet, and because the purge tests use a fake db.
- `lockBarcodes` (#1722, caught by its test before merge): `` unnest(${barcodes}::text[]) ``

## Symptoms

- `cannot cast type record to text[]` (two or more elements), `malformed array literal: "a"` (one element), or `op ANY/ALL (array) requires array on right side`
- Only when the array is non-empty: an empty-array guard (`length === 0 ? sql\`TRUE\` : ...`) hides it
- Type checking passes, and tests against a fake db pass

## Root Cause

The `sql` template treats a JS array as a **list of values** and emits one placeholder per element. Measured with `new PgDialect().sqlToQuery(...)`:

```
sql`x <> ALL(${["a", "b"]}::text[])`
  → "x <> ALL(($1, $2)::text[])"   params ["a","b"]      — a row value, not an array
sql`x <> ALL(${sql.param(["a", "b"])}::text[])`
  → "x <> ALL($1::text[])"         params [["a","b"]]    — one array parameter
```

`($1, $2)` is a row constructor, so the cast fails. With one element, `($1)` is a parenthesised scalar, and `'a'::text[]` is a malformed array literal. (An earlier version of this note said the array was sent as "one scalar parameter". That was wrong, and it hid the fix.)

## Solution

- **Membership filter** → use `inArray(column, arr)` from `drizzle-orm`. It handles binding and empty arrays.
- **One array parameter is required** (`<> ALL(...)`, `unnest(...)`, a list too long for one placeholder per element, since Postgres caps a query at ~65k parameters) → wrap it: `${sql.param(arr)}::text[]`. node-postgres then serialises the JS array as a single Postgres array literal.

```typescript
// one statement, one parameter, any length
sql`SELECT pg_advisory_xact_lock(hashtextextended(b, 0)) FROM unnest(${sql.param(sorted)}::text[]) AS b`;
sql`${userId} <> ALL(${sql.param(excludedUserIds)}::text[])`;
```

## Prevention

- Never interpolate a bare array into a `sql` template next to `ANY`/`ALL`/`unnest` or an array cast. Grep: `\$\{[A-Za-z_.]+\}::[a-z]+\[\]|ANY\(\$\{|ALL\(\$\{|unnest\(\$\{` with no `sql.param`.
- Test the query against a real database with a **non-empty** array. A fake db never parses the SQL.
- Reviewer check: `.claude/agents/server-reviewer.md` (Drizzle `sql` rules).

## Related Files

- `server/storage/meal-plan-recipes-browse.ts` — `inArray` fix
- `server/scripts/cleanup-retention.ts` — `purgeBatch` exclusion list, `sql.param`
- `server/scripts/__tests__/cleanup-retention-active-users.test.ts` — real-DB purge with an active user
- `server/storage/verification.ts` — `lockBarcodes`, `sql.param`

## See Also

- [Drizzle sql template parameterizes column references inside subqueries](./drizzle-sql-template-column-ref-as-param-2026-05-13.md)
- [Drizzle sql template documentation](https://orm.drizzle.team/docs/sql)
