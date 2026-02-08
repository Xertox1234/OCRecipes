---
title: "Document saved items and community recipes in project docs"
status: backlog
priority: low
created: 2026-02-08
updated: 2026-02-08
assignee:
labels: [documentation, saved-items, community-recipes]
---

# Document Saved Items and Community Recipes

## Summary

The saved items and community recipes features are undocumented. Explore and add documentation.

## Background

Users can save recipes/activities from AI suggestions, and premium users can share recipes with the community. Neither feature is documented.

## Acceptance Criteria

- [ ] Document savedItems table in DATABASE.md
- [ ] Document communityRecipes table in DATABASE.md
- [ ] Document SavedItemsScreen in FRONTEND.md
- [ ] Document CommunityRecipesSection component in FRONTEND.md
- [ ] Document /api/saved-items/\* endpoints in API.md
- [ ] Document /api/recipes/community and /api/recipes/generate endpoints in API.md

## Implementation Notes

Key files to explore:

- `client/screens/SavedItemsScreen.tsx`
- `client/components/CommunityRecipesSection.tsx`
- `client/hooks/useSavedItems.ts`
- `server/routes.ts` — search for /api/saved-items and /api/recipes endpoints
- `server/services/recipe-generation.ts`
- `shared/schema.ts` — savedItems, communityRecipes tables
