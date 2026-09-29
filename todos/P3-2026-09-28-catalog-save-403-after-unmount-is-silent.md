---
title: "Catalog preview: a Save that fails with 403 after the preview closed is silent, and two comments claim every failure surfaces"
status: in-progress
priority: low
created: 2026-09-28
updated: 2026-09-28
assignee:
labels: [deferred, react-native]
github_issue:
---

# Catalog Save 403 after unmount is silent

## Summary

In `FeaturedRecipeDetailScreen`'s `handleSaveCatalog`, the `PREMIUM_REQUIRED` branch calls `setShowUpgrade(true)` and returns before the `isMountedRef` check. If the user closes the preview while a Save is in flight and the server then answers 403, nothing is shown: the mutation is `silentError`, and the upgrade modal belongs to an unmounted screen. Two comments claim every failure surfaces: `client/hooks/useMealPlanRecipes.ts:164` ("InlineError (or a toast once it has unmounted)") and `FeaturedRecipeDetailScreen.tsx` (~317-318, "a failure that lands after the user closed the preview would otherwise vanish").

## Background

This was found in #1150's mobile review (advisory; under the one-review-pass rule it goes to a follow-up). The reviewer measured it with a scratch vitest probe: after a network failure on an unmounted screen, `toastCalls=1` (control); after a 403, `toastCalls=0`. #1150 made the case reachable. Its `!normalized` guard keeps the Save bar live over a cached preview whose refetch returned 403 (a lapsed subscriber), and for that user a 403 on Save is the expected answer. The flow has already been abandoned by the user, and the mounted path is correct, which is why this is low priority.

## Acceptance Criteria

- [ ] A 403 `PREMIUM_REQUIRED` Save failure that lands after unmount shows a toast, e.g. `Couldn't save <title>. Online recipes need Premium.`
- [ ] Add a test next to "toasts a Save failure that lands after the user closed the preview" in `client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`, with the 403 case RED first.
- [ ] Both comments match the code afterwards.

## Implementation Notes

- Move the `isMountedRef.current` check above the premium branch, or give the premium branch its own unmounted toast.
- Files in scope: `client/screens/FeaturedRecipeDetailScreen.tsx`, `client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`, `client/hooks/useMealPlanRecipes.ts`.

## Dependencies

- None

## Updates

### 2026-09-28

- Auto-filed (Low) from #1150's mobile review.
