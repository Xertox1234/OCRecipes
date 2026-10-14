---
title: "Recipes from 'Make this mine' and private AI generation can't be found again — add 'My recipes'"
status: backlog
priority: high
created: 2026-10-14
updated: 2026-10-14
assignee:
labels: [react-native, api]
github_issue:
---

# Recipes from "Make this mine" and private AI generation can't be found again

## Summary

The owner asked on 2026-10-14: "I choose make it mine where can I find it later?" Today, nowhere, unless they favourite the recipe or add it to a cookbook. Add a "My recipes" view that lists the user's own community recipes, private ones included. The owner chose this to be a small, separate fix.

## Background

- "Make this mine" (`server/routes/inspired-recipes.ts`) and premium generation (`POST /api/recipes/generate`, unless shared) both save a **private** `community_recipes` row (`isPublic: false`, `authorId` = the user).
- The Recipe Browser (`GET /api/recipes/browse` → `getUnifiedRecipes` in `server/storage/meal-plan-recipes-browse.ts`) lists only `isPublic = true` community recipes plus the user's `meal_plan_recipes`.
- Search (`server/services/recipe-search.ts`) loads only `storage.getAllPublicCommunityRecipes()`.
- `GET /api/recipes/mine` (`server/routes/recipes.ts`, `storage.getUserRecipes`) already returns the user's own recipes, but no client code calls it.
- Workaround until then: tap the heart on the recipe right after making it, and it shows in Favourites.

## Acceptance Criteria

- [ ] The user can open a "My recipes" list (recommended: a section or filter in the Recipe Browser) that shows their own recipes, private included, newest first.
- [ ] A recipe just made via "Make this mine" shows up there without restarting the app: invalidate the list's query in `useMakeSuggestion` onSuccess (`client/hooks/useInspiredSuggestions.ts`) and after premium generation.
- [ ] Tapping one opens `FeaturedRecipeDetailScreen` (community type).
- [ ] Other users' private recipes never appear: owner-scoped server query; add a route test.
- [ ] Check what `getUserRecipes` returns (fields, order, any cap) and whether `/api/recipes/mine` needs a response schema or pagination.

## Implementation Notes

- `server/routes/recipes.ts` (`/api/recipes/mine`), `server/storage/community-recipes.ts` (`getUserRecipes`)
- `client/screens/meal-plan/RecipeBrowserScreen.tsx`, or a Profile entry; decide in a short in-chat design.
- `client/hooks/useInspiredSuggestions.ts`, `client/components/RecipeGenerationModal.tsx`
