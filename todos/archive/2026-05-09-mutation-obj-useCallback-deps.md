---
title: "Destructure mutation .mutate before useCallback deps (RecipeCarousel, NotebookScreen)"
status: done
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, performance, audit-2026-05-09]
---

# Destructure mutation .mutate before useCallback deps

## Summary

`RecipeCarousel.handleDismiss` and `NotebookScreen.handleArchive`/`handleDelete` list entire TanStack Query mutation objects as `useCallback` deps — mutation object references change every render, defeating memoization.

## Background

Identified in the 2026-05-09 full audit (M2) by the performance-specialist agent. The fix is the established project pattern: destructure `mutate` from each hook before the callback.

## Acceptance Criteria

- [ ] `RecipeCarousel.tsx:32,56–61` — destructure `const { mutate: dismissRecipe } = useDismissCarouselRecipe()`; use `dismissRecipe` in `handleDismiss` deps
- [ ] `NotebookScreen.tsx:65–66,68–93` — destructure `mutate` from `updateEntry` and `deleteEntry` hooks; update `handleArchive` and `handleDelete` deps
- [ ] All existing tests pass

## Implementation Notes

`toggleFavourite` in `RecipeCarousel.tsx` already correctly destructures `.mutate` — use that as the reference pattern.
