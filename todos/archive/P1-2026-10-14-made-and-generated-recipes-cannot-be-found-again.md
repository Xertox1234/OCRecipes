---
title: "Recipes from 'Make this mine' and premium generation can't be found again — add them to Saved items"
status: done
priority: high
created: 2026-10-14
updated: 2026-10-14
assignee:
labels: [react-native, api]
github_issue:
---

# Recipes from "Make this mine" and premium generation can't be found again

## Summary

The owner asked on 2026-10-14: "I choose make it mine where can I find it later?" They looked in Profile → Saved items, and it wasn't there. Re-planned with the owner (2026-10-14) from a new "My recipes" view to: made and generated recipes are added to **Saved items** automatically.

## Background

- "Make this mine" (`server/routes/inspired-recipes.ts`) and premium generation (`POST /api/recipes/generate`) save a `community_recipes` row, private unless shared.
- Saved items (`saved_items`) only filled on an explicit Save (scan, chat). Chat's Save already links a recipe through `storage.saveRecipeToSavedItems`, which is idempotent per (user, recipeType, recipeId) and capped by `maxSavedItems` (premium: unlimited; both flows are premium-only).
- Browse and search stay public-only. `GET /api/recipes/mine` still has no client caller (unchanged).

## Acceptance Criteria

- [x] A newly made recipe gets a linked Saved items row (`addMadeRecipeToSavedItems`, `server/routes/_recipe-saved-items.ts`).
- [x] Tapping an already-made card adds its recipe too, which backfills recipes made before this; skipped if the recipe was deleted.
- [x] A generated recipe gets a linked Saved items row.
- [x] A Saved items failure is logged and never fails the make or generate.
- [x] The row is written before the response, and the client invalidates `/api/saved-items` and `/api/saved-items/count` (`useMakeSuggestion`, `RecipeGenerationModal`).
