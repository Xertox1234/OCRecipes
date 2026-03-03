---
title: "Guard recomputeMacros against division by zero"
status: pending
priority: p1
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, bug, adaptive-goals]
---

# Guard recomputeMacros against division by zero

## Summary

`recomputeMacros()` in `server/services/adaptive-goals.ts` divides by `totalCurrentMacroCalories` which is 0 when all macros (protein, carbs, fat) are 0. This produces NaN values that propagate into the database.

## Background

Found by: architecture-strategist, kieran-typescript-reviewer (C1)

The function is exported and publicly callable. While `computeAdaptiveGoals` defaults to non-zero macros, the pure function itself has no guard. The test file also does not cover this edge case.

**File:** `server/services/adaptive-goals.ts`, lines 63-67

## Acceptance Criteria

- [ ] `recomputeMacros` returns sensible defaults when all macros are 0 (e.g., 40/30/30 carbs/protein/fat split)
- [ ] Unit test added for zero-input edge case
- [ ] No NaN values can propagate to the database

## Implementation Notes

Add a guard at the top of `recomputeMacros`:
```typescript
if (totalCurrentMacroCalories === 0) {
  return {
    protein: Math.round((newCalories * 0.3) / 4),
    carbs: Math.round((newCalories * 0.4) / 4),
    fat: Math.round((newCalories * 0.3) / 9),
  };
}
```

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
