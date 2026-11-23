# Expo SDK Upgrade — Steps 1–4 (SDK 55 → 58) Runbook

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This is a runbook, not a TDD plan.** Each step is a dependency move whose breakages are only known once the build runs, so each task is: bump → fix what the compiler/build names → run the fixed checks → ship (or not). Where a step adds behaviour (push), it has a test.

**Goal:** Move the app from Expo SDK 54 to SDK 58 one SDK per PR, each PR leaving `main` a working, shippable app.

**Architecture:** Four PRs into `main` (55, 56, 57, 58), each in its own worktree, each bumping `runtimeVersion`. The expo-iap upgrade lands as its own PR between step 3's merge and step 3's EAS build (`docs/superpowers/plans/2026-10-22-expo-iap-3-to-6-upgrade.md`).

**Tech Stack:** Expo SDK 55–58, React Native 0.83–0.88, EAS Build/Update, CocoaPods, Xcode ≥26.2 (55) / ≥26.4 (56+).

**Spec:** `docs/superpowers/specs/2026-10-21-expo-sdk-54-to-58-upgrade-design.md` (§2, §2.1, §2.2, §3 Steps 1–4, §5, §6, §7, §9, §11)

## Global Constraints

- Prerequisite: step 0 (`2026-10-22-expo-sdk-upgrade-step-0-js-prep.md`) is merged and on the owner's device.
- One PR per SDK; each passes the 8 required CI checks **and** the §5 checks below before merge.
- **Every** step bumps `app.json` `runtimeVersion` in the same commit: `2.0.0` (55), `3.0.0` (56), `4.0.0` (57), `5.0.0` (58).
- Tags, created on `main` **before** the next step's PR merges: `sdk54-final` (before step 1), `sdk55-final` (before step 2), `sdk57-final` (before step 4).
- Pin `expo@>=57.0.17` at step 3 (Hermes V1 + worklets memory fix). Never ship an SDK 56 build.
- iOS only at runtime; Android must compile in each EAS build (`--platform all`), no runtime check.
- **Owner-run only** (agents never execute): `eas build`, `eas credentials`, `npm run update:preview|update:production`, App Store/TestFlight actions, Railway variable changes.
- Each step in its own worktree via `scripts/oc-worktree.sh`; `npm install` / `npx expo install` run only there, never in the main checkout.
- Never upgrade expo-iap inside an SDK PR (spec §2.2).

## Review Focus

1. A JS change merged to `main` between steps lands on an older build via OTA → crash. Guard: the runtime bump + tags; check in each task's "Ship" step that `update:preview` is run only from the right checkout.
2. A Podfile-plugin anchor or Xcode-26 fix silently stops applying → Release-only build break. Guard: §2.1 commands below run per step, and the Release device build is mandatory.
3. VisionCamera frame processors + worklets version skew → camera crash on open. Guard: worklets and VisionCamera move in the same commit (step 3); camera smoke items.
4. Multipart uploads under `expo/fetch` (step 2) → menu scan / cook-session photo / receipt scan fail with a 4xx or empty body. Guard: those three smoke items at step 2.
5. Push from step 1 on: token registers but deep link on tap opens the wrong screen, or foreground pushes appear. Guard: the push smoke items + step 0's handler.

## The per-step check list (§5) — referenced by every task as "Run §C"

- [ ] **C1** `npx expo-doctor > <scratchpad>/doctor-sdkNN.txt`; diff against the previous step's file; every remaining warning written up in the PR body.
- [ ] **C2** `npx expo prebuild --clean` then the §2.1 checks:
  - `grep -n "ocrecipes_post_install" ios/Podfile` → 2 hits (require + call); prebuild throws if an anchor is missing.
  - `grep -n "IPHONEOS_DEPLOYMENT_TARGET" ios/Pods/Pods.xcodeproj/project.pbxproj | sort -u | head` after `pod install` → nothing below the step's floor (16.0 at 55, 16.4 from 56).
  - `grep -c "aps-environment" ios/*/*.entitlements` → `1` from step 1 on.
  - `npx patch-package --check` (or `npm run postinstall` output) → both patches apply, or the VisionCamera patch is deleted with a note (step 3).
  - fmt check: `grep -n "'fmt'" node_modules/react-native/third-party-podspecs/fmt.podspec node_modules/react-native/third-party-podspecs/*.podspec 2>/dev/null; grep -rn "spec.version" node_modules/react-native/third-party-podspecs/fmt.podspec` → if fmt is past `11.0.2`, delete the `FMT_USE_CONSTEVAL` block in `plugins/ios/ocrecipes_post_install.rb` and prove a clean Release build without it.
