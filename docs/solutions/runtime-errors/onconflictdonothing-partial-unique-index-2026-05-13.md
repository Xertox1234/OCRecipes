---
title: 'onConflictDoNothing({ target }) silently no-ops on partial unique indexes'
track: bug
category: runtime-errors
module: server
severity: high
tags: [drizzle, postgres, partial-index, on-conflict, insert]
symptoms: ['Insert with `onConflictDoNothing({ target })` throws a constraint-violation at runtime', Duplicate rows appear despite an `ON CONFLICT DO NOTHING` clause, Drizzle-generated SQL targets a column list but the constraint is a partial unique index]
applies_to: [server/storage/**/*.ts, shared/schema.ts]
created: '2026-05-09'
---

# onConflictDoNothing({ target }) silently no-ops on partial unique indexes

## Problem

PostgreSQL can only use a partial unique index (one with a `WHERE` predicate) as an `ON CONFLICT` target if the SQL references the index by name — not by column list. Drizzle's `onConflictDoNothing({ target: [table.col] })` generates `ON CONFLICT (col) DO NOTHING`, which cannot match a partial index and causes the statement to **insert a duplicate row** (or throw a constraint-violation error at the DB level) instead of silently skipping.

## Symptoms

- Insert throws `duplicate key value violates unique constraint "..."` despite `onConflictDoNothing({ target })`
- Two rows exist with the same value in the partial-index column
- The unique index in `shared/schema.ts` was constructed with `.where(sql\`...\`)`

## Root Cause

Drizzle resolves a `target` array to a bare column-list form. PostgreSQL only accepts column-list `ON CONFLICT` targets for full unique indexes. A partial index (`WHERE col IS NOT NULL`) is treated as a separate named constraint that Drizzle cannot reference via column list alone.

## Solution

Omit `target` entirely:

```typescript
// Bad — target form cannot match a partial WHERE-predicate index
await db
  .insert(coachNotebook)
  .values(data)
  .onConflictDoNothing({ target: coachNotebook.dedupeKey });

// Good — no-arg form lets PostgreSQL choose the best matching constraint
await db.insert(coachNotebook).values(data).onConflictDoNothing();
```

To detect this at schema time, search `shared/schema.ts` for indexes constructed with `.where(sql\`...\`)`— any unique index using that form is a partial index, and every storage function that inserts into that table must use`onConflictDoNothing()` (no args).

**Affected tables in this codebase (as of 2026-05-09):**

- `coachNotebook` — `dedupeKeyUniqueIdx` (WHERE `dedupeKey IS NOT NULL`)
- `communityRecipes` — `sourceMessageIdUniqueIdx` (WHERE `sourceMessageId IS NOT NULL`)
- `chatMessages` — `turnKeyUniqueIdx` (WHERE `turnKey IS NOT NULL`)

## Prevention

When introducing a partial unique index, document the corresponding `onConflictDoNothing()` (no-arg) call in the storage function. Audit existing inserts against the partial-index table list at schema-migration time.

## Related Files

- `server/storage/recipe-from-chat.ts:110`
- `server/storage/coach-notebook.ts:85`
- Audit 2026-05-09 C1

## See Also

- [Defensive cache writes onconflictdonothing](../conventions/defensive-cache-writes-onconflictdonothing-2026-05-13.md)
- [Functional expression unique index raw sql upsert](../design-patterns/functional-expression-unique-index-raw-sql-upsert-2026-05-13.md)
