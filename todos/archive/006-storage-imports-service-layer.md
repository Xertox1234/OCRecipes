---
title: "Storage layer imports from service layer (layering violation)"
status: complete
priority: high
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, audit-2026-03-27-full]
audit_id: H6
---

# Storage layer imports from service layer (layering violation)

## Summary

`server/storage/meal-plans.ts:43` imports `inferMealTypes` from `../services/meal-type-inference`, violating the dependency direction (routes → services → storage). Storage should be a pure data-access layer.

## Background

Also, `server/storage/verification.ts:6` imports `type VerificationNutrition` from `../services/verification-comparison` — a type-only import but still a conceptual dependency.

## Acceptance Criteria

- [ ] `inferMealTypes` call moved out of `createMealPlanRecipe` storage function — caller (route or service) should call it before passing the result
- [ ] `VerificationNutrition` type moved to `shared/types/verification.ts`
- [ ] No imports from `../services/` in any storage module
- [ ] Existing tests pass

## Implementation Notes

- The route that calls `createMealPlanRecipe` should call `inferMealTypes` first and pass the result
- The `VerificationNutrition` type can live alongside `ConsensusNutritionData` already in `shared/types/verification.ts`

## Dependencies

- None

## Risks

- Multiple callers of `createMealPlanRecipe` may need updating

## Updates

### 2026-03-27

- Created from full audit finding H6

### 2026-04-02

- Resolved by full audit finding H5: sessions.ts now imports from @shared/types/, chat.ts imports from @shared/schemas/recipe-chat
