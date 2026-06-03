---
title: "Verify Sentry Expo plugin native build after PR #288 merge"
status: backlog
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [reliability, observability, deferred]
github_issue:
---

# Sentry native build verification

## Summary

PR #288 added `@sentry/react-native/expo` to `app.json` plugins, but native build verification could not be done in an executor worktree. The Sentry Expo plugin writes iOS/Android native init files during `expo prebuild` — this needs a manual verification pass before the observability stack is fully wired end-to-end.

## Background

PR #288 explicitly deferred this: _"Native iOS/Android build verification cannot be done in the executor worktree — run npx expo prebuild (no --clean) on the main checkout after merge."_

The JS-level wiring (`initReporter()`, `reportError()`, `logger.*`) works without a native build. The Sentry plugin's native changes (automatic crash reporting, native stack frames in Sentry events) only activate after a prebuild + rebuild. Until then, Sentry captures JS errors but misses native crashes and has no source maps.

## Acceptance Criteria

- [ ] `npx expo prebuild` (without `--clean`) runs without error on main after PR #288 merge.
- [ ] `ios/` and `android/` contain the Sentry native init hooks (`SentrySDK.start` in `AppDelegate`, Sentry Gradle plugin in `android/`).
- [ ] `npx expo run:ios` builds and launches in the iOS Simulator without errors.
- [x] `EXPO_PUBLIC_SENTRY_DSN` is documented (in `docs/DEV_SETUP.md` "Mobile Client" — no `.env.example` exists in this repo; DEV_SETUP.md is the tracked env-var source) so it's not forgotten at first deployment.
- [ ] The `--clean` flag is NOT used (it destroys Podfile customizations in the gitignored `ios/` directory — see memory `feedback_no_expo_prebuild_clean`).

## Implementation Notes

- Run from the main checkout: `npx expo prebuild` (no flags beyond `--platform ios` if iOS-only for now).
- If the prebuild modifies `ios/Podfile` or `android/build.gradle` in a way that conflicts with existing customizations (MLKit fat-binary patch, strip-push-entitlement plugin), investigate before committing.
- The `EXPO_PUBLIC_SENTRY_DSN` env var is currently unused (no DSN configured). No traffic is sent until it's set. Add it to `.env.example` as a documented-but-empty entry.
- Reference: `docs/DEV_SETUP.md` for iOS Simulator setup.

## Dependencies

- PR #288 merged ✓
- Must be done on the main checkout (not a worktree) — `ios/` and `android/` are gitignored.
- **Blocked by [[P1-2026-06-02-ios-build-nitromodules-jsi-failure]]** — AC #3 (`expo run:ios` builds) and the live-DSN error test cannot complete until the iOS native build is fixed (discovered 2026-06-02; unrelated to Sentry).

## Risks

- `expo prebuild` may conflict with the MLKit fat-binary Podfile hook added for iOS 26 simulator support (see memory `project_ios26_simulator_fix`). Inspect diffs carefully.

## Updates

### 2026-05-31

- Created from PR #288 review deferred warning. Executor worktrees can't run prebuild.

### 2026-05-31 (prebuild verified on main checkout — AC partially met)

Ran `npx expo prebuild --platform ios --no-install` on the main checkout during a `/todo` follow-up:

- ✅ `prebuild` exits 0 (`✔ Finished prebuild`), no errors.
- ✅ **MLKit Podfile customization preserved** — `ios/Podfile` is byte-identical to the pre-prebuild backup (125 lines); the iOS-26 `patch-mlkit-simulator.py` `post_install` hook survives. This was the main risk (memory `project_ios26_simulator_fix`).
- ✅ `package.json` unchanged (`✔ Updated package.json | no changes`).
- ⚠️ Sentry plugin warns `Missing config for organization, project` — set Sentry org/project (or `EXPO_PUBLIC_SENTRY_DSN` + the SENTRY\_\* upload vars) before relying on source-map upload at build time.
- ℹ️ Note: `@sentry/react-native` v7 initializes via JS `Sentry.init()` + an Xcode build phase, so don't expect a literal `SentrySDK.start` edit in `AppDelegate.swift` — confirm Sentry's Xcode build phase appears after `pod install` instead.

**Remaining (needs a real machine + eyes — keep this todo open):**

- [ ] `cd ios && pod install` (watch for MLKit fat-binary patch running) — was skipped here via `--no-install`.
- [ ] `npx expo run:ios` builds and launches in the simulator without errors.
- [ ] Trigger a test error and confirm it reaches Sentry (native crash capture + source maps).
- [x] Document `EXPO_PUBLIC_SENTRY_DSN` (done — `docs/DEV_SETUP.md` "Mobile Client" section; see Updates 2026-05-31 below).

### 2026-05-31 (`EXPO_PUBLIC_SENTRY_DSN` documented — doc AC met; native verification still pending)

Completed via a `/todo` run on this file. The three native-build checkboxes above can't be done by an automated executor (no `ios/` in a worktree, no Xcode/Simulator, no live DSN to test against), so they stay open for a hands-on pass on the main checkout.

