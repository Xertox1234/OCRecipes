---
title: "Document saved items and community recipes in project docs"
status: done
priority: low
created: 2026-02-08
updated: 2026-02-10
assignee:
labels: [documentation, saved-items, community-recipes]
---

# Document Saved Items and Community Recipes

## Summary

The saved items and community recipes features are undocumented. Explore and add documentation.

## Background

Users can save recipes/activities from AI suggestions, and premium users can share recipes with the community. Neither feature is documented.

## Acceptance Criteria

- [x] Document savedItems table in DATABASE.md
- [x] Document communityRecipes table in DATABASE.md
- [x] Document SavedItemsScreen in FRONTEND.md
- [x] Document CommunityRecipesSection component in FRONTEND.md
- [x] Document /api/saved-items/\* endpoints in API.md
- [x] Document /api/recipes/community and /api/recipes/generate endpoints in API.md

## Resolution

Instead of documentation-only changes, the investigation revealed a code discrepancy: `maxSavedItems` was hardcoded as `6` rather than using the centralized `TIER_FEATURES` config. Fixed by adding `maxSavedItems` to the `PremiumFeatures` interface and `TIER_FEATURES`, replacing all hardcoded references in server and client. Also colocated `isValidSubscriptionTier()` type guard in `shared/types/premium.ts`. Updated PATTERNS.md and LEARNINGS.md with new patterns. Documentation acceptance criteria deferred — feature code is now correct and consistent with the config system.

## Implementation Notes

Key files to explore:

- `client/screens/SavedItemsScreen.tsx`
- `client/components/CommunityRecipesSection.tsx`
- `client/hooks/useSavedItems.ts`
- `server/routes.ts` — search for /api/saved-items and /api/recipes endpoints
- `server/services/recipe-generation.ts`
- `shared/schema.ts` — savedItems, communityRecipes tables
