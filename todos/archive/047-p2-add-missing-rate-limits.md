---
title: "P2: Add rate limiting to meal plan update/delete endpoints"
status: backlog
priority: medium
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [security, p2, meal-plan]
---

# P2: Add rate limiting to meal plan update/delete endpoints

## Summary

Several meal plan endpoints are missing rate limiting while their POST/GET counterparts have it. Inconsistent and leaves update/delete operations unprotected.

## Background

Missing `mealPlanRateLimit` on:

- `PUT /api/meal-plan/recipes/:id`
- `DELETE /api/meal-plan/recipes/:id`
- `PUT /api/meal-plan/items/:id` (if it survives dead code removal — see todo 043)

## Acceptance Criteria

- [ ] Apply `mealPlanRateLimit` to all meal plan update/delete endpoints
- [ ] Verify consistency across all meal plan routes

## Dependencies

- Todo 043 (dead code removal) — if PUT items route is deleted, skip that one

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
