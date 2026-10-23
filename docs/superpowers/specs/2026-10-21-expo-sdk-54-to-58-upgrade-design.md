# Expo SDK upgrade, 54 → 58, one SDK at a time

Date: 2026-10-21 · Status: owner rulings recorded 2026-10-21 (§9); spec-reviewed
2026-10-22 (approve-with-edits; corrections folded in and listed in §11)

## 1. Goal

Move the app from Expo SDK 54 (React Native 0.81, React 19.1) to Expo SDK 58
(React Native 0.88, React 19.3). Do it in four steps, one SDK each, so a
breakage can be traced to the release that caused it. Expo's upgrade guide
recommends upgrading "incrementally, one at a time"
(docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough).

Why now:

- **Version lag.** 54 direct dependencies are a full major version behind.
  About 40 of them are `expo-*` packages, which only move together with the
  SDK.
- **Security findings.** `npm audit --omit=dev` (2026-10-21) reports 47
  findings: 30 high, 17 moderate, 0 critical. Most of the high ones sit under
  `expo`, `expo-updates` and `react-native`, in Metro, the Jest transitives,
  `braces`/`micromatch` and `node-forge`. Their only fix is a newer SDK.
- **A temporary exception that never ended.** `expo-notifications` and
  `expo-application` already run SDK-55 majors under an
  `expo.install.exclude` exception
  (`todos/archive/P2-2026-09-23-expo-sdk54-native-module-version-skew.md`).
  That todo says to remove the exception "the next time an EAS native build
  is cut".

**Platform scope:** iOS only. The owner has no Android device. Android must
keep compiling, but no Android runtime check is promised. CI (`ci.yml`)
builds no native code for either platform, so Android only compiles when an
EAS build is cut. The EAS builds after steps 1, 3 and 4 therefore build both
platforms (`--platform all`). §8 lists the Android-only risks.

## 2. What each SDK changes, and what it touches in this app

The facts come from the Expo repo's `sdk-compatibility.json`, the package
CHANGELOGs, the `bundledNativeModules.json` of each `expo` tarball, and the
React Native release blogs. They were checked on 2026-10-21; §10 lists the
sources. "Hits" counts were re-taken at HEAD `867aa105` (2026-10-22), from shipped
code only (test files excluded).

| SDK    | Released   | RN / React        | iOS min / Xcode  | Changes that hit this app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ---------- | ----------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **55** | 2026-02-25 | 0.83 / 19.2.0     | 15.1 / ≥26.2     | The legacy architecture is removed, so the `newArchEnabled` key goes away (we already run the new architecture). Expo packages switch to version numbers that match the SDK, which ends the expo-notifications/application exception. The `EXNotifications` pod is renamed `ExpoNotifications` (no references in `plugins/` or `modules/`).                                                                                                                                                                                                                                                                                                                                                                                                           |
| **56** | 2026-05-20 | 0.85 / 19.2.3     | **16.4** / ≥26.4 | **Hermes V1 is the default engine.** `expo/fetch` becomes the global `fetch`. The iOS JSI layer moves to Swift `ExpoModulesJSI`, so third-party native modules must not depend on the old types. RN 0.85 removes `StyleSheet.absoluteFillObject` (**14 hits in 12 files**). `@expo/vector-icons` stops coming bundled with `expo` (we already list it as a direct dependency). **Known regression:** Hermes V1 + worklets memory use, fixed in `expo@57.0.17`.                                                                                                                                                                                                                                                                                        |
| **57** | 2026-06-30 | 0.86 / 19.2.3     | 16.4 / ≥26.4     | Small release: "no user-facing changes" in `expo`, and no breaking changes in RN 0.86. Requires Node ≥22.13 (we run 24). Reanimated 4.5 / worklets 0.10.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **58** | 2026-09-29 | 0.88 / **19.3.0** | 16.4 / ≥26.4     | Picks up RN 0.87's breaking changes, because SDK 58 skips 0.87: **`InteractionManager` is removed (5 `runAfterInteractions` calls in 2 files; their tests mock it in 8 places)**, the strict TypeScript API becomes the default, and `useColorScheme()` can return `null` (its only caller, `client/hooks/useTheme.ts:30`, already falls back to `?? "light"` at line 37). **gesture-handler 3** (6 `Gesture.*()` builder calls in 5 files, including the camera's focus/zoom; 3.x still accepts them, see §2.2). **Sentry RN 8**. Reanimated 4.7 / worklets 0.13. **expo-notifications now shows notifications that arrive while the app is open unless `setNotificationHandler` says otherwise** (we never call it). Android: AGP 9, compileSdk 37. |

