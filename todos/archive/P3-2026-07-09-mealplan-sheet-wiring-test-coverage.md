<!-- Filename: P3-2026-07-09-mealplan-sheet-wiring-test-coverage.md -->

---

title: "Add wiring-integrity test for MealPlanHomeScreen's 4 BottomSheetModal -> useSheetBackHandler assembly"
status: done
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

### 2026-07-12

- Implemented. Added `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx` — renders
  the real screen with every collaborator mocked and a local `@gorhom/bottom-sheet` override that
  captures each of the 4 `BottomSheetModal` instances' `onChange`/`onAnimate` + a per-instance
  `dismiss` spy, keyed by the sheet's own `snapPoints` sentinel (not JSX declaration order).
  `useSheetBackHandler` itself is left real (it's under test alongside the JSX wiring). 10 tests;
  verified RED when two sheets' `onChange` props were deliberately swapped in
  `MealPlanHomeScreen.tsx` (then reverted — zero diff on that file).
- **Scope grew beyond "add a test coverage file."** Building the render test surfaced a
  pre-existing Vitest infra gap: no prior test in this repo rendered anything that transitively
  imports `react-native-svg` (pulled in via `CalorieRing.tsx`, one of `MealPlanHomeScreen`'s own
  children). The real `react-native-svg` package imports the real `react-native` package's
  Flow-syntax internals, which neither esbuild nor oxc can parse — this fails at _transform_ time
  with a misleading `SyntaxError: Unexpected token 'typeof'` that has nothing to do with the
  actual bug (confirmed via `vi.mock` NOT preventing it — Vitest's dependency-scan phase reaches
  the real file before any in-test mock applies; only a `vitest.config.ts`-level `resolve.alias`
  fixes it, matching the existing pattern for `react-native-reanimated` /
  `react-native-safe-area-context` / `@gorhom/bottom-sheet`). Fixed by adding
  `test/mocks/react-native-svg.ts` (new, aliased in `vitest.config.ts`) and a missing
  `useAnimatedProps` export to the existing `test/mocks/react-native-reanimated.ts`.
  **`vitest.config.ts` and two shared `test/mocks/*` files are touched — this is shared
  test-infra with whole-suite blast radius, not purely additive coverage.** Verified: full suite
  green (414 files / 6155 tests) both before and after the change; the automerge guard is
  expected to HOLD on this PR (`vitest.config.ts` / `test/mocks/` are not on its safe-path
  allowlist) and route to individual human review — that is the correct outcome given the blast
  radius, not a guard bug.
- Codified: `docs/solutions/conventions/mock-native-svg-flow-syntax-transform-failure-2026-07-12.md`.
