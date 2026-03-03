---
title: "P2: Fix overly broad query cache invalidation in meal plan hooks"
status: backlog
priority: medium
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [performance, p2, meal-plan]
---

# P2: Fix overly broad query cache invalidation in meal plan hooks

## Summary

Meal plan item mutations invalidate all queries matching `["/api/meal-plan"]` prefix, which unnecessarily refetches recipe lists and recipe details.

## Background

`client/hooks/useMealPlan.ts:44-46` — `queryClient.invalidateQueries({ queryKey: ["/api/meal-plan"] })` matches `/api/meal-plan/recipes`, `/api/meal-plan/catalog`, etc. Adding/removing a meal plan item should only invalidate meal plan item queries, not recipe queries.

## Acceptance Criteria

- [ ] Narrow invalidation to only meal plan item queries (not recipe/catalog queries)
- [ ] Verify recipe list doesn't unnecessarily refetch when plan items change
- [ ] No regressions on meal plan data freshness

## Implementation Notes

Use a predicate function or more specific query key:

```typescript
queryClient.invalidateQueries({
  queryKey: ["/api/meal-plan"],
  exact: true, // or use predicate to exclude /recipes and /catalog
});
```

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
