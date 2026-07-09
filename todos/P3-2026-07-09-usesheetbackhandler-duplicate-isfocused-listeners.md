<!-- Filename: P3-2026-07-09-usesheetbackhandler-duplicate-isfocused-listeners.md -->

---

title: "useSheetBackHandler: 4 per-screen instances each subscribe to useIsFocused independently"
status: backlog
priority: low
created: 2026-07-09
updated: 2026-07-09
assignee:
labels: [deferred, performance, hooks]
github_issue:

---

# useSheetBackHandler: 4 per-screen instances each subscribe to useIsFocused independently

## Summary

`MealPlanHomeScreen` calls `useSheetBackHandler` 4 times (once per sheet), and each call
independently invokes `useIsFocused()` — 8 listener subscriptions total for what is really one
logical screen-focus state.

## Background

Filed as a deferred `mobile-reviewer` SUGGESTION from PR #555's code review (`/todo` run,
2026-07-09), added when the hook was gated on `useIsFocused()` to fix the stale-listener
cross-screen bug. The reviewer judged this harmless overhead, not worth a hook API change for a
P3 item, but flagged it for a deliberate decision rather than leaving it unexamined.

## Acceptance Criteria

- [ ] Decide whether to share a single `useIsFocused()` call across the 4 `useSheetBackHandler`
      invocations on `MealPlanHomeScreen` (e.g. compute it once in the screen and pass it into the
      hook as a parameter) or explicitly document why the current per-call subscription is
      acceptable as-is.
- [ ] If changing the hook's signature, update all call sites and existing tests accordingly.

## Implementation Notes

- Files: `client/hooks/useSheetBackHandler.ts`, `client/screens/meal-plan/MealPlanHomeScreen.tsx`.
- `useIsFocused()` itself is cheap (context read, no re-render storm), so this is a code-clarity /
  minor-overhead question, not a measured performance problem.

## Dependencies

- None.

## Risks

- Low — cosmetic/perf-only; if a hook signature change is chosen, verify no other screen currently
  uses `useSheetBackHandler` in a way that would break.

## Updates

### 2026-07-09

- Filed as a deferred warning from the `/todo` executor that implemented PR #555, per user
  instruction to convert deferred items into tracked todos.