- ✅ **Documented `EXPO_PUBLIC_SENTRY_DSN`** in `docs/DEV_SETUP.md` → "Mobile Client" block, as a documented-but-empty entry. Chose DEV_SETUP.md over a literal `.env.example` because no `.env.example` exists in this repo and no tooling copies one to `.env`; DEV_SETUP.md is the project's established tracked env-var documentation (avoids drift). The reporter (`client/lib/reporter.ts`) is a no-op until the DSN is set, so no traffic flows pre-deploy.
- ➕ Also documented the source-map upload companion vars (`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `SENTRY_URL`) — names verified against the installed `@sentry/cli` package. Without them, native crashes still report but stack frames aren't symbolicated.

**Still needs a real machine + eyes (keep this todo `backlog`):**

```bash
# Run from the main checkout (not a worktree — ios/ is gitignored):
cd ios && pod install        # watch for the MLKit fat-binary patch (project_ios26_simulator_fix)
cd .. && npx expo run:ios    # builds + launches in the Simulator
# Then set EXPO_PUBLIC_SENTRY_DSN to a real DSN, trigger a test error,
# and confirm it lands in Sentry (native crash capture + source maps).
```

### 2026-06-02 (read-only native-edit audit on main checkout — AC #2 splits iOS ✅ / Android ❌)

`/todo` run on the main checkout (`ios/` + `android/` present from the earlier prebuild). Inspected the on-disk native dirs **without** a build or DSN:

- ✅ **iOS config-plugin edits present.** `ios/OCRecipes.xcodeproj/project.pbxproj` has both Sentry build phases: the RN bundling phase wraps `react-native-xcode.sh` with `@sentry/react-native/scripts/sentry-xcode.sh` (source-map upload at build time), plus a dedicated **"Upload Debug Symbols to Sentry"** phase (`sentry-xcode-debug-files.sh`). `ios/sentry.properties` exists. No `SentrySDK.start` in `AppDelegate` — **expected** for `@sentry/react-native` v7.2.0 (installed version confirmed); v7 uses JS `Sentry.init()` + the Xcode build phase, not a native AppDelegate edit.
- ❌ **Android config-plugin edits MISSING.** No Sentry refs in `android/build.gradle`, `android/app/build.gradle`, `android/settings.gradle`, `android/gradle.properties`, or `android/app/src/main`; no `android/sentry.properties`. Root cause: the earlier prebuild was `--platform ios` only (see Update above), so `android/` never received the Sentry Gradle integration. **Fix:** run `npx expo prebuild --platform android` (NO `--clean`) on the main checkout, then re-verify the Sentry Gradle plugin lands.
- ℹ️ Hard blocker unchanged: the "trigger a test error → reaches Sentry" AC needs a **live `EXPO_PUBLIC_SENTRY_DSN`** (none configured anywhere; `client/lib/reporter.ts` is a no-op until set). Cannot close this todo until a real Sentry project/DSN exists. This is deploy-gated observability infra (no prod deployment yet).

**Not dispatched to an executor:** worktrees are gitignored-blind to `ios/`/`android/`, have no `.env`, no Xcode, no Simulator — an executor could only report "blocked." The remaining work is main-checkout + hands-on only.

### 2026-06-02 (Android prebuild + iOS `pod install` done; `expo run:ios` FAILED on unrelated NitroModules/JSI error)

Advanced on the main checkout (user chose "go as far as possible"):

- ✅ **Android Sentry integration applied.** `npx expo prebuild --platform android --no-install` added `apply from: …/sentry.gradle` to `android/app/build.gradle:84` + generated `android/sentry.properties`. Diffed vs. a pre-run backup — only that line changed; root `build.gradle`/`settings.gradle`/`gradle.properties` byte-identical. AC #2 Android half ✅.
- ✅ **iOS `pod install` done.** Installed `RNSentry (7.2.0)` + native `Sentry (8.56.1)` pods → iOS Sentry integration now fully materialized at the CocoaPods level (was the gap from the earlier `--no-install` run). Xcode recognized both Sentry build phases (warned they run every build — benign). MLKit fat-binary patch confirmed wired as a build-phase Run Script. **Note:** this `pod install` also bumped several Expo pods to match current `node_modules` (`ExpoModulesCore 3.0.29→3.0.30`, `ExpoSpeech 13.1.7→14.0.8`, `ExpoImage 3.0.10→3.0.11`, etc.).
- ❌ **`npx expo run:ios` FAILED** (iPhone 16e sim, `--no-bundler`). `xcodebuild` error 65, 3 errors — all in RN's JSI/Nitro C++ layer: `ios/Pods/Headers/Private/NitroModules/JSIConverter.hpp:8` (`unknown type name 'namespace'`, i.e. a C++ header compiled outside an Objective-C++/C++20 context) and `React-jsi/jsi/jsi.h:10` (`<cassert> file not found`). **Sentry compiled clean** (SentryError.mm et al.) — the break is UNRELATED to Sentry. Possible contributor: the Expo pod bumps above (JSI/Nitro version skew). AC #3 (`expo run:ios` builds & launches) NOT met — blocked on this JSI build break, not on Sentry.

**To close this todo (all hands-on, main checkout):**

1. **Fix the iOS build** — resolve the NitroModules/React-jsi C++ error (error 65). Separate from Sentry; likely a pod/JSI version-skew or C++ standard / Objective-C++ compile-context issue. Try `pod deintegrate && pod install` or align Expo SDK pod versions; worst case `npx pod-install` after a clean `node_modules`.
2. **Set Sentry env** in `.env` (main checkout): `EXPO_PUBLIC_SENTRY_DSN` (public, bundled into client), plus build-time `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` (secret — NO `EXPO_PUBLIC_` prefix) for dSYM/source-map upload. Both `sentry.properties` files fall back to these env vars.
3. **Build + trigger a test error** → confirm it lands in Sentry (native crash capture + symbolicated frames). `client/lib/reporter.ts` is a no-op until `EXPO_PUBLIC_SENTRY_DSN` is set; it has no `__DEV__` guard, so a DSN in local `.env` activates Sentry in dev too — remove it after the test (or keep it only in the production/EAS build env) to avoid dev-noise issues in Sentry.
