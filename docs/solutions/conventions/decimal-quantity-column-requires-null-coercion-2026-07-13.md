---
title: Free-text/AI-generated quantities into a nullable decimal column need null-coercion, not a raw insert
track: knowledge
category: conventions
module: server
tags: [database, drizzle, validation, recipes, ai-generation]
applies_to: [server/storage/**/*.ts]
created: '2026-07-13'
---

# Free-text/AI-generated quantities into a nullable decimal column need null-coercion, not a raw insert

## Rule

Any storage-layer write path that inserts a free-text or AI-generated quantity string into a nullable Postgres `decimal` column (e.g. `recipeIngredients.quantity`, `decimal(10,2)`) must first normalize the string via `normalizeIngredient` (`server/lib/recipe-normalization.ts`), then gate the normalized result through a `DECIMAL_QUANTITY_RE`-style check that bounds both format AND magnitude (`/^\d{1,8}(\.\d+)?$/` — the digit cap must match the column's integer-part precision: `decimal(p, s)` allows `p - s` integer digits, so `decimal(10,2)` allows 8), coercing to `null` when it doesn't match. Never insert a raw quantity string into a decimal column.

```typescript
// ❌ BAD: raw quantity string reaches the decimal column
await tx.insert(recipeIngredients).values(
  ingredients.map((ing) => ({ ...ing, recipeId })),
);

// ✅ GOOD: normalize, then null-coerce anything that still isn't a clean, in-range decimal
const DECIMAL_QUANTITY_RE = /^\d{1,8}(\.\d+)?$/;
const normalized = ingredients.map((ing) => {
  const n = normalizeIngredient({ name: ing.name, quantity: ing.quantity ?? "", unit: ing.unit ?? "" });
  return {
    ...ing,
    name: n.name,
    unit: n.unit,
    quantity: DECIMAL_QUANTITY_RE.test(n.quantity) ? n.quantity : null,
  };
});
await tx.insert(recipeIngredients).values(
  normalized.map((ing) => ({ ...ing, recipeId })),
);
```

## Why

Postgres `decimal` columns reject any non-numeric string outright — there is no silent coercion, and the write throws `invalid input syntax for type numeric` (or, for an over-magnitude value, `numeric field overflow`). A permissive Zod schema at the route layer (`z.coerce.string().optional().nullable()`) only enforces "this is a string," not "this is numeric," so schema validation does not protect the column. AI-generation prompts (e.g. `generateMealPlanFromPantry` in `server/services/pantry-meal-plan.ts`) do not constrain quantity format either — the prompt just asks for `ingredients (name, quantity, unit)` — so a GPT-4o-class model is free to emit fraction-formatted quantities (`"1/2"`, `"½"`) that reach the storage layer unvalidated. This bug class has now hit the same `recipeIngredients.quantity` column via two independent write paths.

## Exceptions

A column that is JSONB (e.g. `communityRecipes.ingredients`) or `text` has no such constraint — free-text quantities are safe there and need no coercion. Only a numeric-typed column (`decimal`, `integer`, etc.) needs this treatment.

## Related Files

- `server/storage/meal-plan-recipes-crud.ts` — `createMealPlanRecipe` (original fix) and `createMealPlanFromSuggestions` (second call site, fixed identically)
- `server/lib/recipe-normalization.ts` — `normalizeIngredient`, `normalizeQuantityToDecimal`
- `shared/schema.ts` — `recipeIngredients.quantity` (`decimal(10,2)`)
- `server/routes/meal-plan.ts` — `POST /api/meal-plan/save-generated` request schema (no format constraint on `quantity`)
- `server/services/pantry-meal-plan.ts` — AI generation prompt that produces unconstrained quantity strings

## See Also

(none)
