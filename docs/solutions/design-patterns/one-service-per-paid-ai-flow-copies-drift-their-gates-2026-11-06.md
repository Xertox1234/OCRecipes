---
title: A paid AI flow (premium gate → claim-first cap → paid call) lives in one service — an inline copy drifts its gate
track: knowledge
category: design-patterns
module: server
severity: medium
tags: [architecture, premium-gating, daily-cap, fire-and-forget, duplication, ai-cost]
applies_to: [server/routes/**/*.ts, server/services/**/*.ts]
created: '2026-11-06'
---

# A paid AI flow lives in one service; an inline copy drifts its gate

## Rule

Any flow that spends money on an AI call has three steps: check the premium feature, claim the DB daily cap, then make the paid call. Each such flow lives in exactly one service function, and routes call it, usually via `fireAndForget`. A route never inlines its own copy of the steps.

Before extracting or editing one, grep for the cap key (for example `"recipeAutoImage"`) across `server/routes`. A second copy is the thing to find.

## Why

The 2026-11-06 architecture audit (M6c) found the recipe auto-image flow in two places:
- `meal-plan.ts` `fireRecipeImageGen` checked `recipeAutoImages`, claimed the cap, and generated.
- `recipe-import.ts` had its own copy that skipped the `recipeAutoImages` check. It relied on the route's `urlImport` premium gate.

Every tier sets both flags the same way, so nothing leaked. But the moment a tier gets `urlImport` without `recipeAutoImages`, free users on that path make paid image calls, and no test notices, because each copy is tested only through its own route.

## Examples

`server/services/recipe-auto-image.ts` `autoGenerateRecipeImage(recipe, userId)` is the single owner. It runs `storage.getEffectiveTierForUser` (expiry-aware, never the raw stored tier), then `TIER_FEATURES[tier].recipeAutoImages`, then `claimDailyAiCall` *before* `generateRecipeImage`, then `updateMealPlanRecipe(recipe.id, userId, …)`. Both routes now call `fireAndForget("recipe-image-gen", autoGenerateRecipeImage(recipe, req.userId))`.

## Related Files

- `server/services/recipe-auto-image.ts`, `server/services/__tests__/recipe-auto-image.test.ts`
- `server/routes/meal-plan.ts`, `server/routes/recipe-import.ts`

## See Also

- `docs/rules/security.md`: premium gating via `getEffectiveTierForUser`
