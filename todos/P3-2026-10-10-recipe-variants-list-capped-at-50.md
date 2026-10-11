---
title: "Community variants: the row count is uncapped but the list stops at 50"
status: backlog
priority: low
created: 2026-10-10
updated: 2026-10-10
assignee:
labels: [deferred, server, client]
github_issue:
---

# Community variants: the row count is uncapped but the list stops at 50

## Summary

On a recipe's Community section, "Community variants" shows the full count of public remixes. Tapping it opens a list that `getRecipeVariants` caps at 50 rows. A recipe with 80 public remixes would show "80" and then list only 50, with no way to see the rest.

## Background

This came up in the code review of PR #1365 ("I tried it" + Community stats) and was ruled not blocking: no recipe is anywhere near 50 remixes, and the app has no users yet. It's deferred rather than fixed so the reviewed PR head stays unchanged.

- `server/storage/recipe-tries.ts` → `getRecipeVariants(recipeId, limit = 50)`.
- `getRecipeCommunityStats` → `variantCount` is an uncapped `count()`.
- `client/screens/RecipeVariantsScreen.tsx` renders whatever `/api/recipes/:id/variants` returns.

## Acceptance Criteria

- [ ] Someone opening the variants list can reach every public remix that the count includes, or the screen says plainly that it shows the newest 50.
- [ ] A test covers more than one page (or the "newest 50" copy).

## Implementation Notes

- **Smallest fix:** add a footer under the list when `variants.length < variantCount`, e.g. "Showing the newest 50". The screen would need the count, either passed as a route param or read from the cached stats query.
- **Fuller fix:** add cursor pagination (`?before=<createdAt,id>`) to `GET /api/recipes/:id/variants` and an `onEndReached` loader. Keep the `isPublic = true` gate and the newest-first order.

## Scope Contract

- **Mechanisms to use:** the existing variants endpoint and screen; React Query.
- **Files in scope:** `server/storage/recipe-tries.ts`, `server/routes/recipe-community.ts`, `client/hooks/useRecipeCommunity.ts`, `client/screens/RecipeVariantsScreen.tsx`, and their `__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #1365 merged.

## Updates

### 2026-10-10

- Initial creation (deferred minor from the PR #1365 review).
