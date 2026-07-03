---
title: A notNull-with-default column ripples to $inferSelect (now required) but not to a createInsertSchema().omit() insert type (stays optional)
track: bug
category: code-quality
module: shared
severity: medium
tags: [drizzle, drizzle-zod, schema, inferSelect, inferInsert, createInsertSchema, jsonb, test-factory, type-safety]
symptoms: [Adding a `.notNull()` column with a `.default()` to a Drizzle table compiles fine for inserts but fails `tsc` on unrelated hand-built object literals, '`check:types` errors like `Property ''notificationPrefs'' is missing in type ''{...}'' but required in type ''UserProfile''` in test factories / mock builders', 'The new column does NOT break `createInsertSchema(table).omit({...})`-derived insert types, so storage insert callers compile unchanged — masking the select-side break until a full type-check']
applies_to: [shared/schema.ts, server/**/__tests__/**/*.ts, server/**/factories/*.ts]
created: '2026-06-26'
module_note: shared
---

# A notNull-with-default column ripples to $inferSelect (now required) but not to a createInsertSchema().omit() insert type (stays optional)

## Problem

Adding one `.notNull()`-with-`.default()` column to a Drizzle table updates the **select** type and the **insert** type asymmetrically, and only the select side breaks consumers:

- `Select = typeof table.$inferSelect` — the new column becomes a **required** field (it is `NOT NULL`, so a selected row always has it). Every place that hand-builds a full `Select` object literal (test factories, mock builders) now fails `tsc` until the field is added.
- `Insert = z.infer<typeof createInsertSchema(table).omit({...})>` — a column **with a default** is **optional** in the insert schema. Existing insert callers compile unchanged, so nothing on the write path signals that a column was added.

The result is a deceptive type-check: the storage/insert code (the thing you changed) is green, but unrelated `$inferSelect` literals elsewhere are red. In this repo, adding `user_profiles.notificationPrefs` (jsonb, notNull, default `'{}'`) compiled for every `createUserProfile` caller but broke two exhaustive `UserProfile` literals — `server/__tests__/factories/user.ts` and `server/services/__tests__/carousel-builder.test.ts` — each of which had to gain the new field.

## Symptoms

- A new `.notNull().default(...)` column passes the insert-path edit but `npm run check:types` fails on object literals typed as the table's `$inferSelect` alias.
- The errors are in test factories / mock builders, not the file you edited.
- The insert schema (`createInsertSchema(...).omit(...)`) shows no error — proving the asymmetry.

## Root Cause

Two type derivations diverge for a `NOT NULL DEFAULT` column:

1. **`$inferSelect`** models a row as read back from Postgres. A `NOT NULL` column is always present, so it is a **required** property. Any exhaustive literal of that type must now include it.
2. **`createInsertSchema(table)`** (drizzle-zod) makes a column **optional** when it has a default — the DB supplies the value if omitted. `.omit({...})` only removes the explicitly-listed keys; a brand-new column is *not* in the omit list, so it flows in as an optional field. Inserts that never set it still type-check.

(Contrast the sibling gotcha where the insert type is a `createInsertSchema().pick()` subset — there a new column does **not** propagate to inserts at all; see See Also.)

## Solution

When you add a `.notNull()` column (with or without a default), treat the **`$inferSelect` consumers** as the blast radius, not the insert callers:

1. Grep for hand-built literals of the table's select alias (`: UserProfile = {`, `as UserProfile`, factory `defaults`) and add the new field with a representative value.
2. Run a **full** `npm run check:types` — not just the focused test for the file you changed — because the breakage lands in unrelated files.
3. If the column is genuinely optional at the domain level, prefer `.notNull().default(...)` (keeps inserts ergonomic) but accept that every select literal must carry it; if you don't want to touch select literals, a nullable column (`$type<T | null>()` without `.notNull()`) makes `$inferSelect` optional too — a deliberate trade-off, not an accident.

## Prevention

- After any `shared/schema.ts` column addition, run the full type-check and fix the `$inferSelect` literals in the same commit (collateral test-factory edits belong with the schema change, not a follow-up).
- A reviewer seeing a new `.notNull()` column should ask "which `$inferSelect` literals (factories/mocks) gained the field?" — absence is the smell.

## Related Files

- `shared/schema.ts` — the `userProfiles.notificationPrefs` column addition
- `server/__tests__/factories/user.ts` — exhaustive `UserProfile` factory that needed the field
- `server/services/__tests__/carousel-builder.test.ts` — mock `UserProfile` literal that needed the field

## See Also

- [Adding a NOT NULL column to a shared table — blast-radius checklist](../best-practices/adding-not-null-column-to-shared-table-blast-radius-2026-06-18.md) — the broader checklist; covers the `.pick()` + NOT-NULL-**no-default** case (column absent from inserts entirely). This file is the complementary `.omit()` + **with-default** case (column present-but-optional for inserts, required for selects).
- [Co-located jsonb backfill must share the source column's table](../conventions/co-located-jsonb-backfill-column-must-share-source-table-2026-06-26.md) — sibling schema-coupling rule from the same change: where a backfilled column must physically live
