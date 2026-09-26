---
title: "expo-doctor dependency hygiene — direct expo-modules-core, duplicate native modules, minor skews, and the non-CNG native folders decision"
status: backlog
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, harness]
github_issue:
---

# expo-doctor dependency hygiene — direct expo-modules-core, duplicate native modules, minor skews, and the non-CNG native folders decision

## Summary

After #1106 excluded the two deliberate SDK-55 majors, `npx expo-doctor` still fails 4 checks. Each needs a dependency, lockfile or architecture change, which #1106's constraints ruled out.

## Background

From #1106's triage (2026-09-26):

1. **`expo-modules-core` is declared directly** in `package.json` `dependencies` (`^3.0.29`), with no app-code imports. Expo core packages provide it transitively, so it may be removable.
2. **Duplicate native modules.** `expo-constants@55.0.16` is nested under `expo-notifications/node_modules`, a consequence of keeping expo-notifications on SDK 55. `expo-image-loader@6.0.0` appears twice, a dedupe artifact.
3. **Minor/patch skews** in react-native-reanimated, react-native-worklets, @react-native-community/slider, react-native-svg, and patch skews on expo, expo-constants, expo-font and expo-updates. The reanimated/worklets/slider/svg skew may be deliberate for VisionCamera v5.
4. **Non-CNG app-config sync.** The native folders `android/` and `ios/` are committed (74 tracked paths) alongside CNG-style properties in `app.json`. This is an architecture decision: drop the native folders, or accept that the two aren't synced.

## Acceptance Criteria

- [ ] Item 1: confirm nothing imports `expo-modules-core` directly (including config plugins and native code), then remove it if safe, or record why it stays.
- [ ] Item 2: `npm dedupe` (or an equivalent lockfile change) removes the `expo-image-loader` duplicate. Record the `expo-constants` nesting as a known consequence of the SDK-55 exclusion.
- [ ] Item 3: for each skew, record "deliberate (why)" or align it. Any change that touches native modules must be flagged as needing a new build.
- [ ] Item 4: the user decides between the CNG and bare workflow. Record the decision; this is not an executor call.

## Implementation Notes

- Every change here touches `package.json`/`package-lock.json`/`node_modules`. Do it only when no other `/todo` executor is running, because the worktrees share `node_modules` by symlink.
- Any native-module version change requires a new EAS build before further OTA updates (the user's device runs preview build 5, runtime 1.2.0).
- See `docs/solutions/conventions/expo-doctor-intentional-major-skew-exclude-2026-09-26.md` for how intentional skews are documented (`expo.install.exclude`).

## Scope Contract

- **Files in scope:** `package.json`, `package-lock.json`, and `app.json` (item 4, only after the user decides).

## Dependencies

- None
