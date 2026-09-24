---
title: "Minor accessibility cleanups: double-announced selection in the date strip, unhidden decorative icons, and an early skeleton announcement"
status: done
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, accessibility]
github_issue:
---

# Minor accessibility cleanups: double-announced selection in the date strip, unhidden decorative icons, and an early skeleton announcement

## Summary

A handful of small accessibility cleanups found during the front-end audit, excluding the LabelAnalysis and touch-target items, which have their own todos.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **L12** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/screens/meal-plan/MealPlanHomeScreen.tsx:170-171` `DateStripItem` appends ", selected" to the label AND sets `accessibilityState={{selected}}`, so selection is announced twice.
- `client/screens/NutritionDetailScreen.tsx:444` decorative `search` icon and `:494` `arrow-right` icon inside a labeled Pressable are not hidden.
- `client/screens/NutritionDetailScreen.tsx:71-73` skeleton "Loading" is announced synchronously on mount rather than delayed per the modal-present convention (low risk).

## Acceptance Criteria

- [x] DateStripItem announces selection once (state only)
- [x] The listed decorative icons are hidden from screen readers
- [x] The NutritionDetail loading announce follows the project's delayed-announce convention (or is documented as intentional)
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Small, mechanical.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  - `client/screens/NutritionDetailScreen.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (L12).
- Implemented: dropped the `", selected"` label suffix on `DateStripItem`
  (`accessibilityState` now the sole selection signal); added
  `accessible={false}` to the decorative `search` and `arrow-right` Feather
  icons in `NutritionDetailScreen.tsx`; delayed the skeleton's "Loading"
  announce by 500ms (cleared on unmount) per the on-open-announce convention,
  since `NutritionDetail` is a `presentation: "modal"` route. New/updated
  tests confirmed RED against pre-fix code and GREEN after. The icon-hiding
  fix has no matching jsdom test — documented inline as intentional
  (`accessible={false}` never reaches the mocked DOM in this harness; no
  label-absence delta exists to pin), following the
  `todos/archive/2026-06-03-coach-pro-bookmark-icon-accessible-false.md`
  precedent. Reviewed by `code-reviewer` and `mobile-reviewer` — no blocking
  findings.
