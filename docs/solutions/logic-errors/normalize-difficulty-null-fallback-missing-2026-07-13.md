---
title: 'normalizeDifficulty returns null for an unmapped value — every call site must add its own `?? raw` fallback'
track: bug
category: logic-errors
module: server
severity: medium
tags: [recipes, normalization, drizzle, data-integrity, code-review]
symptoms: [A recipe with a difficulty string outside the fixed Easy/Medium/Hard vocabulary (e.g. legacy chat metadata, a remix carrying forward an off-vocabulary value) is stored with difficulty null instead of the original string, A difficulty badge silently disappears from a UI card for an otherwise-normal recipe with no error or log line, Two sibling storage functions normalize the same fields but only one applies a raw-value fallback for difficulty]
applies_to: [server/storage/**/*.ts]
created: '2026-07-13'
---

# normalizeDifficulty returns null for an unmapped value — every call site must add its own `?? raw` fallback

## Problem

`normalizeDifficulty` (`server/lib/recipe-normalization.ts`) maps only a fixed vocabulary (`easy`/`simple`/`beginner` → `Easy`, etc. — 10 synonyms total) to `"Easy"|"Medium"|"Hard"` and returns `null` for anything else, **by design** — the pure function's own test is named `"returns null difficulty for an unknown value (caller applies fallback)"` (`server/lib/__tests__/recipe-normalization.test.ts`). `normalizeRecipeFields` passes that `null` straight through. Two storage call sites — `createRecipeWithLimitCheck` (`server/storage/community-recipes.ts`) and `saveRecipeFromChat` (`server/storage/recipe-from-chat.ts`) — stored `normalized.difficulty` directly with no fallback, unlike the sibling `title`/`instructions`/`ingredients` fields in the same object literals, which all restore the raw value (`normalized.title ?? data.title`, etc). PR #613 copied the incomplete pattern from the reference implementation into a second call site rather than introducing it.

## Symptoms

- A recipe saved with a non-canonical difficulty (legacy data, remix carryover, any future producer not routed through the enum-constrained AI generation services) loses that value on save — `difficulty` becomes `null`.
- Every UI surface that renders difficulty (`RecipeMetaChips`, `MealSuggestionsModal`, `SavedItemCard`, `CookbookDetailScreen`, `FavouriteRecipesScreen`) gates on truthiness, so the badge just vanishes with no error surfaced anywhere.
- Code review across 8 independent angles on PR #613 flagged the exact same gap 4 times independently — a strong signal the drift is easy to reintroduce and easy to miss in a single-angle review.

## Root Cause

A single shared normalization helper (`normalizeRecipeFields`) intentionally leaves the post-normalization fallback policy to each caller (see its own doc comment: "Callers retain their own post-normalization fallback policy... the helper centralizes the normalization, not the per-caller fallback"). That is correct for fields where "no value" and "normalize to null" are the same case (e.g. `description`), but for `difficulty` it conflates two different cases — "no value provided" and "a real value outside the known vocabulary" — under the same `null`. Because there is no single choke point enforcing the fallback, each call site independently has to remember to add it, and at least one still doesn't.

## Solution

Add `difficulty: normalized.difficulty ?? <raw value>,` at every call site that spreads `normalizeRecipeFields`'s `difficulty` output into an insert/update payload, exactly matching the fallback shape already used for `title`/`instructions`/`ingredients` in the same object literal:

```typescript
// ❌ BAD — silently discards an unmapped difficulty
difficulty: normalized.difficulty,

// ✅ GOOD — matches the title/instructions/ingredients fallback pattern
difficulty: normalized.difficulty ?? data.difficulty,
```

`communityRecipes.difficulty` (and the analogous `mealPlanRecipes`/`recipeIngredients`-adjacent columns) are plain `text(...)` with no enum/CHECK constraint (`shared/schema.ts`), so storing an arbitrary string is safe at the DB layer — the fallback is purely a data-preservation choice, not a validation concern.

## Prevention

`normalizeDifficulty` does **not** restore the raw string itself, and there is no lint rule or type constraint that forces a caller to add the `?? raw` fallback — grep is the only guard. Before declaring a `normalizeRecipeFields`/`normalized.difficulty` fix complete, check every consumer:

```bash
grep -rn "normalizeRecipeFields\|normalized\.difficulty" server/ --include="*.ts" | grep -v __tests__
```

As of 2026-07-13 this turned up a **third, still-unfixed** call site — `server/storage/meal-plan-recipes-crud.ts` (`createMealPlanRecipe` at the `difficulty: normalized.difficulty,` line, and `updateMealPlanRecipe`'s `{ ...updates, ...normalized }` spread, which lets a possibly-`null` `normalized.difficulty` silently overwrite a raw `updates.difficulty` string). It was deliberately left out of the fix that produced this file — the originating todo scoped the fix to exactly two named call sites — but it has the identical gap and is reachable via a free-text, non-enum-constrained schema (`createMealPlanRecipeSchema.difficulty` in `server/routes/meal-plan.ts`). Check it first if touching this area again. See also the general lesson in [Fix One Protocol Handler, Grep All Consumers](./protocol-handler-bug-fix-all-consumers-2026-05-13.md): patching a shared-pattern bug in only the flagged consumers, without grepping for the rest, reliably leaves a sibling copy broken.

## Related Files

- `server/lib/recipe-normalization.ts` — `normalizeDifficulty`, `normalizeRecipeFields`
- `server/storage/community-recipes.ts` — `createRecipeWithLimitCheck` (fixed)
- `server/storage/recipe-from-chat.ts` — `saveRecipeFromChat` (fixed)
- `server/storage/meal-plan-recipes-crud.ts` — `createMealPlanRecipe`, `updateMealPlanRecipe` (NOT fixed — same gap still open)
- `server/lib/__tests__/recipe-normalization.test.ts` — documents the "caller applies fallback" design intent
- `shared/schema.ts` — `communityRecipes.difficulty` (`text`, unconstrained)

## See Also

- [Fix One Protocol Handler, Grep All Consumers](./protocol-handler-bug-fix-all-consumers-2026-05-13.md)
- [Free-text/AI-generated quantities into a nullable decimal column need null-coercion](../conventions/decimal-quantity-column-requires-null-coercion-2026-07-13.md)
