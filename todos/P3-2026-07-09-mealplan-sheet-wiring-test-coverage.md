<!-- Filename: P3-2026-07-09-mealplan-sheet-wiring-test-coverage.md -->

---

title: "Add wiring-integrity test for MealPlanHomeScreen's 4 BottomSheetModal -> useSheetBackHandler assembly"
status: backlog
priority: low
created: 2026-07-09
updated: 2026-07-09
assignee:
labels: [deferred, testing, ui-ux]
github_issue:

---

# Add wiring-integrity test for MealPlanHomeScreen's 4 BottomSheetModal -> useSheetBackHandler assembly

## Summary

No test confirms which `onSheetChange`/`onSheetAnimate` handler pair maps to which of
`MealPlanHomeScreen`'s 4 `BottomSheetModal`s. PR #555's reviewer traced the wiring correct by
hand, but nothing catches a future edit that wires the wrong pair together.

## Background

Filed as a deferred `mobile-reviewer` SUGGESTION from PR #555's code review (`/todo` run,
2026-07-09). `MealPlanHomeScreen` hosts 4 sheets (Quick Add, Simple Entry, Choose Recipe, Import
Recipe, or however the 4 are named in the current file), each with its own `useSheetBackHandler`
call and its own closing-animation confirmation wiring added in PR #555. A copy-paste error
swapping two sheets' callbacks would silently misroute back-button dismissal for one sheet while
looking correct for the others.

## Acceptance Criteria

- [ ] Add a test that asserts each of the 4 sheets' `onSheetChange`/`onSheetAnimate` callbacks
      updates the correct `isOpenRef`/sheet-open state for that specific sheet (not a sibling's).
- [ ] Existing `MealPlanHomeScreen` and `useSheetBackHandler` test suites continue to pass
      unchanged.

## Implementation Notes

- File under test: `client/screens/meal-plan/MealPlanHomeScreen.tsx`.
- Follow existing test conventions in this screen's `__tests__/` directory (or wherever the
  screen's current test file lives) rather than introducing a new testing pattern.

## Dependencies

- None — independent of PR #555 merging; can be written against the file as it exists there.

## Risks

- Low — this is additive test coverage, no production code change expected.

## Updates

### 2026-07-09

- Filed as a deferred warning from the `/todo` executor that implemented PR #555, per user
  instruction to convert deferred items into tracked todos.
