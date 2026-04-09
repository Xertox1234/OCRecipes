---
title: "Fix cascading re-renders from useIsRecipeFavourited in list items"
status: backlog
priority: medium
created: 2026-04-09
updated: 2026-04-09
assignee:
labels: [performance, audit-9]
---

# Fix cascading re-renders from useIsRecipeFavourited in list items

## Summary

`useIsRecipeFavourited` is called inside `React.memo` list items (RecipeBrowserScreen, CarouselRecipeCard, RecipeActionBar), causing N re-renders on any favourite toggle because the internal TanStack Query subscription bypasses memo's prop comparison.

## Background

Audit #9 findings M4 + L3. When any favourite is toggled, `onSettled` invalidates `FAVOURITES_IDS_KEY`, causing every component subscribed via `useFavouriteRecipeIds()` to re-render. The `useMemo` inside each `useIsRecipeFavourited` recomputes because the `data` reference changes, even though most cards' boolean result doesn't change.

## Acceptance Criteria

- [ ] Lift favourite state lookup to parent components
- [ ] Pass `isFavourited` as a prop to `UnifiedRecipeCard`, `CarouselRecipeCard`, `RecipeActionBar`
- [ ] Single `useFavouriteRecipeIds()` call in each parent, derived per-item via prop
- [ ] React.memo correctly prevents re-renders for items whose favourite state didn't change
- [ ] No regressions in existing favourite toggle behavior

## Implementation Notes

- RecipeBrowserScreen: parent calls `useFavouriteRecipeIds()`, passes `isFavourited` to `UnifiedRecipeCard`
- CarouselRecipeCard: parent (HomeScreen carousel) passes `isFavourited` prop
- RecipeActionBar: receives `isFavourited` as prop (callers must provide it)
- May need to also lift `useToggleFavouriteRecipe` to parent for consistent callback memoization
