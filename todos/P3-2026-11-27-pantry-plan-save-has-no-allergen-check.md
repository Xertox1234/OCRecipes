---
title: "Saving a pantry-generated meal plan runs no allergen check before its meals are added"
status: backlog
priority: low
created: 2026-11-27
updated: 2026-11-27
assignee:
labels: [deferred, client, meal-plan, allergens]
github_issue:
---

# Pantry-generated plan save has no allergen check

## Summary

`ReceiptMealPlanScreen` saves a whole generated plan with
`useSaveGeneratedMealPlan` (`POST /api/meal-plan/save-generated`). It is a
seventh way to add meals to the plan, and the pick-time allergen check
(`useConfirmPlanPick`) does not run on it. The meals are the user's own. The
generator's prompt tells the model to exclude the user's allergens
(`server/services/pantry-meal-plan.ts`), but a prompt is not a check.

## Background

Found while building `P2-2026-11-20-allergen-warning-when-a-meal-is-picked`.
The owner chose to cover the six single-meal add paths; this batch save is a
different flow, where one confirm per meal would not fit. It needs its own
design: one summary warning before the save, or a mark on each clashing meal
in the preview.

## Acceptance Criteria

- [ ] The owner picks how a batch save shows a clash (one summary, or per meal).
- [ ] Saving a generated plan with a meal that clashes with the user's allergy warns before the save, using `getPickWarning` from `client/components/meal-plan/pick-allergen-utils.ts`.
- [ ] A test in `client/screens/meal-plan/__tests__/ReceiptMealPlanScreen.test.tsx` fails without the warning.

## Implementation Notes

- Each generated meal carries its ingredients: run `pickedFromIngredientNames`
  on them, with the audience `self`.
- Files: `client/screens/meal-plan/ReceiptMealPlanScreen.tsx`,
  `client/hooks/useConfirmPlanPick.ts` (a batch variant), and their tests.
