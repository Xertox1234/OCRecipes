---
title: "Clean up recipeDismissals on deleteCommunityRecipe"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, data-integrity]
github_issue:
---

# Clean up recipeDismissals on deleteCommunityRecipe

## Summary

`deleteCommunityRecipe` cleans `cookbookRecipes` and `favouriteRecipes` but leaves orphaned `recipeDismissals` rows. No FK ensures cascade; these are permanent storage growth and stale dismissal entries.

## Background

Deferred from 2026-06-03 full audit (L5). File: `server/storage/community-recipes.ts:323-355`. The existing cleanup already handles other related tables — dismissals was missed.

## Acceptance Criteria

- [ ] `deleteCommunityRecipe` deletes from `recipeDismissals` where `recipeId = id` before or after the main delete
- [ ] No orphaned dismissal rows remain after recipe deletion

## Implementation Notes

Add a `db.delete(recipeDismissals).where(eq(recipeDismissals.recipeId, id))` call alongside the existing cleanup at lines 323-355. Use the same transaction pattern if the function already wraps in one.

## Dependencies

- None

## Risks

- Low — additive delete; no FK violation possible

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L5)
