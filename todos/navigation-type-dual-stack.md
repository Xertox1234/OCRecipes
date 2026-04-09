---
title: "Fix FavouriteRecipesScreen navigation type for dual-stack registration"
status: backlog
priority: low
created: 2026-04-09
updated: 2026-04-09
assignee:
labels: [architecture, audit-9]
---

# Fix FavouriteRecipesScreen navigation type for dual-stack registration

## Summary

`FavouriteRecipesScreenNavigationProp` is typed against MealPlanStack only, but the screen is registered in both MealPlanStackNavigator and ProfileStackNavigator. The type should use a union or separate props per hosting stack.

## Background

Audit #9 finding L9. Works at runtime because navigation calls resolve through the composite prop to the root stack, but the type doesn't truthfully reflect the screen's hosting context from Profile.

## Acceptance Criteria

- [ ] Navigation type accurately reflects both hosting stacks
- [ ] No `as never` or `as unknown` casts
- [ ] TypeScript compiles cleanly
