---
title: "Document two coverage boundaries left by the MealPlanHomeScreen sheet-wiring test"
status: backlog
priority: low
created: 2026-07-12
updated: 2026-07-12
assignee:
labels: [deferred, testing, mobile]
github_issue:
---

# Document two coverage boundaries left by the MealPlanHomeScreen sheet-wiring test

## Summary

PR #596's new `MealPlanHomeScreen.test.tsx` (4-sheet `useSheetBackHandler` wiring test) and
its companion `test/mocks/react-native-svg.ts` each leave one documented-but-unenforced
coverage boundary — both non-blocking, both worth a one-line note for future readers.

## Background

Surfaced during code review of PR #596. Both findings SUGGESTION-tier.

## Acceptance Criteria

- [ ] Add a one-line note to `MealPlanHomeScreen.test.tsx`'s header stating that the suite
      does not exercise `useSheetBackHandler`'s reverse-registration-order precedence
      (`MealPlanHomeScreen.tsx:870-883` — Android `BackHandler` consults listeners
      last-registered-first, load-bearing for same-screen sheet handoffs like
      `handleChooseRecipe`). Reordering the 4 `useSheetBackHandler(...)` call sites would not
      fail the current test.
- [ ] Add a one-line note to `test/mocks/react-native-svg.ts` stating the mock spreads props
      onto a DOM tag and does not replicate Reanimated's native prop-application layer — a
      future test asserting on rendered SVG attributes (`strokeDashoffset` etc.) from
      `CalorieRing`/`ProgressRing`/`ScanSonarRing`/`ScanReticle`/`AnimatedCheckmark` must not
      trust this mock for that.

## Implementation Notes

- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx`
- `test/mocks/react-native-svg.ts`
- `client/hooks/useSheetBackHandler.ts:105-113`

## Dependencies

None.

## Risks

None — documentation-only.

## Updates

### 2026-07-12

- Filed from code review of PR #596 during the "review, fix, codify, close all open PRs" session.
