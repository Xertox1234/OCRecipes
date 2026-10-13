---
title: "Onboarding: centre the Diet Type grid, pin the step count to the screen list"
status: done
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, ui, onboarding]
github_issue:
---

# Onboarding: centre the Diet Type grid, pin the step count to the screen list

## Summary

Two small leftovers from PR #1413: the Diet Type grid still sits off-centre, and nothing ties the new step-count constants to the real number of onboarding screens.

## Background

- **Diet Type grid (#51 from the 2026-10 visual QA sweep).** The #1413 executor could not reproduce it from the code, so it fixed only the Paleo icon. A simulator check on 2026-10-12 shows it is still there: about 21pt left gutter against 31pt right. `dietItem` is `width: "47%"`, so two tiles plus the gap leave spare width, and it all lands on the right.
- **Step count drift.** `client/context/onboarding-steps.ts` has `INTRO_SCREEN_COUNT = 2` and `QUESTION_STEP_COUNT = 6`. `client/context/OnboardingContext.tsx` has its own `TOTAL_STEPS = 8`. If someone adds a screen, the badge and bar go wrong silently. This was a review note on #1413.

## Acceptance Criteria

- [x] The Diet Type grid has equal left and right gutters on an iPhone 17 Pro simulator, in light and dark mode.
- [x] A test fails if `INTRO_SCREEN_COUNT + QUESTION_STEP_COUNT` differs from the onboarding screen count. Better still, derive one from the other.

## Implementation Notes

- `client/screens/onboarding/DietTypeScreen.tsx` — `dietItem` (`width: "47%"`, around line 250) and its grid container. Use `justifyContent: "space-between"` on the grid, or `flexBasis` with `gap`, matching `GoalsScreen.tsx`.
- `client/context/onboarding-steps.ts`, `client/context/OnboardingContext.tsx` (`TOTAL_STEPS`), `client/context/__tests__/onboarding-steps.test.ts`.

## Dependencies

- None.

## Updates

### 2026-10-12

- Filed after the #1413 simulator check.

### 2026-10-12 (done)

- Grid: `dietItem` uses `flexBasis: "40%"` with `flexGrow: 1` instead of `width: "47%"`, so each pair fills the row exactly with the grid's 12pt gap. iPhone 17 Pro simulator, from describe-ui frames: tiles at x 20 and 207, width 175, so both gutters are 20pt (before: ~21pt left, ~31pt right). Checked light and dark.
- Step count: the screen names live in `ONBOARDING_SCREENS` (`client/context/onboarding-steps.ts`). `QUESTION_STEP_COUNT` and OnboardingContext's `TOTAL_STEPS` derive from it. The navigator maps names to components through a `Record`, so a screen added on one side only fails to compile. The new test pins the intro screens and the sum. On the simulator the Welcome copy says "6 quick steps", the bar has 6 segments, and Diet Type shows "Step 3 of 6".
