---
title: "Drizzle-Zod Nullable JSONB Loses Type Hint"
track: bug
category: code-quality
tags:
  [
    drizzle,
    drizzle-zod,
    jsonb,
    nullable,
    type-safety,
    typescript,
    shared-schema,
  ]
module: shared
applies_to: ["shared/schema.ts", "server/**/*.ts"]
symptoms:
  - "TS2769 'No overload matches this call' at db.insert(table).values(...)"
  - "Type 'string' is not assignable to ... allergens"
  - "Column type widens to 'DerivedRecipeAllergen[] | Json | undefined'"
created: 2026-05-17
severity: medium
---

# Drizzle-Zod Nullable JSONB Loses Type Hint

## Problem

After making a typed `jsonb` column nullable (dropping `.notNull()`), TypeScript errors appeared at every `db.insert(table).values(...)` call site. The column's type widened from the precise `T[]` to a loose union that included the generic `Json` type, breaking type safety for insert operations.

## Symptoms

- `db.insert(table).values(...)` fails with **TS2769: No overload matches this call**.
- The error message mentions "Type 'string' is not assignable to ... allergens", even though the passed value is correct.
- The column's inferred insert type becomes `DerivedRecipeAllergen[] | Json | undefined` instead of the expected `DerivedRecipeAllergen[] | null | undefined`.

## Root Cause

`drizzle-zod` 0.7.x's `createInsertSchema`, when applied to a **nullable** `jsonb` column that carries a `.$type<T | null>()` hint, does not preserve the user-provided type hint. Instead, the column is downgraded to a generic `Json` Zod schema (which accepts `string`, `number`, `boolean`, etc.). This does **not** happen for `NOT NULL` typed `jsonb` columns — only the nullable case triggers the loosening.

The `Insert` type in the codebase was derived via `z.infer<typeof insertXSchema>`, so it inherited the loose union. As a result, TypeScript could not narrow the expected value to the original typed array, and insert calls became type-unsafe.

## Solution

Derive the `Insert` type from Drizzle's native inference instead of from `createInsertSchema`. Replace:

```typescript
// Before: uses drizzle-zod schema, loses type hint for nullable jsonb
const insertSchema = createInsertSchema(mealPlanRecipes);
type InsertMealPlanRecipe = z.infer<typeof insertSchema>;
```

with:

```typescript
// After: uses Drizzle's native $inferInsert, respects .$type<>() hint
type InsertMealPlanRecipe = typeof mealPlanRecipes.$inferInsert;
```

`$inferInsert` always respects the `.$type<>()` hint and yields the precise `T[] | null | undefined` union. This approach is already used for `InsertCommunityRecipe` elsewhere in the same file (`shared/schema.ts`).

If the `createInsertSchema` object is not used elsewhere (e.g., for runtime validation), it can be left in place or removed; it is not harmful as long as no types are derived from it.

## Prevention

- When a typed `jsonb` column is nullable, always prefer `$inferInsert` for the Insert type.
- Reserve `createInsertSchema` and `z.infer` for runtime request validation, where the loose `Json` type is acceptable or can be refined with `.pipe()` or a custom Zod schema.
- Avoid deriving Insert types from drizzle-zod schemas when the column uses `.$type()` with null.
- Review existing schema definitions for the same pattern — any nullable `jsonb` with a type hint that uses `z.infer<typeof insertXSchema>` should be updated.

## Related Files

- `shared/schema.ts` — definition of `InsertMealPlanRecipe` type; also contains `InsertCommunityRecipe` as correct example.
- `server/**/*.ts` — files with `db.insert(mealPlanRecipes).values(...)` that produced the TS2769 error.

## See Also

- [Drizzle SQL type hint is not a runtime coercion](../conventions/drizzle-sql-type-hint-not-runtime-coercion-2026-05-13.md)
- [Nullable, not empty, for derived safety columns](../conventions/nullable-not-empty-for-derived-safety-columns-2026-05-17.md) — the schema change that surfaced this gotcha.