### 2.1 Native code we own that every step must re-check

These are the parts most likely to break. In CI they fail only at prebuild or
pod-install time, and some only in an EAS or Release archive:

| Piece                                            | What to re-check each step                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugins/ios-podfile-fixes.js`                   | Its `mergeContents` anchors (`require 'json'`, `post_install do \|installer\|`) still match the new Podfile template. If an anchor is missing it throws, so a mismatch fails loudly at prebuild.                                                                                                                                                                                     |
| `plugins/ios/ocrecipes_post_install.rb`          | (a) The deployment-target floor sweep must move from 16.0 to **16.4** at SDK 56. (b) The fmt-11 `FMT_USE_CONSTEVAL` fix for Xcode 26: check whether the RN version bundled by the new SDK still pins the broken fmt. Drop the fix once it no longer applies, rather than carrying dead patches. (c) The hook for the MLKit simulator re-tagger (`scripts/patch-mlkit-simulator.py`). |
| `expo-build-properties` in `app.json`            | `deploymentTarget: "16.0"` becomes `"16.4"` at SDK 56. Keep `buildReactNativeFromSource: true` until the MLKit `EXCLUDED_ARCHS` workaround is gone (context in `docs/solutions/best-practices/visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md`). From SDK 56 on, the Expo CHANGELOG also makes it a requirement for opting out of Hermes V1.                                  |
| `patches/react-native-vision-camera+5.1.1.patch` | Its file name pins 5.1.1. Moving to VisionCamera 5.2.x means the patch either no longer applies or is no longer needed. Check whether upstream already passes `RawPropsParser(true)`, and delete the patch or regenerate it.                                                                                                                                                         |
| `patches/query-string+7.1.3.patch`               | Make sure it still applies. Patch-package fails loudly if it doesn't.                                                                                                                                                                                                                                                                                                                |
| `modules/google-sign-in`                         | It uses `ExpoAppDelegateSubscriber`, not the `EXAppDelegateWrapper` that SDK 55 removes, and none of the JSI types that SDK 56 removes. Re-check that the podspec builds at the 16.4 minimum.                                                                                                                                                                                        |
| `plugins/strip-push-entitlement.js`              | It deletes `aps-environment` from the entitlements plist through `withEntitlementsPlist`, so the SDK 55 pod rename can't reach it. Check only that prebuild output still has no `aps-environment`. While this plugin is in `app.json`, iOS can't register for remote push, so no step can test a push token (§5). Removing it is a provisioning decision outside this spec.          |
| `metro.config.js` (`getSentryExpoConfig`)        | Unchanged up to SDK 57. Re-check against the Sentry 8 migration guide at SDK 58.                                                                                                                                                                                                                                                                                                     |
| `babel.config.js`                                | babel-preset-expo forks away from `@react-native/babel-preset` at SDK 56. Make sure `module-resolver` and `react-native-reanimated/plugin` still run in that order. For Reanimated 4, the worklets plugin may need to replace the reanimated plugin; check the Reanimated docs for the version in use.                                                                               |

### 2.2 Third-party native packages, which move in step with the SDK

| Package                                               | Now                   | Plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reanimated / worklets                                 | 4.3.1 / 0.8.3         | Keep them through SDK 56; their peer range covers RN 0.81–0.85. Go to 4.5.x / 0.10.x at SDK 57 and 4.7.x / 0.13.x at SDK 58. **VisionCamera's frame processors use worklets, so worklets and VisionCamera move in the same commit.**                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| VisionCamera + barcode-scanner, Nitro modules / image | 5.1.1 / 0.35.6 / 0.14 | Go to the latest 5.2.x / Nitro 0.37 at SDK 57, when worklets 0.10 forces it, or earlier if SDK 56's JSI change breaks Nitro's build. Which RN versions they support is **unverified** (their GitHub releases could not be reached), so the build is the test.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@infinitered/react-native-mlkit-text-recognition`    | 5.0.1 (latest)        | No new release. Its tarball is pure Swift on `ExpoModulesCore` and uses none of the JSI types removed in SDK 56, so it is probably fine. It also has an open high advisory with no fixed version, which this upgrade does not clear.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@sentry/react-native`                                | ~7.2                  | Go to ~7.11 for SDKs 55–57 and to 8.x (≥8.16, which fixes the RN 0.87+ iOS build) at SDK 58. Follow the v7→v8 migration guide; it needs Sentry CLI v3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| react-native-gesture-handler                          | ~2.28                 | Use the version bundled with each SDK up to 57. At SDK 58, move to 3.x **without** migrating the 6 builder calls. Checked in the 3.4.0 tarball (2026-10-22): `Gesture.*` is still exported (deprecated), and v3's `GestureDetector` hands builder gestures to its `LegacyGestureDetector`. `ReanimatedSwipeable` (`SwipeableRow.tsx`) still ships as a subpath. One catch: v3's root export `TextInput` is the new component (the old one is now `LegacyTextInput`), and three files import `type { TextInput }` from it (§3 step 4). Migrating to the hook API is a later todo, not part of this upgrade. The `legacy` tag (2.33.x) stays as the fallback if the camera gestures break on device. |
| keyboard-controller, screens, safe-area-context       | —                     | Use the versions bundled with each SDK (`npx expo install --fix`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `expo-speech-recognition`                             | 3.1.1                 | Use its SDK tags (`sdk-55` 3.1.3, then 56.x, then 58.x).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `expo-iap`                                            | 3.4.8                 | **Out of scope; it gets its own spec** (§9 ruling 4, `2026-10-21-expo-iap-3-to-6-upgrade-design.md`). It lands as its own PR right after step 3 (SDK 57), before step 3's EAS build. If 3.4.8 won't build at step 1 or 2, it moves forward to that step. Never upgrade IAP as a side effect of an SDK PR.                                                                                                                                                                                                                                                                                                                                                                                          |

## 3. Plan, step by step

Every step is **one PR into `main`**. It must pass the 8 required CI checks,
plus the checks in §5, before it merges.

### Step 0: JavaScript-only prep, still on SDK 54 (ships over the air)

Remove the RN 0.85/0.87 breaking changes while the app is still on the
current runtime. That way the native steps carry no JS rewrites, and each
change reaches the owner's device over the air on the existing build.

1. Replace the 14 `StyleSheet.absoluteFillObject` uses with
   `StyleSheet.absoluteFill`, or an explicit
   `{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }` where
   the code spreads it.
2. Replace the 5 `InteractionManager.runAfterInteractions` calls
   (`QuickLogScreen.tsx:176`; `MealPlanHomeScreen.tsx:1005/1013/1029/1167`)
   with what RN 0.87 recommends (`requestIdleCallback`, or a plain
   `setTimeout` after the navigation `transitionEnd` event). Keep the
   ordering each call site depends on, and test that ordering first (TDD).
   The tests that mock `InteractionManager` (`MealPlanHomeScreen.test.tsx`,
   `AddItemMenuSheet.test.tsx`) change with them. Update the comments that
   name it (`AddItemMenuSheet.tsx:39`, `MealPlanHomeScreen.tsx:699`) too.
3. Add an explicit `Notifications.setNotificationHandler` that pins **today's**
   foreground behaviour, so SDK 58's new default doesn't change what users
   see. The owner ruled to keep them off (§9 ruling 2): the handler returns
   no banner, no list entry, no sound and no badge change for notifications
   that arrive while the app is open. A test asserts that.
4. Add `npx expo-doctor` to CI as an information-only step that never fails
   the build. Each step can then compare its doctor output with the one
   before.

### Step 1: SDK 55 (RN 0.83, React 19.2)

- `npm install expo@^55`, then `npx expo install --fix`. Keep reanimated and
  worklets on their current versions (see §2.2), by passing `exclude` for
  this step only.
- Remove the `expo.install.exclude` exception from `package.json`: the
  version scheme now matches SDK 55. Remove `newArchEnabled` from `app.json`.
- Bump `runtimeVersion` in `app.json` (§6).
- Re-check every row in §2.1.
- **Ship:** cut an EAS preview build and install it on the owner's iPhone.
  This is the first native build since SDK 54, and it also confirms the
  release pipeline (EAS Build, EAS Update, Sentry upload) still works.

### Step 2: SDK 56 (RN 0.85, Hermes V1, iOS 16.4)

- Raise the deployment target to 16.4 in `expo-build-properties` and in the
  floor sweep in `ocrecipes_post_install.rb`.
- Bump `runtimeVersion` even though no build is cut (§6). Without it, an
  `update:preview` from `main` would send SDK-56 JavaScript to the SDK-55
  build on the owner's phone.
- `expo/fetch` becomes the global `fetch`. It reaches only the three uploads
  that build `FormData` with React Native's `{ uri, name, type }` file objects
  and post it with `fetch`: **menu scan** (`useMenuScan.ts`), **cook-session
  photo** (`useCookSession.ts`) and **receipt scan** (`useReceiptScan.ts`).
  Smoke-test those three. Photo analysis, label, avatar and cookbook cover go
  through `uploadAsync` from `expo-file-system/legacy` (`client/lib/photo-upload.ts`,
  `useAvatarUpload.ts`, `client/lib/cookbook-cover-upload.ts`). The global
  `fetch` swap doesn't touch them, and `./legacy` is still exported in
  `expo-file-system` 58.0.10. Chat streaming uses `XMLHttpRequest`
  (`useChat.ts`, `useCoachStream.ts`), so the switch doesn't touch it either.
- Watch the build for VisionCamera/Nitro/MLKit compile errors caused by the
  `ExpoModulesJSI` change.
- **Don't ship:** this step builds and passes the §5 checks on the simulator
  and on a device via `expo run:ios`, but gets no EAS release, because of the
  Hermes V1 + worklets memory regression that `expo@57.0.17` fixes. Step 3
  follows straight after.

### Step 3: SDK 57 (RN 0.86), pinned to `expo@>=57.0.17`

- Reanimated 4.5 / worklets 0.10, VisionCamera 5.2.x / Nitro 0.37 and the
  VisionCamera patch decision, all in one commit.
- The expo-iap 3 → 6 PR (its own spec) merges here, after this step's PR and
  before the build.
- **Ship:** EAS preview build, then about a week of daily use on the owner's
  device before step 4. Run the expo-iap spec's §5 checks on this build (the sandbox ones only once App Store Connect can serve the subscription). This is the fallback point if SDK 58 goes badly.

### Step 4: SDK 58 (RN 0.88, React 19.3)

- Fix the typecheck errors from the strict TypeScript API. CI's
  `check:types` lists them.
- gesture-handler 3, without migrating the builder calls (§2.2). Check:
  the camera gestures (`CameraView.tsx`, `CameraView.ios.tsx`,
  `useCameraFocusAndZoom.ts`), `Toast.tsx`'s swipe, the `MealPlanHomeScreen.tsx`
  pan, `SwipeableRow.tsx` (`ReanimatedSwipeable`), and the `type { TextInput }`
  imports in `FocusBottomSheetTextInput.tsx`, `QuickAddSheet.tsx` and
  `SimpleEntrySheet.tsx`. Those should point at `LegacyTextInput`, or at RN's
  `TextInput`, whichever the refs actually hold. If the camera gestures break
  on device, stay on the `legacy` tag. When the hook API migration happens
  later, add `useTapGesture`/`usePanGesture`/`usePinchGesture` to
  `WORKLET_CALLBACK_HOOKS` in `scripts/worklet-directive-guard.ts`.
  Otherwise the worklet guard silently stops checking those callbacks
  (`docs/rules/react-native.md`).
- Sentry 8 migration, Reanimated 4.7 / worklets 0.13.
- The notification handler from step 0 already pins foreground behaviour.
  Confirm it.
- **Ship:** EAS preview build, then production when the owner decides.

Each step can stop on its own. If a step fails and the fix is out of reach,
the previous step is a working, shippable app.

## 4. Things this spec does not do

- `expo-iap` 3 → 6 (its own spec, because it involves payments).
- Major bumps that don't depend on the SDK: `zod` 4, `openai` 7,
  `typescript` 7, `vitest` 5, `eslint` 10, `@sentry/node` 11,
  `@apple/app-store-server-library` 3. They're server-side or tooling, and
  each gets its own todo.
- Breaking up large files, or any refactor the upgrade doesn't need.
- Android runtime verification.

## 5. Checks for each step

CI covers lint, types, unit tests and coverage. It doesn't build native code
or run the app, so every step also needs:

1. `npx expo-doctor`: clean, or each remaining warning written up in the PR.
2. `npx expo prebuild --clean && npx expo run:ios` on the simulator, then a
   **Release** build on the owner's iPhone. Some Xcode 26 fixes only show
   up in Release builds (see the podfile plugin's docstring).
3. The Maestro flows under `e2e/flows/` on the iOS simulator, run locally
   before the PR merges, plus `/verify-ui` on the main tabs. The
   `e2e-regression.yml` workflow runs the same flows nightly on `main` after
   the merge. It doesn't gate the PR, but its native iOS build is the only CI
   build of native code, so check the first nightly run after each step
   merges.
4. A manual smoke list on the device, done in the same order at every step:
   - barcode scan (VisionCamera + MLKit barcode)
   - nutrition-label OCR (`recognizeTextFromPhoto`, MLKit text)
   - photo analysis upload, receipt scan, avatar upload
   - camera tap-to-focus and pinch-zoom (gesture-handler)
   - coach chat streaming
   - Liquid Glass back buttons and the tab bar (iOS 26)
   - Apple and Google sign-in
   - IAP: on a Release build, the paywall loads with no crash. Do the
     sandbox purchase and restore once App Store Connect can serve the
     subscription (see the expo-iap spec §5)
   - notification permission, and a deep link from a tapped local
     notification. Remote push tokens can't be tested while
     `strip-push-entitlement` is in `app.json` (§2.1)
   - receiving an OTA update on the new runtime
   - a Sentry test event whose stack trace shows source file names
5. `npm audit --omit=dev` before and after, with the numbers in the PR body.

## 6. OTA and runtime versions

`runtimeVersion` is a fixed string (`"1.5.0"`) in `app.json`. Every SDK step
changes native code, so **every step's PR bumps `runtimeVersion` in the same
commit**, including step 2, which ships no build (e.g. `2.0.0` at SDK 55,
`3.0.0` at SDK 56, `4.0.0` at SDK 57, `5.0.0` at SDK 58).
Otherwise `npm run update:preview`/`update:production` would push new JS to
binaries built on SDK 54, and they would crash.

Before step 1 merges, tag the last SDK-54 commit `sdk54-final`. Any urgent fix
for users still on a 1.5.0 build gets published from a branch off that tag.
Do the same for every step that shipped a build: tag `sdk55-final` before step
2 merges, and `sdk57-final` before step 4 merges. The OTA scripts bundle the
local tree, so a fix for an older runtime is published from a checkout of its
tag's branch, never from `main`.

## 7. Rollback

- Before it ships: revert the PR.
- After it ships: the earlier EAS build is still in EAS and TestFlight, and
  its runtime still receives OTA updates from the `sdk54-final` branch (or
  the branch for the last shipped step).

## 8. Risks

| Risk                                                                        | Likelihood | Mitigation                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VisionCamera / Nitro doesn't build on RN 0.85+                              | Medium     | The build in step 2 shows it. Fall back to the latest 5.2.x, or wait at SDK 55 for an upstream fix.                                                                                                                                                                                       |
| Hermes V1 memory regression                                                 | Known      | Never ship SDK 56; pin `expo@>=57.0.17`.                                                                                                                                                                                                                                                  |
| `expo/fetch` breaks a multipart upload                                      | Medium     | Smoke-test the three `fetch` + `FormData` uploads in step 2 (menu scan, cook-session photo, receipt scan). If one breaks, move it onto the existing `uploadAsync` helper in `client/lib/photo-upload.ts`, which the other uploads already use. Don't add a second `fetch` implementation. |
| gesture-handler 3 breaks camera focus/zoom                                  | Medium     | Stay on the `legacy` 2.33.x tag and migrate later.                                                                                                                                                                                                                                        |
| An Xcode 26 build fix in our plugins stops applying, or is no longer needed | Medium     | The anchors throw when they don't match. Delete fixes that no longer apply, with evidence.                                                                                                                                                                                                |
| expo-iap 3.4.8 won't build on a new SDK                                     | Unknown    | Do the expo-iap upgrade first, following its own spec (§9 ruling 4), then resume the SDK step.                                                                                                                                                                                            |
| Android-only breakage (edge-to-edge, AGP 9, compileSdk 37)                  | Unknown    | The EAS Android build must succeed; runtime behaviour isn't checked (no device).                                                                                                                                                                                                          |
| The MLKit text-recognition advisory                                         | Stays open | Out of reach here (no fixed version upstream); recorded in each step's audit numbers.                                                                                                                                                                                                     |

## 9. Owner rulings (2026-10-21)

1. **How far to go: plan for SDK 58.** SDK 57 stays a release that can stay
   in place if step 4 goes badly.
2. **Notifications that arrive while the app is open: leave them off.** Step
   0 pins that behaviour, so SDK 58's new default (show them) never reaches
   users.
3. **When to cut builds: EAS preview builds after steps 1, 3 and 4.** Step 2
   (SDK 56) is checked on the simulator and the device via `expo run:ios`
   only.
4. **expo-iap: its own plan, written now.** See
   `docs/superpowers/specs/2026-10-21-expo-iap-3-to-6-upgrade-design.md`.
   It decides where in this sequence the IAP upgrade lands.

## 10. Sources

- Expo `sdk-compatibility.json`, and the CHANGELOGs for `expo`,
  `expo-modules-core`, `expo-build-properties`, `expo-notifications`,
  `expo-file-system`, `babel-preset-expo`, `@expo/cli` and
  `@expo/config-plugins` (github.com/expo/expo, `main`, 2026-10-20).
- The `bundledNativeModules.json` file in the `expo` 55/56/57/58 tarballs
  (registry.npmjs.org).
- React Native release blogs for 0.85, 0.86, 0.87 and 0.88 (reactnative.dev).
- docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough.
- Sentry React Native v7→v8 migration guide and CHANGELOG.
- The gesture-handler `upgrading-to-3` guide.
- The expo.dev SDK 55–58 release posts couldn't be fetched from this
  environment. The two facts taken from search summaries of them, the
  removal of the `newArchEnabled` key and the fix version for the Hermes
  regression, are marked as such in the research notes. Re-confirm both
  when step 1 starts.

## 11. Spec review, 2026-10-22

Verdict: **approve-with-edits**. The design is unchanged. These corrections,
checked against HEAD `867aa105` and the upstream tarballs, are folded in above:

- **`runtimeVersion` at step 2 (§6, step 2).** The old example skipped SDK 56,
  and that would have let an OTA send SDK-56 JavaScript to the SDK-55 build.
  Every step now bumps, and each shipped step gets a `sdkNN-final` tag.
- **Which uploads `expo/fetch` reaches (step 2, §8).** Only menu scan,
  cook-session photo and receipt scan use `fetch` with `FormData`. Photo,
  label, avatar and cookbook cover use `uploadAsync`. The fallback is that
  helper, not a second `fetch`.
- **The `InteractionManager` count (§2, step 0).** It's 5 calls in 2 files, not
  17 in 3. The 17 included comments and test lines.
- **gesture-handler 3 (§2.2, step 4).** Now checked: 3.4.0 runs the builder
  API unchanged. Step 4 takes 3.x without a migration, but checks the
  `TextInput` type imports and `SwipeableRow`.
- **CI and native builds (§1, §5).** CI builds no native code. Android compiles
  only in the EAS builds, and the nightly e2e run is the only CI-side iOS
  build.
- **Push (§2.1, §5).** `strip-push-entitlement` keeps iOS from registering for
  remote push, so the smoke list tests local notifications and deep links
  instead.

Reviewer's calls, for the owner to check:

- The three `fetch` + `FormData` uploads were **not** moved into step 0. They
  get smoke-tested at step 2 and move onto `uploadAsync` only if they break,
  because rewriting working uploads is a refactor this upgrade doesn't need
  (§4).
- The gesture-handler hook API migration is deferred to a later todo.
