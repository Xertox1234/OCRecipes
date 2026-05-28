---
title: "HomeScreen content sections silently vanish on query failure"
status: done
priority: medium
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [react-native, client-state, error-handling]
github_issue:
---

# HomeScreen content sections silently vanish on query failure

## Summary

On Home query failures the calorie summary blanks and the recipe carousels return `null`, so the screen looks like a sparse/empty home rather than an error — with no retry affordance anywhere.

## Background

Surfaced during a silent-failure investigation (unsolicited user report: "works except when it doesn't, and when it doesn't it fails quietly"). Home is the default landing tab, so this is a high-visibility surface. Structural root: no global query error net (`client/lib/query-client.ts:124`).

## Acceptance Criteria

- [ ] Budget failure on Home shows an error/retry affordance rather than an empty calorie string.
- [ ] `RecipeCarousel` / `CuratedRecipeCarousel` distinguish "no data" from "fetch failed" (surface a retry on failure).
- [ ] `DiscoveryCarousel` checked and handled for the same pattern.

## Implementation Notes

- `client/screens/HomeScreen.tsx:75` reads `budget` without `error`; lines 127-129 → `calorieText = ""` on failure.
- `client/components/home/DailySummaryHeader.tsx:63-89` renders `null` when `budget` is missing (`isLoading ? skeleton : budget ? <summary> : null`).
- `client/components/home/RecipeCarousel.tsx:31` (`{ data, isLoading }`, no error) and lines 108-110 (`if (cards.length === 0) return null`).
- `client/components/home/CuratedRecipeCarousel.tsx:138-140` — same `return null` pattern.
- `client/components/home/DiscoveryCarousel.tsx` (rendered at `HomeScreen.tsx:179`) — verify and fix the same pattern.
- Check whether `useCarouselRecipes` / `useCuratedRecipes` expose `error`; read it at the component.

## Dependencies

- A global `QueryCache.onError` net would cover this app-wide (see sibling todos), but per-section retry is still worth having.

## Risks

- Empty carousels can be legitimate (user dismissed all cards) — differentiate genuine-empty from error-empty so a valid empty state isn't mislabeled as a failure.

## Updates

### 2026-05-28

- Initial creation. Finding verified by reading HomeScreen + the three home components.
