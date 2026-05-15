---
title: "Move share endpoint from favourite-recipes to recipes route module"
status: in-progress
priority: low
created: 2026-04-09
updated: 2026-04-09
assignee:
labels: [architecture, audit-9]
---

# Move share endpoint from favourite-recipes to recipes route module

## Summary

The `GET /api/recipes/:recipeType/:recipeId/share` endpoint is registered in `favourite-recipes.ts` but serves the `/api/recipes/` URL namespace owned by `recipes.ts`. Move it for consistency.

## Background

Audit #9 finding M7. Splitting the same URL namespace across two route modules makes it harder to reason about routing and increases the risk of future path conflicts.

## Acceptance Criteria

- [ ] Move `GET /api/recipes/:recipeType/:recipeId/share` handler to `server/routes/recipes.ts`
- [ ] Move `getRecipeSharePayload` storage function from `favourite-recipes.ts` to appropriate module
- [ ] Update storage facade re-exports if needed
- [ ] Update test files to match new locations
- [ ] Verify no route conflicts
