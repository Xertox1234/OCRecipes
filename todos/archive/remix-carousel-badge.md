---
title: "Add remix badge to CarouselRecipeCard"
status: backlog
priority: low
created: 2026-04-08
updated: 2026-04-08
assignee:
labels: [remix, ui]
---

# Add remix badge to CarouselRecipeCard

## Summary

The HomeRecipeCard shows a shuffle icon badge for remixed recipes, but the CarouselRecipeCard does not — its lightweight `CarouselRecipeCard` type lacks `remixedFromId`.

## Background

During the Recipe Remix feature (PR #35), remix badges were added to `HomeRecipeCard` which uses the full `CommunityRecipe` schema type. The `CarouselRecipeCard` type in `shared/types/carousel.ts` is a lightweight projection (`id`, `title`, `imageUrl`, `prepTimeMinutes`, `recommendationReason`) that doesn't include lineage fields. Adding the badge requires expanding this type and the carousel builder service.

## Acceptance Criteria

- [ ] `CarouselRecipeCard` type in `shared/types/carousel.ts` includes `isRemix: boolean` field
- [ ] `server/services/carousel-builder.ts` populates `isRemix` from `communityRecipes.remixedFromId`
- [ ] `client/components/home/CarouselRecipeCard.tsx` renders shuffle icon badge when `isRemix` is true
- [ ] Badge matches HomeRecipeCard style (22px circle, top-left, `theme.link` background)

## Implementation Notes

- `shared/types/carousel.ts`: Add `isRemix?: boolean` to `CarouselRecipeCard`
- `server/services/carousel-builder.ts`: Set `isRemix: !!recipe.remixedFromId` in the mapping
- `client/components/home/CarouselRecipeCard.tsx`: Render badge conditionally, import `Ionicons`

## Dependencies

- Recipe Remix feature must be merged (PR #35)

## Updates

### 2026-04-08

- Created as deferred item from Recipe Remix code review
