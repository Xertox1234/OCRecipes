---
title: "Performance and memoization issues from 2026-04-26 audit"
status: in-progress
priority: medium
created: 2026-04-26
updated: 2026-04-26
labels: [performance, react-native, database, audit-2026-04-26]
audit_ids: [M4, M5, M6, M7, L1, L2, L3, L4, L5, L6, L7, L8]
---

# Performance and memoization issues from 2026-04-26 audit

## Summary

Twelve performance issues: server-side DB over-fetching (M7), React Native FlatList/SectionList missing virtualization defaults (M5, M6), and memoization gaps in recently modified and existing components (M4, L1–L8).

## Findings (cross-ref `docs/audits/2026-04-26-full.md`)

### Server-side

- **M7** — `getRecentCommunityRecipes` (carousel) and `getFeaturedRecipes` (recipe browser) use `SELECT *` — fetches the full `communityRecipes` row including `instructions` JSONB (can be KB per row) for endpoints that only need 9 display columns. `getAllPublicCommunityRecipes` in the same file already column-projects as the established pattern. `server/storage/carousel.ts:81`, `server/storage/community.ts:241–243`

### FlatList / SectionList virtualization

- **M5** — `ReceiptReviewScreen` FlatList missing `FLATLIST_DEFAULTS` (`removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize`). `ItemSeparatorComponent` is an inline arrow function that creates a new reference and calls `withOpacity` on every render. `client/screens/ReceiptReviewScreen.tsx:369–377`
- **M6** — `PantryScreen` `SectionList` missing virtualization props. `FLATLIST_DEFAULTS` not imported. `client/screens/meal-plan/PantryScreen.tsx:258`

### Component memoization

- **M4** — `RecipeGenerationModal`: `accentBg = withOpacity(theme.link, 0.12)` and `accentColor = theme.link` re-derived on every render. ~15 conditional style objects (`backgroundColor: servings === option ? accentBg : theme.backgroundSecondary`) are new references on every render. Wrap `accentBg` in `useMemo([theme.link])` and extract conditional styles to `useMemo` or `StyleSheet`. `client/components/RecipeGenerationModal.tsx:61–62`
- **L1** — `withOpacity(theme.error, 0.9)` and `withOpacity(theme.link, 0.9)` called in render body in `HomeRecipeCard`. Both inputs stable — wrap in `useMemo`. `client/components/HomeRecipeCard.tsx:91,110`
- **L2** — `FadeInDown.delay(index * 50).duration(400)` re-created every render in `HomeRecipeCard`. Inputs `index` and `reducedMotion` are stable — wrap in `useMemo`. `client/components/HomeRecipeCard.tsx:47–49`
- **L3** — `fallbackStyle={{ backgroundColor: theme.backgroundSecondary }}` inline object in `HomeRecipeCard` render — new reference each render defeats `FallbackImage`'s memoization. `client/components/HomeRecipeCard.tsx:64–66`
- **L4** — `handleGenerate` in `RecipeGenerationModal` is a plain arrow function — only handler in the modal not wrapped in `useCallback`. Inconsistent with `toggleDiet`, `handleClose`. `client/components/RecipeGenerationModal.tsx:115`
- **L5** — `foods.map((f) => f.name).join(", ")` recomputed every render. `foods` prop is stable. Wrap in `useMemo([foods])`. `client/components/RecipeGenerationModal.tsx:218`
- **L6** — `ListFooterComponent` is inline JSX (not memoized) in `InstructionsStep`. New element reference on every render; `withOpacity` calls inside. Wrap in `useMemo` or extract to `React.memo` component. `client/components/recipe-wizard/InstructionsStep.tsx:212–228`
- **L7** — `SuggestionCard` and `PopularPickCard` in `MealSuggestionsModal` are plain functions rendered in a `.map()`. Re-render on every parent state change even when suggestion data hasn't changed. Wrap both in `React.memo`. `client/components/MealSuggestionsModal.tsx:55,134`
- **L8** — `mealLabel` string derived from stable `mealType` prop recomputed every render. `useMemo([mealType])`. `client/components/MealSuggestionsModal.tsx:301`

## Acceptance Criteria

- [ ] `getRecentCommunityRecipes` and `getFeaturedRecipes` project only needed columns (exclude `instructions`)
- [ ] `ReceiptReviewScreen` FlatList spreads `FLATLIST_DEFAULTS`; `ItemSeparatorComponent` extracted to stable component
- [ ] `PantryScreen` `SectionList` spreads `FLATLIST_DEFAULTS`
- [ ] `accentBg`/`accentColor` in `RecipeGenerationModal` wrapped in `useMemo`
- [ ] `HomeRecipeCard` render-body `withOpacity` calls, animation builder, and `fallbackStyle` object memoized
- [ ] `handleGenerate` wrapped in `useCallback` in `RecipeGenerationModal`
- [ ] `foods.map().join()`, `ListFooterComponent`, `SuggestionCard`, `PopularPickCard`, `mealLabel` memoized
- [ ] All existing tests pass

## Implementation Notes

- M7 (column projection): model `getRecentCommunityRecipes` on `getAllPublicCommunityRecipes` in the same file.
- M5/M6: import `FLATLIST_DEFAULTS` from `@/constants/flatlist` (or wherever the project defines it) — check current import path with grep.
- L2 (`FadeInDown`): `useMemo` on `FadeInDown.delay(index * 50).duration(400)` with `[reducedMotion, index]` deps.
