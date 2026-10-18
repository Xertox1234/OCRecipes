---
title: "Spice level icon for recipes (mild / medium / hot)"
status: backlog
priority: medium
created: 2026-10-17
updated: 2026-10-17
assignee:
labels: [feature, react-native, database]
github_issue:
---

# Spice level icon for recipes (mild / medium / hot)

## Summary

Add a checked spice-level attribute icon (mild, medium, hot) to the recipe attribute row that already shows the diet, Quick and "Contains:" icons.

## Background

This is the followup the owner split out of the recipe attribute icons work on 2026-10-17 ("Icons now, spice next"). See `docs/superpowers/specs/2026-10-17-recipe-attribute-icons-design.md` → Followup. Diet, Quick and allergen icons shipped first. Spice needs a new derived fact on each recipe, because no recipe column holds it today.

## Acceptance Criteria

- [ ] A short design decides how spice is worked out per recipe: a keyword list over ingredient names, or the AI at generation time. The owner picks.
- [ ] A nullable saved `spice_level` (`mild` / `medium` / `hot`, reusing `spiceLevelSchema` from `shared/schemas/recipe-finder.ts`) on `community_recipes` and `meal_plan_recipes`, via a new additive migration applied to prod before merge.
- [ ] It is written at the same storage write points as `diet_conflicts`. `null` means "not worked out" and shows no icon.
- [ ] The backfill (`server/scripts/backfill-recipe-allergens.ts`) fills it for existing rows.
- [ ] `spice_*` attributes in `RECIPE_ATTRIBUTE_LABELS` and `RECIPE_ATTRIBUTE_VISUALS`, using `chili-mild`, `chili-medium` and `chili-hot` (all three exist in the MaterialCommunityIcons glyph map, checked 2026-10-17).
- [ ] Tests: the derivation, `null` → no icon, the glyph-map check, and contrast coverage.

## Implementation Notes

- `shared/constants/recipe-attributes.ts` (add the attribute ids and labels; keep the one-rule `getRecipeAttributes`)
- `client/components/recipe-attribute-visuals.ts` (icons and colour)
- `server/scripts/backfill-recipe-allergens.ts` (third derived cache)
- The write points listed in `docs/superpowers/specs/2026-10-17-recipe-attribute-icons-design.md`: `server/storage/community-recipes.ts`, `server/storage/meal-plan-recipes-crud.ts`, `server/storage/recipe-from-chat.ts`
- A new migration in `migrations/`
- The feeds already carry the facts through `CarouselRecipeCard`, `ResolvedFavouriteRecipe` and `SearchableRecipe`; add the field to each one in the same way as `dietConflicts`.

## Dependencies

- The recipe attribute icons PR (diet/quick/allergen icons) is merged and migration 0028 is on prod.

## Risks

- A keyword list over-reads mild uses ("a pinch of chili flakes"), and AI-set levels drift between generations. The design step should say which error is worse.

## Updates

### 2026-10-17

- Filed as the owner-chosen followup of the recipe attribute icons work.
