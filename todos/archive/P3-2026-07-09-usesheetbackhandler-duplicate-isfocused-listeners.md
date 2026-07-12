<!-- Filename: P3-2026-07-09-usesheetbackhandler-duplicate-isfocused-listeners.md -->

---

title: "useSheetBackHandler: 4 per-screen instances each subscribe to useIsFocused independently"
status: done
priority: low
created: 2026-07-09
updated: 2026-07-12
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

- [x] Decide whether to share a single `useIsFocused()` call across the 4 `useSheetBackHandler`
      invocations on `MealPlanHomeScreen` (e.g. compute it once in the screen and pass it into the
      hook as a parameter) or explicitly document why the current per-call subscription is
      acceptable as-is. **Decision: document as acceptable as-is** — see Updates below.
- [x] If changing the hook's signature, update all call sites and existing tests accordingly. **N/A
      — signature unchanged** (decision was to document, not refactor).

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

### 2026-07-12

- **Decision: keep the current per-call `useIsFocused()` subscription; documented, not refactored.**
  Sharing a single call would require making `isFocused` a _required_ hook parameter (a conditional
  internal `useIsFocused()` call is disallowed by the Rules of Hooks, and an _optional_ override
  param reproduces the exact silently-dropped-safety-param footgun documented in
  `docs/LEARNINGS.md` 2026-04-28 "Optional Hook Safety Param Silently Dropped at Call Site"). A
  required param would force all 5 unrelated single-instance hosts (`HomeScreen`,
  `RecipeBrowserScreen`, `RecipeEntryHubScreen`, `BeveragePickerSheet`, `ConfirmationModal`) to
  also compute and pass it, for zero benefit to those call sites — disproportionate for a P3 item
  the original reviewer already judged as harmless overhead. Added rationale comments to
  `client/hooks/useSheetBackHandler.ts` and `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  instead. No behavior change.
