---
title: "Performance: column projection + redundant filter fixes (2026-04-28 audit)"
status: in-progress
priority: medium
created: 2026-04-28
updated: 2026-04-28
assignee:
labels: [performance, database]
---

# Performance: Column Projection + Redundant Filter Fixes

## Summary

Three storage functions fetch full rows (including heavy `instructions` JSONB) for list views that never render instructions. One service applies a redundant in-process filter after the DB already excluded the same rows.

## Background

From the 2026-04-28 audit (H6, H7, H8). The `instructions` JSONB column stores full step-by-step recipe instructions and can be several KB per recipe. Fetching it for paginated list/browser views adds unnecessary data transfer. `getFeaturedRecipes` already models the fix via `FEATURED_COLUMNS`.

## Acceptance Criteria

- [ ] **H6** `getUserRecipes` (`server/storage/community.ts:451`) — add column projection using `FEATURED_COLUMNS` (or equivalent) to exclude `instructions`
- [ ] **H7** `getUnifiedRecipes` (`server/storage/meal-plans.ts:434`) — apply column projection to both community and meal-plan recipe arms of the parallel query
- [ ] **H8** `buildCarousel` (`server/services/carousel-builder.ts:84`) — remove the redundant `.filter((r) => !dismissedIds.has(r.id))` post-DB pass
- [ ] All existing tests pass; add a test asserting `buildCarousel` result contains no dismissed IDs

## Implementation Notes

`FEATURED_COLUMNS` is defined in `server/storage/community.ts`. For `getUnifiedRecipes` the meal-plan recipe arm (personal recipes) will need its own column list since it uses a different table schema.

## Dependencies

None.

## Updates

### 2026-04-28

- Created from audit findings H6, H7, H8
