---
title: "Fix iOS build failure — NitroModules/React-jsi C++ error (xcodebuild 65)"
status: done
priority: high
created: 2026-06-02
updated: 2026-06-03
assignee:
labels: [reliability, ios, build, native]
github_issue:
---

# Fix iOS native build — NitroModules / React-jsi C++ compile error

## Summary

`npx expo run:ios` fails with `xcodebuild` error code 65 (3 C++ compile errors) in React Native's JSI / Nitro layer. This blocks all iOS native development (the primary camera-dev workflow) and blocks the Sentry native-build verification ([[P2-2026-05-31-sentry-native-build-verify]]).

## Background

Discovered 2026-06-02 while verifying the Sentry native build on the main checkout. The Sentry pods compiled **clean** (`SentryError.mm` et al.), so the failure is unrelated to Sentry — it is in the JSI/Nitro C++ headers.

During that same session, `pod install` bumped several Expo pods to match `node_modules` (`ExpoModulesCore 3.0.29→3.0.30`, `ExpoSpeech 13.1.7→14.0.8`, `ExpoImage 3.0.10→3.0.11`, and others). It is **not yet known** whether this build was already broken (stale Pods predating an earlier `npm install`) or whether the pod bump introduced a JSI/Nitro version skew. Establishing that is the first investigation step.

The exact errors (from the build log):

- `ios/Pods/Headers/Private/NitroModules/JSIConverter.hpp:8` — `unknown type name 'namespace'` + `expected ';' after top level declarator` (a C++ header `namespace margelo::nitro {…}` being parsed outside a C++/Objective-C++ context).
- `ios/Pods/Headers/Public/React-jsi/jsi/jsi.h:10` — `<cassert> file not found` (C++ stdlib not on the include path for that translation unit).
- Result: `› 3 error(s), and 8 warning(s)` → `CommandError: Failed to build iOS project. "xcodebuild" exited with error code 65.`

## Acceptance Criteria

- [ ] `npx expo run:ios` builds **and** launches on a simulator with no `xcodebuild` errors. Confirm the **real** exit code (the `expo run:ios` process, not a trailing `echo` — see the masked-exit-code gotcha in [[P2-2026-05-31-sentry-native-build-verify]]).
- [ ] Root cause identified and recorded (pod/JSI version skew vs. C++ compile-context vs. stale Pods) — including whether the 2026-06-02 Expo pod bump was the trigger.
- [ ] MLKit fat-binary simulator patch still functions after the fix (build-phase Run Script `[MLKit] Patch for platform`; see memory `project_ios26_simulator_fix`).
- [ ] Sentry build phases still present after the fix ("Upload Debug Symbols to Sentry" + the `sentry-xcode.sh`-wrapped bundling phase in `ios/OCRecipes.xcodeproj/project.pbxproj`).

## Implementation Notes

- **Hands-on / main-checkout only — NOT executor-automatable.** `ios/` is gitignored (absent in `/todo` worktrees), and a fix needs Xcode + a Simulator. Do not dispatch this to a `todo-executor`; the orchestrator/user runs it directly.
- Likely starting points, cheapest first:
  1. `cd ios && pod deintegrate && pod install` — clears a stale/half-migrated Pods graph. **Back up `ios/Podfile` and `ios/Podfile.lock` first** (Podfile holds gitignored MLKit customizations — never lose them; memory `feedback_no_expo_prebuild_clean`).
  2. Check `react-native-nitro-modules` / `react-native-vision-camera` / `expo-modules-core` versions in `package.json` vs. what the pods resolved to — a JSI ABI skew here is the prime suspect.
  3. Verify the failing pod targets compile as **Objective-C++** with `CLANG_CXX_LANGUAGE_STANDARD = c++20` (pod install logged it setting `CLANG_CXX_LANGUAGE_STANDARD to c++20` on the project — confirm it reached the offending target).
  4. Worst case: clean `node_modules` + reinstall, then `npx pod-install`.
- The JSI/Nitro "first error" can be misleading noise from Expo's build-log parser; if `pod deintegrate`+reinstall doesn't fix it, read the raw `xcodebuild` output for the _actual_ first failing compile, not the formatted summary.
- Files in scope: `ios/Podfile`, `ios/Podfile.lock`, `ios/Pods/Headers/Private/NitroModules/JSIConverter.hpp`, `ios/Pods/Headers/Public/React-jsi/jsi/jsi.h`, `ios/OCRecipes.xcodeproj/project.pbxproj`, `package.json`, `scripts/patch-mlkit-simulator.py`.

## Dependencies

- None — this is the blocker that [[P2-2026-05-31-sentry-native-build-verify]] (AC #3 + the live-DSN error test) waits on.

## Risks

- `pod deintegrate` / reinstall can disturb the gitignored Podfile customizations (MLKit patch, push-entitlement strip). Back up `ios/Podfile` + `ios/Podfile.lock` before touching them.
- The error may be pre-existing (unrelated to the 2026-06-02 pod bump). Don't assume a revert fixes it — identify root cause empirically.

## Updates

### 2026-06-02

- Created from the Sentry native-build verification session. `npx expo run:ios` (iPhone 16e sim, `--no-bundler`) failed with `xcodebuild` error 65 on NitroModules/React-jsi C++ errors. Sentry pods compiled clean — failure is unrelated to Sentry. Transient build log was at `/tmp/expo-run-ios.log`.

### 2026-06-03 — RESOLVED (PR #340, merged)

Root cause was not a single error but four stacked, pre-existing blockers (each masked the next):

1. `react-native-vision-camera-ocr-plus@1.2.4` is a VisionCamera-v4 plugin → upgraded to **2.0.0** (v5-native/Nitro). Cleared the original `JSIConverter.hpp` "namespace"/`<cassert>` errors **and** the follow-on `FrameProcessorPlugin` "cannot find type" error.
2. VisionCamera family version drift caused a barcode-scanner Xcode-26 swift-frontend ICE → aligned `vision-camera` + `-barcode-scanner` + `-worklets` at **5.0.11**.
3. RN 0.81 prebuilt `React.framework` (device-tagged arm64) wouldn't link to the arm64 simulator → set `ios.buildReactNativeFromSource: true` in `ios/Podfile.properties.json` (gitignored; documented in `docs/DEV_SETUP.md`).
4. ocr-plus v2 needs `worklets >=0.8.0` → bumped `reanimated ~4.1.1 → ~4.3.1` + `worklets → ~0.8.3` (the RN-0.81 ceiling; 4.4.0/0.9.x need RN 0.83+).

Verified: `Build Succeeded`, app installs + launches + renders Home with live data on the iPhone 16e simulator; `check:types` clean; full CI green on #340. Codified in `docs/solutions/best-practices/visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md`.

**Remaining (separate, device-only — NOT this todo):** live OCR text-detection check + the Sentry error test ([[P2-2026-05-31-sentry-native-build-verify]]); iOS Run Script "ambiguous dependencies" hygiene ([[P3-2026-06-02-ios-build-script-phase-ambiguous-deps]]).
