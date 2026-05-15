---
title: "P3: TypeScript polish — const tuple types, Infinity serialization, imports"
status: backlog
priority: low
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [typescript, p3, meal-plan]
---

# P3: TypeScript polish — const tuple types, Infinity serialization, imports

## Summary

Minor TypeScript improvements for type safety and correctness.

## Background

Multiple small issues identified by TypeScript reviewer:

1. `MEAL_ICONS`/`MEAL_LABELS` typed as `Record<string, string>` instead of `Record<MealType, string>` — loses compile-time completeness check (`MealPlanHomeScreen.tsx:30-41`)
2. `Infinity` in `TIER_FEATURES.maxDailyScans` breaks JSON serialization — `JSON.stringify(Infinity)` produces `null` (`shared/types/premium.ts:46`)
3. `mealType` parameter typed as `string` throughout component tree instead of narrow `MealType` union
4. Wildcard `import * as Haptics` used for single enum value — use named import instead (`RecipeCreateScreen.tsx:19`, `RecipeImportScreen.tsx:17`)

## Acceptance Criteria

- [ ] Type `MEAL_ICONS` and `MEAL_LABELS` as `Record<MealType, string>`
- [ ] Replace `Infinity` with `999999` or `-1` sentinel in `TIER_FEATURES`
- [ ] Narrow `mealType` params from `string` to `MealType` in component props
- [ ] Change `import * as Haptics` to named import `import { NotificationFeedbackType }`
- [ ] No TypeScript errors

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
