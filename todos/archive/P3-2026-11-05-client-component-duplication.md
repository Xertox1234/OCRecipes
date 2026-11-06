---
title: "Client components written twice: picker sheets, band pill/dot, recipe steps, focus inputs, progress segment, carousel props"
status: done
priority: low
created: 2026-11-05
updated: 2026-11-05
assignee: claude
labels: [audit, maintainability, client]
github_issue:
---

# Client components written twice

## Summary

Group E of the 2026-11-05 code-quality audit (maintainability lens; M1, M2, M3, M5, M6, M8; jscpd rows 8–11). Behaviour-preserving extractions — no visual change.

## Acceptance Criteria

- [x] M1 `CookbookPickerModal` + `GroceryListPickerModal` share one sheet shell (`PickerSheet`: header, list, create-new footer) — show-input/name state and reset-on-close stay per modal (Cookbook's empty state reads `showNewInput`; the two reset differently)
- [x] M2 `NutritionPanel` + `NutritionSummaryCard` share `BandPill`/`BandDot`
- [x] M3 `RecipeDetailContent` renders steps through `RecipeInstructions` (extended with optional details/expansion/hint)
- [x] M5 `FocusTextInput` + `FocusBottomSheetTextInput` share one shell taking the inner input
- [x] M6 `OnboardingProgressBar` + `WizardStepBar` share one segment
- [x] M8 `RecipeCarousel` + `CuratedRecipeCarousel` share the horizontal list props
- [x] Existing tests for every touched component still pass unchanged (testIDs, a11y labels preserved)
- [x] jscpd no longer reports the four merged pairs

## Scope Contract

- **Mechanisms to use:** plain component/hook extraction in `client/components/` — no new libraries
- **Files in scope:** the named components, new shared component files next to them, their tests
