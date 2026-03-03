---
title: "Centralize nutritional fallback defaults"
status: done
priority: medium
created: 2026-02-27
updated: 2026-03-02
assignee:
labels: [consistency, server, shared, tech-debt]
---

# Centralize Nutritional Fallback Defaults

## Summary

Nutritional fallback defaults (calories, protein, carbs, fat) are duplicated across multiple files with **inconsistent values**. This silent drift means different features calculate with different assumptions. Centralize into a single shared constant.

## Background

| File | Calories | Protein | Carbs | Fat |
|------|----------|---------|-------|-----|
| `server/services/adaptive-goals.ts` (L190-193) | 2000 | **150** | 250 | **67** |
| `server/services/meal-suggestions.ts` | 2000 | **100** | 250 | **65** |
| `shared/schema.ts` (L28) | 2000 | — | — | — |

Protein differs by 50% (100 vs 150) and fat differs by 3% (65 vs 67) between the two services. A user with no goals set would get different recommendations from adaptive goals vs meal suggestions.

## Acceptance Criteria

- [x] Single `DEFAULT_NUTRITION_GOALS` constant in `shared/constants/` (or similar)
- [x] All fallback usages reference the shared constant
- [x] Schema default for `dailyCalorieGoal` references the same constant
- [x] Values are consistent everywhere
- [x] All existing tests pass

## Implementation Notes

```typescript
// shared/constants/nutrition.ts
export const DEFAULT_NUTRITION_GOALS = {
  calories: 2000,
  protein: 150,
  carbs: 250,
  fat: 67,
} as const;
```

Then in each service:
```typescript
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

const currentCalories = user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories;
```

## Dependencies

- None

## Risks

- Changing meal-suggestions defaults (100→150 protein, 65→67 fat) will subtly change suggestions for users with no goals set. This is arguably a bug fix, not a regression.

## Updates

### 2026-02-27
- Initial creation from codebase audit

### 2026-03-02
- Resolved: Created `shared/constants/nutrition.ts` with `DEFAULT_NUTRITION_GOALS`
- Updated 6 files: adaptive-goals.ts, meal-suggestions.ts route, exercises.ts route, HistoryScreen.tsx, schema.ts
- Fixed protein inconsistency (100→150) and fat inconsistency (65→67) in meal-suggestions route
- All 2372 tests pass
