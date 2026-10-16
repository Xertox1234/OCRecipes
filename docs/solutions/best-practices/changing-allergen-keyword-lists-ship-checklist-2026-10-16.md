---
title: "Changing the shared allergen keyword lists is not done at merge — OTA the client, backfill the stored recipe allergens on prod, then restart only if a cached row changed"
track: knowledge
category: best-practices
module: shared
tags: [architecture, typescript, allergens, nutrition, safety, database]
applies_to: [shared/constants/allergens.ts, server/scripts/backfill-recipe-allergens.ts, server/services/recipe-search.ts]
created: 2026-10-16
---

# Changing the shared allergen keyword lists is not done at merge

## When this applies

Any change to `ALLERGEN_INGREDIENT_MAP`, `SUBSTITUTE_MODIFIERS` or the matching rules in `shared/constants/allergens.ts` that changes **which ingredients map to which allergen**. Examples: oats became a wheat/gluten risk (#1465), and plural keywords were added (2026-07-21).

## Rule

A merge plus Railway's auto-deploy updates only the server's **live** checks. Three other copies of the old answer survive it. Work through them in order:

1. **Client: publish an OTA.** Client screens import the module directly: `AllergenBadge`, `AllergenWarningBanner`, `RecipeAllergenLabel`, `RecipeIngredientsList`, `remix-chips`, and others. Phones keep the old lists until an OTA lands. Pull `main` into the main checkout first, because the OTA bundles the local tree.
2. **Stored recipe allergens: backfill prod.** `community_recipes.allergens` and `meal_plan_recipes.allergens` are a denormalized cache, written only on save. "Safe for me" search reads that cache (`isRecipeSafeForAllergies`), so an old recipe keeps its old verdict until it is recomputed. From the laptop, with auto mode OFF:
   ```
   ALLOW_OUTWARD_CLI=1 railway run --service Postgres --environment production -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" DRY_RUN=1 npx tsx server/scripts/backfill-recipe-allergens.ts'
   ALLOW_OUTWARD_CLI=1 railway run --service Postgres --environment production -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx server/scripts/backfill-recipe-allergens.ts'
   ```
   Use the **Postgres** service's `DATABASE_PUBLIC_URL`. The app service's `DATABASE_URL` is `postgres.railway.internal`, which fails with `ENOTFOUND` off-network. The script re-derives every row, so a re-run is harmless.
3. **Search index: restart, but only if a cached row changed.** `initSearchIndex` (`server/services/recipe-search.ts`) snapshots recipes, including `allergens`, once at boot. First query whether any row actually contains the new keyword. Include a control term that must match, so a zero means something.

## Why

On 2026-10-16 the oats change was merged and deployed, yet "Safe for me" would still have passed an oat recipe saved earlier for a severe-gluten user, and the phone app would still have shown no warning. The keyword list is one source of truth with three downstream copies: the client bundle, the DB cache and the boot-time index.

## Examples

- #1465 (oats): OTA `2edd4c87`, then the backfill rewrote 31 community and 0 meal-plan rows. Prod held 0 oat recipes (control: 8 wheat rows read correctly), so the restart was skipped.

## Exceptions

- A change that only **removes** false positives still needs steps 1–2. A stale cache over-flags, which hides safe recipes from "Safe for me".
- Comment-only or test-only edits to `allergens.ts` need none of this.

## Related Files

- `shared/constants/allergens.ts`: `ALLERGEN_INGREDIENT_MAP`, `deriveRecipeAllergens`, `isRecipeSafeForAllergies`
- `server/scripts/backfill-recipe-allergens.ts`
- `server/services/recipe-search.ts`: `initSearchIndex`

## See Also

- [allergen-keyword-matcher-singular-only-plural-under-detection](../logic-errors/allergen-keyword-matcher-singular-only-plural-under-detection-2026-07-21.md) — an earlier keyword change of exactly this kind
- [ai-announcing-allergen-free-trips-fail-closed-filter-empties-result](../logic-errors/ai-announcing-allergen-free-trips-fail-closed-filter-empties-result-2026-10-16.md) — same session; the AI-side counterpart
