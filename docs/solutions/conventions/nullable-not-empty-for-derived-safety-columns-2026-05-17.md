---
title: "Nullable, not empty, for derived safety columns"
track: knowledge
category: conventions
tags: [database, postgres, schema, safety, allergens, derived-columns, nullable]
module: server
applies_to:
  [
    "server/storage/**/*.ts",
    "shared/constants/allergens.ts",
    "shared/schema.ts",
  ]
created: 2026-05-17
---

# Nullable, not empty, columns for derived safety columns

## Rule

For a safety- or correctness-critical derived/cached column, never use `NOT NULL DEFAULT []` (or ` DEFAULT '{}'`). An empty array cannot distinguish "analyzed/derived, genuinely empty" from "not yet derived" — collapsing those two fail-closed states creates a fail-OPEN window: between the migration that adds the column and the backfill that populates it, every row reads as empty and the safety predicate treats it as safe.

Instead make the column NULLABLE with no default: `null` means "not derived" and the predicate must treat it as conservatively unsafe (fail-closed); `[]` keeps the distinct meaning "derived, genuinely empty" = safe. Write paths must always store a concrete array so `null` only ever appears for un-processed rows.

## Why

A delayed or missed backfill becomes a mere under-inclusion (some safe recipes hidden) instead of a safety hazard (unsafe recipes shown as safe). The fail-closed default forces the system to treat unknown state as dangerous, which is the conservative choice for safety-critical logic.

## Examples

### Schema definition (Drizzle)

```typescript
// BAD: Safety column with empty default
export const mealPlanRecipes = pgTable("meal_plan_recipes", {
  allergens: jsonb("allergens").notNull().default([]),
  // ... other columns
});

// GOOD: Safety column nullable with no default
export const mealPlanRecipes = pgTable("meal_plan_recipes", {
  allergens: jsonb("allergens"),
  // ... other columns
});
```

### Query-time safety check

```typescript
// shared/constants/allergens.ts
export function isRecipeSafeForAllergies(allergens: string[] | null): boolean {
  if (allergens === null) return false; // not yet derived → unsafe
  return allergens.length === 0; // derived empty → safe
}
```

### Migration reset

```sql
-- 0004_recipe_allergens_nullable.sql
UPDATE meal_plan_recipes SET allergens = NULL WHERE allergens = '[]'::jsonb;
ALTER TABLE meal_plan_recipes ALTER COLUMN allergens DROP NOT NULL;
ALTER TABLE meal_plan_recipes ALTER COLUMN allergens DROP DEFAULT;
```

## Contrast with non-safety columns

For a plain non-safety array column (e.g., `tags`), the common pattern `jsonb(...).notNull().default([])` is correct because the empty array is the expected default and there's no distinction between "empty" and "unknown". This nullable exception applies **only** to derived columns where "empty" vs. "unknown" is a meaningful safety distinction.

## Related Files

- `shared/constants/allergens.ts` — `isRecipeSafeForAllergies()` function
- `shared/schema.ts` — `communityRecipes`, `mealPlanRecipes` allergens column definitions
- `migrations/0004_recipe_allergens_nullable.sql` — migration that applies the nullable change

## See Also

- `docs/rules/database.md` — "Always pair `.default([])` with `.notNull()`" applies to non-safety array columns; this file is the safety-column exception.
- [Drizzle SQL type hint is not a runtime coercion](./drizzle-sql-type-hint-not-runtime-coercion-2026-05-13.md)
- [drizzle-zod loses the type hint on nullable jsonb columns](../code-quality/drizzle-zod-nullable-jsonb-loses-type-hint-2026-05-17.md)
