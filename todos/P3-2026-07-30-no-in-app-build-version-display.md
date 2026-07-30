---
title: "No in-app build/runtimeVersion display, so a stale binary is undiagnosable on-device"
status: backlog
priority: low
created: 2026-07-30
updated: 2026-07-30
assignee:
labels: [deferred, mobile]
github_issue:
---

# No in-app build/runtimeVersion display, so a stale binary is undiagnosable on-device

## Summary

The app renders no version, build number, runtimeVersion, or OTA update ID anywhere in its
UI. When the installed binary is behind `main`, the only symptom is "features I expect are
missing" — indistinguishable from a regression, a premium gate, or lost work.

## Background

Filed after a real diagnosis cost on 2026-07-30. The device build was from 2026-07-28 at
`runtimeVersion 1.1.0`; `main` had moved to `1.2.0` on 2026-07-29 (PR #729, VisionCamera
5.0.11 → 5.1.1). `expo-updates` matches `runtimeVersion` **exactly**, so every OTA published
from `main` was invisible to that device — it silently kept its embedded bundle forever, with
no error, no log line, and no UI signal.

Two compounding factors made it worse:

- `eas.json`'s `preview` profile has **no `autoIncrement`** (only `production` does), and
  `cli.appVersionSource` is `"remote"`. Every build in the account so far reads `1.0.0 (4)`,
  so even the native build number does not distinguish binaries.
- `grep` for `runtimeVersion` / `nativeBuildVersion` / `nativeApplicationVersion` /
  `Updates.updateId` across `client/**/*.ts{,x}` returns **zero** non-test hits.

This is the third recorded instance of the same class of confusion. See the
`project_recurring_regression_mystery` memory ("stale OTA bundle" is one of its three decoded
causes) and `docs/solutions/logic-errors/two-features-reverting-at-once-implicates-one-stale-process-2026-07-28.md`.

## Acceptance Criteria

- [ ] A read-only version row is visible somewhere in Profile (or an About/Debug screen
      reachable from it) showing, at minimum: app version, native build number, and
      `Updates.runtimeVersion`.
- [ ] When an OTA bundle is active, the row also shows a short `Updates.updateId` prefix and
      `Updates.createdAt`; when running the embedded bundle it says so explicitly rather than
      rendering blanks.
- [ ] The row degrades gracefully in Expo Go / dev (`Updates.isEmbeddedLaunch`,
      `Updates.runtimeVersion` can be `null`) — no crash, no empty string.
- [ ] The value is copyable or at least selectable, so it can be pasted into a bug report.
- [ ] Accessible: the whole row is one `accessibilityRole="text"` node with a single label
      that reads naturally end-to-end, not five separate unlabelled fragments.
- [ ] A unit test covers the string-composition helper, including the null/embedded cases.

## Implementation Notes

- `expo-updates` is already a dependency (it backs the OTA lane). Read
  `Updates.runtimeVersion`, `Updates.updateId`, `Updates.createdAt`,
  `Updates.isEmbeddedLaunch`. `expo-application` provides
  `nativeApplicationVersion` / `nativeBuildVersion`.
- Follow the `*-utils.ts` sibling convention: put the formatting in a pure
  `client/screens/<x>-utils.ts` (or `client/components/…-utils.ts`) function so Vitest can
  cover it without mounting the screen, and keep the component a thin render.
- Consider also adding `"autoIncrement": true` to `eas.json`'s `preview` profile in the same
  change, so build numbers stop colliding. That is a one-line config edit; per the
  config-edit hand-off convention, stage it and hand the user a `cp` command rather than
  applying it silently.

## Scope Contract

- **Mechanisms to use:** existing `expo-updates` / `expo-application` reads and the existing
  `*-utils.ts` + Vitest pattern — no new dependency, no new navigation stack.
- **Files in scope:** one Profile-reachable screen or component under `client/`, its
  `-utils.ts` sibling, that sibling's `__tests__/` file, and optionally `eas.json`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- `Updates.*` values are `null` in dev/Expo Go, which is exactly where the code will first be
  exercised. Handle null before shipping, or the row reads as broken in the one environment
  the developer sees most.

## Updates

### 2026-07-30

- Initial creation, deferred out of the barcode scan flow 2.0 Phase 1 device-verification
  session (PR #736).
