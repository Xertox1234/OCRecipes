<!-- Filename: P3-2026-07-09-usesheetbackhandler-ondevice-verification.md -->

---

title: "On-device Android verification for useSheetBackHandler close-animation and focus-scoping fixes (PR #555)"
status: backlog
priority: low
created: 2026-07-09
updated: 2026-07-09
assignee:
labels: [deferred, ui-ux, android, follow-up, testing]
github_issue:

---

# On-device Android verification for useSheetBackHandler close-animation and focus-scoping fixes (PR #555)

## Summary

PR #555 implemented fixes for two of `useSheetBackHandler`'s four known edge cases (the
close-animation dead window and the focus-scoping gap), verified only via unit tests
(Vitest/jsdom `renderHook`) — the automated `/todo` session that implemented them had no
Android emulator or physical device access. The `advisor` tool flagged this as **load-bearing**:
both are timing-sensitive Android hardware-back behaviors that unit tests cannot fully validate.

## Background

Filed as a deferred warning from PR #555's implementation (`/todo` run, 2026-07-09). This is the
same on-device-verification gap the original PR #543 author hit — see
`todos/archive/P3-2026-07-02-bottomsheet-android-back-dismiss.md`. Not a known regression; the
fixes are reasoned correct by trace and pass unit tests, but "hardware back during a ~300ms
animation" and "focus blur without unmount via a deep-link" are exactly the class of timing bug
that only manifests on a real back-press event loop.

## Acceptance Criteria

- [ ] On a real device or Android emulator, verify the close-animation grace period: trigger a
      state-driven sheet close via an in-sheet action (e.g. choosing a recipe in Quick Add), then
      press hardware back during the sheet's close animation — the back press should be consumed
      by the still-closing sheet, not fall through to React Navigation.
- [ ] Verify the focus-scoped listener fix: open a sheet on `MealPlanHomeScreen`, navigate away via
      a deep-link/push-notification response (which blurs, not unmounts, the screen), then press
      hardware back on the newly-focused screen — confirm the stale listener from the blurred
      screen does not consume it.
- [ ] Record pass/fail for both cases (and any follow-up needed) in this todo's Updates section.

## Implementation Notes

- Files under test: `client/hooks/useSheetBackHandler.ts`, `client/screens/meal-plan/MealPlanHomeScreen.tsx`.
- Requires an Android emulator or physical device — the project already has emulator tooling used
  for TalkBack accessibility verification (boot with `-gpu host`) as a starting point for
  booting/interacting with the emulator, though this test needs live back-press + animation-timing
  observation, not logcat speech capture, so budget for manual interaction rather than a scripted
  check.
- This is verification, not implementation — if either case fails, that becomes new work (revise
  the animation-confirmed-close pattern or the focus-scoping gate), not a fix to make here.

## Dependencies

- PR #555 (open) — this todo verifies its two riskiest fixes before/after merge.

## Risks

- If either case fails on-device, the underlying fix in `useSheetBackHandler.ts` needs revision —
  budget for that possibility rather than assuming this is a rubber-stamp check.

## Updates

### 2026-07-09

- Filed as a deferred warning from the `/todo` executor that implemented PR #555, per user
  instruction to convert deferred items into tracked todos.
