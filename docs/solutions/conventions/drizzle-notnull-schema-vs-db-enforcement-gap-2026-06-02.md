---
title: Drizzle .notNull() narrows the TS type but does NOT enforce it in the DB
track: knowledge
category: conventions
module: shared
tags: [database, drizzle, schema, typescript, jsonb, notNull, migration]
applies_to: [shared/schema.ts, server/routes/**/*.ts, shared/types/**/*.ts]
created: '2026-06-02'
last_updated: '2026-06-02'
---

# Drizzle .notNull() narrows the TS type but does NOT enforce it in the DB

## Rule

Adding `.notNull()` to a Drizzle column in `shared/schema.ts` is a **TypeScript-only**
change at the moment you commit it. It narrows the inferred SELECT type from
`T | null` to `T` and lets you delete defensive `?? []` / `as T` casts at consumers —
but it does **not** add the `NOT NULL` constraint to the live PostgreSQL column. The
column stays `is_nullable=YES` until a separate `ALTER TABLE ... ALTER COLUMN ... SET
NOT NULL` runs (via `db:push` or an explicit migration).

In this project that `ALTER` is **persistently deferred**: `db:push` aborts
non-interactively (it stalls on unrelated destructive-change prompts) and a targeted
`ALTER ... SET NOT NULL` is blocked by the migration classifier, which needs explicit
user approval. So the schema `.notNull()` and the matching DB constraint land in two
different steps, often far apart.

**What this means for a `.default([])` jsonb column getting `.notNull()`:**

1. Removing the runtime `?? []` guard at consumers is **type-safe and provably correct
   today** — but only because no app write path can seed a NULL: `.default([])` covers
   Drizzle inserts, and the insert-side Zod schemas use `.optional()` (→ `undefined` →
   default), **not** `.nullable()`. Confirm both before deleting the guard.
2. It still **widens the gap**: the type now *asserts* non-null that the DB does not
   *enforce*. A raw-SQL / bulk-import / future migration path that writes an explicit
   `NULL` would make the serializer return `null` despite the type promising `T[]`, with
   no runtime guard to catch it. The deferred `ALTER ... SET NOT NULL` is the only thing
   that closes the gap.

## When this applies

Any time you add `.notNull()` to an existing column (especially a `jsonb().default([])`
array column) and want to remove the `?? []` / `as` casts it forced at consumers — the
canonical case is the public-API serializer (`server/routes/public-api.ts`).

## What to do

- **Verify before deleting guards.** Query the live DB for the actual state — do not
  assume `.default([])` implies the DB constraint exists:

  ```sql
  SELECT is_nullable FROM information_schema.columns
   WHERE table_name = '<table>' AND column_name = '<col>';
  SELECT count(*) FROM "<table>" WHERE "<col>" IS NULL;   -- must be 0
  ```

  Across three rounds of this change the columns were consistently `is_nullable=YES`
  with **0 NULL rows** — safe to narrow, but the constraint was absent.
- **Confirm the write side cannot seed a NULL.** Insert-path Zod must be `.optional()`
  (not `.nullable()`), and Drizzle's `.default([])` must cover the omitted case.
- **Do not claim "no migration required."** The honest state is: `check:types` is clean,
  but the DB-constraint sync (`ALTER ... SET NOT NULL`) is **deferred / pending user
  action**, not verified-clean. Document the deferral in the todo's Updates and surface
  it in the report so the cumulative gap stays visible.
- **Expect a kimi-review false-positive.** kimi sees only the diff and is blind to the
  `.notNull()` in the *same* diff that makes the type non-null (which is why
  `check:types` passes). It will flag the removed `?? []` as a CRITICAL "may return
  null." Verify against the 0-NULL DB evidence and the `.optional()` write paths, then
  treat it as a verified false-positive — do not revert correct code to appease a
  diff-scoped linter.

## Why

`.notNull()` participates in two independent systems: Drizzle's TypeScript type
inference (immediate, at compile time) and PostgreSQL DDL (only when `db:push` /
a migration applies it). They are decoupled. Trusting the type after a schema edit is
correct for compile-time safety, but runtime safety against a NULL still depends on the
DB constraint actually existing — and in this project it usually does not yet.

## Examples

```typescript
// shared/schema.ts — narrows the SELECT type to string[]; does NOT touch the live DB.
canonicalImages: jsonb("canonical_images").$type<string[]>().default([]).notNull(),

// server/routes/public-api.ts — safe to drop the guard ONLY after verifying
// is_nullable / 0-null + .optional() write paths.
// before: canonicalImages: (row.canonicalImages as string[]) ?? [],
// after:  canonicalImages: row.canonicalImages,
```

## Related Files

- `shared/schema.ts` — `communityRecipes.canonicalImages` / `instructionDetails` /
  `toolsRequired` / `chefTips`, `medicationLogs.sideEffects`, `menuScans.menuItems`
- `server/routes/public-api.ts` — `serializeCuratedRecipe` (guards removed here)
- `shared/types/public-api.ts` — `CuratedRecipeResponse` (response type the casts bridged)
- `docs/rules/database.md` — "Always pair `.default([])` with `.notNull()` on array columns"

## See Also

- [Typed JSONB columns with .$type<>() and sql default](../design-patterns/typed-jsonb-columns-type-sql-default-2026-05-13.md)
- [NOT NULL on foreign keys](not-null-on-foreign-keys-2026-05-13.md)
- [Nullable, not empty, for derived safety columns](nullable-not-empty-for-derived-safety-columns-2026-05-17.md)