- [ ] **C3** `npx expo run:ios` (simulator), then a **Release** build on the owner's iPhone (`npx expo run:ios --device --configuration Release`, owner at the device).
- [ ] **C4** Maestro: `maestro test e2e/flows/` on the simulator (local, before merge); `/verify-ui` on Home, Plan, Coach, Profile. After merge, check the first nightly `e2e-regression.yml` run.
- [ ] **C5** Device smoke list, in this order (owner at the device, Release build): barcode scan · nutrition-label OCR · photo analysis, receipt scan, menu scan, cook-session photo, avatar upload, cookbook cover · camera tap-to-focus and pinch-zoom · coach chat streaming · Liquid Glass back buttons and tab bar · Apple and Google sign-in · IAP sandbox purchase and restore (expo-iap spec §5) · notification permission, push token registration, a server-sent push and its deep link · an OTA update received on the new runtime · a Sentry test event with source file names.
- [ ] **C6** `npm audit --omit=dev` before and after; counts in the PR body.

---

### Task 1: Step 1 — SDK 55 (RN 0.83, React 19.2) + push on

**Files:**

- Modify: `package.json`, `package-lock.json`
- Modify: `app.json` (`runtimeVersion` → `"2.0.0"`; remove `newArchEnabled`; remove `"./plugins/strip-push-entitlement"` from `plugins`)
- Delete: `plugins/strip-push-entitlement.js` (and any test of it under `plugins/__tests__/`)
- Create: `plugins/__tests__/app-config.test.ts` (asserts that `app.json`'s plugins no longer list `strip-push-entitlement`)

- [ ] **Step 1 (owner, before the build):** `eas credentials` → iOS → production/preview → Push Notifications: let EAS create the APNs key. On Railway set `EXPO_ACCESS_TOKEN` and `EXPO_PUBLIC_PROJECT_ID`; confirm the server log no longer says "server-driven push notifications disabled" (`server/lib/env.ts:190`).
- [ ] **Step 2:** Re-confirm the two search-summary facts (spec §10): `newArchEnabled` key removal at 55, and the Hermes fix version `57.0.17`, from the expo CHANGELOG. Record the citation in the PR body.
- [ ] **Step 3:** Tag `sdk54-final` on current `main` (`git tag sdk54-final <sha> && git push origin sdk54-final`).
- [ ] **Step 4: Write the failing config test**

```ts
import appJson from "../../app.json";

it("does not strip the push entitlement", () => {
  const names = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  expect(names).not.toContain("./plugins/strip-push-entitlement");
});
```

Run: `npx vitest run plugins/__tests__/app-config.test.ts` → FAIL.

- [ ] **Step 5:** Bump: `npm install expo@^55` then `npx expo install --fix`. Add `react-native-reanimated` and `react-native-worklets` to `package.json` `expo.install.exclude` for this step (keep 4.3.1 / 0.8.3); **remove** `expo-notifications` and `expo-application` from that list.
- [ ] **Step 6:** Make the `app.json` edits and delete the plugin. Run `npx vitest run plugins/__tests__` → PASS.
- [ ] **Step 7:** `npx tsc --noEmit` and `npx vitest run` in the worktree; fix what they name.
- [ ] **Step 8:** Run §C1–C6. Specific to this step: VisionCamera/Nitro/MLKit, `modules/google-sign-in` and expo-iap 3.4.8 all build. **If expo-iap 3.4.8 fails to build, stop and run the expo-iap plan first** (spec §2.2 fallback).
- [ ] **Step 9:** Commit, PR, one review pass (`code-reviewer` + `mobile-reviewer`), merge.
- [ ] **Step 10 (owner):** EAS preview build for both platforms; install on the iPhone; re-run C5 on it, including a real push.

---

### Task 2: Step 2 — SDK 56 (RN 0.85, Hermes V1, iOS 16.4) — no release

**Files:**

- Modify: `package.json`, `package-lock.json`
- Modify: `app.json` (`runtimeVersion` → `"3.0.0"`; `expo-build-properties.ios.deploymentTarget` → `"16.4"`)
- Modify: `plugins/ios/ocrecipes_post_install.rb:18-19` (floor `16.0` → `16.4`, both the compare and the assignment) and its comment at `:11`
- Modify: `babel.config.js` only if Reanimated's docs for the installed version require `react-native-worklets/plugin` in place of `react-native-reanimated/plugin` (keep `module-resolver` first)

- [ ] **Step 1:** Tag `sdk55-final` on `main`.
- [ ] **Step 2:** `npm install expo@^56` then `npx expo install --fix`, keeping reanimated/worklets excluded (their peer range covers RN 0.85).
- [ ] **Step 3:** Make the `app.json`, `ocrecipes_post_install.rb` and (if needed) `babel.config.js` edits. Keep `buildReactNativeFromSource: true`.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx vitest run`; fix what they name. Watch the native build for `ExpoModulesJSI` errors from VisionCamera/Nitro/MLKit — if Nitro fails, pull its upgrade (step 3's VisionCamera 5.2.x / Nitro 0.37) forward into this PR.
- [ ] **Step 5:** Run §C1–C4 and C6; C5 on the `expo run:ios --configuration Release` device build, with the three `fetch` + `FormData` uploads (menu scan, cook-session photo, receipt scan) first. If one fails, switch that hook to `uploadAsync` from `expo-file-system/legacy` (`FileSystemUploadType.MULTIPART`, same field name and URL), the way `uploadPhotoForAnalysis` does at `client/lib/photo-upload.ts:113`. Add a test that the hook calls `uploadAsync` with that field name and URL. Never add a second `fetch`.
- [ ] **Step 6:** Commit, PR, review, merge. **No EAS build** (§9 ruling 3; Hermes regression). Step 3 starts straight after.

---

### Task 3: Step 3 — SDK 57 (RN 0.86), `expo@>=57.0.17`

**Files:**

- Modify: `package.json`, `package-lock.json` (`expo` `^57.0.17`; reanimated 4.5.x / worklets 0.10.x; VisionCamera + barcode-scanner 5.2.x; nitro-modules 0.37.x; nitro-image to the version VisionCamera 5.2.x peers)
- Modify: `app.json` (`runtimeVersion` → `"4.0.0"`)
- Modify or delete: `patches/react-native-vision-camera+5.1.1.patch`

- [ ] **Step 1:** `npm install expo@^57.0.17`, `npx expo install --fix`; **remove** reanimated/worklets from `expo.install.exclude`; bump worklets, reanimated and VisionCamera/Nitro **in one commit**.
- [ ] **Step 2: VisionCamera patch decision.** `grep -rn "RawPropsParser" node_modules/react-native-vision-camera/` — if upstream already passes `RawPropsParser(true)`, delete the patch; otherwise regenerate with `npx patch-package react-native-vision-camera`. Record which, with the grep output, in the PR body.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx vitest run` (incl. `scripts/__tests__/worklet-directive-guard.test.ts`); fix what they name.
- [ ] **Step 4:** Run §C1–C6.
- [ ] **Step 5:** Commit, PR, review, merge.
- [ ] **Step 6:** Run the expo-iap plan (its own PR) now — after this merge, before the build.
- [ ] **Step 7 (owner):** EAS preview build (both platforms); C5 on it, including the expo-iap §5 sandbox list; then about a week of daily use before Task 4.

---

### Task 4: Step 4 — SDK 58 (RN 0.88, React 19.3)

**Files:**

- Modify: `package.json`, `package-lock.json` (`expo@^58`; gesture-handler 3.x; `@sentry/react-native` `>=8.16`; reanimated 4.7.x / worklets 0.13.x)
- Modify: `app.json` (`runtimeVersion` → `"5.0.0"`)
- Modify: `client/components/FocusBottomSheetTextInput.tsx:3`, `client/components/meal-plan/QuickAddSheet.tsx:17`, `client/components/meal-plan/SimpleEntrySheet.tsx:17` (`import type { TextInput }` from gesture-handler → `LegacyTextInput`, or RN's `TextInput`, whichever the refs actually hold)
- Modify: `metro.config.js`, Sentry init — only what the Sentry v7→v8 migration guide requires
- Modify: whatever `tsc` names under the strict TypeScript API

- [ ] **Step 1:** Tag `sdk57-final` on `main`.
- [ ] **Step 2:** `npm install expo@^58`, `npx expo install --fix`; gesture-handler 3.x **without** migrating the 6 `Gesture.*` builder calls (3.4.0 routes them to `LegacyGestureDetector`).
- [ ] **Step 3:** Sentry 8: follow the v7→v8 migration guide (Sentry CLI v3); check `getSentryExpoConfig` in `metro.config.js`.
- [ ] **Step 4:** `npx tsc --noEmit` — fix the strict-API errors and the three `TextInput` type imports; `npx vitest run`.
- [ ] **Step 5:** Confirm step 0's handler is still the only `setNotificationHandler` call (`grep -rn setNotificationHandler client`) and that a push arriving in the foreground shows nothing on the device.
- [ ] **Step 6:** Run §C1–C6. If camera focus/zoom breaks on the device, switch gesture-handler to the `legacy` tag (2.33.x) in this PR and file a todo.
- [ ] **Step 7:** Commit, PR, review, merge. File a low todo: migrate the 6 builder calls to the hook API and add `useTapGesture`/`usePanGesture`/`usePinchGesture` to `WORKLET_CALLBACK_HOOKS` in `scripts/worklet-directive-guard.ts`.
- [ ] **Step 8 (owner):** EAS preview build; C5; production when the owner decides.
