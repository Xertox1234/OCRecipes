---
title: "Add test coverage for ScanScreen's safeGoBack call sites"
status: done
priority: low
created: 2026-07-16
updated: 2026-07-16
assignee:
labels: [testing, deferred, navigation]
github_issue:
---

# Add test coverage for ScanScreen's safeGoBack call sites

## Summary

PR #606 added `safeGoBack(...)` fallback navigation to 3 call sites in `client/screens/ScanScreen.tsx` (post-log-success close, permission-denied "Cancel", "Close camera"), but none of them have test coverage, and the gap was never surfaced in the PR's own test-plan checklist (unlike `FeaturedRecipeDetailScreen`'s documented, justified gap).

## Background

Found during code review of PR #606 (`fix(navigation): safe-back-navigation fallback + Coach badge honesty`). The reviewer noted `client/screens/__tests__/ScanScreen.test.tsx` already exists **on `main`** (added by the camera-overhaul work after PR #606's branch diverged) and mounts the screen successfully, but doesn't mock `canGoBack` and never exercises these three buttons.

Deliberately **not** fixed inside PR #606 itself: that branch is ~40 commits behind `main`, and `client/screens/__tests__/ScanScreen.test.tsx` is absent both on the PR branch and at its merge-base — it only exists on `main`. Creating it fresh on the stale branch would produce an add/add merge conflict with `main`'s copy, converting a verified-clean merge into a conflicting one just to add a test. This todo targets `main`'s real, current files instead, after PR #606 has merged.

Also note: `main`'s current `ScanScreen.tsx` has since removed the intermediate `safeGoBack` wrapper history entirely at these lines relative to the merge-base (it was never touched by the camera-overhaul commits, so PR #606's changes will land there cleanly on merge) — by the time this todo runs, these 3 call sites in `main`'s `ScanScreen.tsx` will read `safeGoBack(navigation, () => navigation.reset({ index: 0, routes: [{ name: "Main" }] }))` (the WARNING-fix applied in #606, not the original pre-fix `navigate("Main")` form).

## Acceptance Criteria

- [ ] Add a `describe("ScanScreen — safe back navigation", ...)` block to `client/screens/__tests__/ScanScreen.test.tsx`, mirroring the pattern already used in `client/screens/__tests__/RecipeChatScreen.test.tsx`
- [ ] Mock `canGoBack` (the existing test file doesn't) and cover all 3 call sites: the permission-denied "Cancel and go back" button, the "Close camera" button, and the post-log-success close (in `handleConfirmLog`)
- [ ] For each site, assert both branches: `canGoBack: true` → `goBack()` called, `navigate`/`reset` NOT called; `canGoBack: false` → `reset({ index: 0, routes: [{ name: "Main" }] })` called (NOT `navigate`)

## Implementation Notes

- `TouchableOpacity` is used at all 3 sites (not `Pressable`) — confirm the mock wiring in `test/mocks/react-native.ts` already covers `TouchableOpacity`'s `onPress`→`onClick` (per `docs/solutions/logic-errors/touchableopacity-mock-missing-onpress-wiring-2026-07-14.md`, this was fixed 2026-07-14 and should already apply).
- The post-log-success site (`handleConfirmLog`) needs `apiRequest`/`queryClient`/`toast` mocked — check whether the existing `ScanScreen.test.tsx` already has this scaffolding before adding new mocks.

## Dependencies

None — targets `main` directly, once PR #606 has merged.

## Risks

- `ScanScreen.tsx` is under active development (camera overhaul series, PRs #620/#623/#631/#633) — re-verify the 3 call sites' current shape against `main` before writing assertions, in case they've moved again.

## Updates

### 2026-07-16

- Filed after code review on PR #606 surfaced the gap; deferred rather than fixed in-branch to avoid an add/add merge conflict on a stale branch (see Background).
- Implemented: added `describe("ScanScreen — safe back navigation", ...)` to `client/screens/__tests__/ScanScreen.test.tsx` covering all 3 call sites (permission-denied "Cancel and go back", "Close camera", post-log-success close in `handleConfirmLog`), each asserting both the `canGoBack: true` (goBack, not navigate/reset) and `canGoBack: false` (reset to Main, not goBack/navigate) branches. Converted the file's `@react-navigation/native` and `@/camera/hooks/useCameraPermissions` mocks to hoisted mutable values, added a mocked `@/lib/query-client` apiRequest for the post-log-success POST/GET calls, and added a `@/camera/reducers/scan-phase-reducer` mock that delegates to the real reducer except for one flagged shortcut used only by the post-log-success tests (to reach `handleConfirmLog`'s precondition without driving the full barcode-lock → confirm flow, which has its own dedicated coverage elsewhere). Reviewed clean by `code-reviewer` and `mobile-reviewer` (one trivial SUGGESTION applied: assert the log POST fired before the navigation assertion). Correction to this todo's Implementation Notes: the "Log It" button (site 1) is a `Pressable`, not a `TouchableOpacity` — doesn't change anything, both mocks were already correctly wired.
