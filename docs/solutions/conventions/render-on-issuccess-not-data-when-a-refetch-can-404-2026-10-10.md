---
title: Gate UI that must vanish when its resource does on query.isSuccess, not on data — a failed refetch keeps the old data
track: knowledge
category: conventions
tags: [client-state, hooks, react-native, tanstack-query, visibility, stale-data]
module: client
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx, client/hooks/**/*.ts]
created: 2026-10-10
---

# Gate UI that must vanish when its resource does on query.isSuccess, not on data — a failed refetch keeps the old data

## Rule

When a piece of UI should exist only while the server still serves its resource, render it on `query.isSuccess`, not on `query.data !== undefined` / `data?.x`. Examples are community stats for a recipe that may be made private, or a share panel for an item that may be deleted.

## Why

After a successful fetch, a failed refetch (a 404 once the recipe goes private, or a network error) does **not** clear `data`. TanStack Query keeps the last good value and moves `status` to `"error"`, so `isSuccess` turns false while `data` is still set. A `data`-gated component therefore freezes on stale counts and stays tappable, sending writes the server will reject.

Pinned by `client/hooks/__tests__/useRecipeCommunity.test.ts` → "isSuccess turns false when a refetch 404s (recipe went private)". It seeds a success, makes the refetch reject with a `NOT_FOUND` `ApiError`, and asserts `isSuccess` becomes false.

## Examples

- `RecipeTriedBar` and `RecipeCommunityStats` both do `if (!stats.isSuccess) return null;`.
- `FeaturedRecipeDetailScreen` gates the bar *and* its content padding the same way: `showTriedBar = resolvedRecipeType === "community" && communityStats.isSuccess`. The padding collapses with the bar.
- Pair it with `retry: false` and `meta: { silentError: true }` when the UI's only error behaviour is to disappear. Every consumer of that query key must render its own error UI or hide, per the client-state rule on `silentError`.

## Exceptions

Do **not** use this for primary content where the user is better served by the last good data plus an error banner, such as a recipe body or a meal plan. There, keep `data` and branch on `isError` for an inline error (the client-state rule: check `isError` before the empty branch). This convention is for secondary UI whose *existence* depends on the resource's visibility.

## Related Files

- `client/hooks/useRecipeCommunity.ts` — `useRecipeCommunityStats`
- `client/components/RecipeTriedBar.tsx`, `client/components/RecipeCommunityStats.tsx`
- `client/screens/FeaturedRecipeDetailScreen.tsx` — `showTriedBar`

## See Also

- [../logic-errors/overlapping-optimistic-toggle-taps-clobber-the-last-tap-2026-10-10.md](../logic-errors/overlapping-optimistic-toggle-taps-clobber-the-last-tap-2026-10-10.md) — the write side of the same hook
