<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Migrate to Expo CNG: port the hand-made native fixes into app.json/config plugins, then stop committing android/ios"
status: backlog
priority: medium
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [architecture, ios, build]
github_issue:

---

# Migrate to Expo CNG: port the hand-made native fixes into app.json/config plugins, then stop committing android/ios

## Summary

Owner ruling 2026-10-11: adopt Continuous Native Generation (CNG) — `app.json` + config plugins
become the single source of truth and the committed `android/`/`ios/` folders go away. Before the
folders can be dropped, every hand-made native change that a clean `npx expo prebuild` would lose
must be re-expressed as config (`app.json`, `expo-build-properties`) or a local config plugin.

## Background

Decision recorded in `todos/archive/P3-2026-09-29-expo-cng-vs-committed-native-folders-decision.md`
(reverses the 2026-09-30 "keep the folders for now" deferral). `npx expo-doctor` has failed its
"app config fields that may not be synced in a non-CNG project" check since the 2026-09-23 audit
because both `app.json` native properties and committed native folders exist; edits to the listed
`app.json` properties silently do nothing on native builds today.

A 2026-09-30 probe (`npx expo prebuild --clean --no-install` in a throwaway worktree, diffed vs
`acc4553`, files only) found what a clean prebuild drops. Native commits since then
(`git log --since=2026-09-30 -- ios android`: #1248, #1249, #1256, 0d086c1a, 0735a4ce, #1351)
added more. Known list as of 2026-10-11 — **re-run the probe first; this list is a starting
point, not a guarantee**:

From the 2026-09-30 probe:

1. Podfile `post_install` fmt `FMT_USE_CONSTEVAL` patch — Xcode 26 builds fail without it (#725).
2. Podfile MLKit arm64-simulator re-tag + VisionCamera-family `singlefile`/`-Onone` Swift 6.2 ICE
   workaround (Release/EAS archive crash), and the `alwaysOutOfDate` script phases (#441).
3. iOS deployment target 16.0 (prebuild reverts to 15.1) — Podfile, pbxproj, Podfile.properties.json.
4. `ios.buildReactNativeFromSource: true` (Podfile.properties.json).
5. `ios/OCRecipes/PrivacyInfo.xcprivacy` — API-reason entries plus the collected-data
   declarations added in #1248 (App Store requires it).

Added since the probe (found by reading the commits, not by a prebuild run):

6. Google sign-in URL scheme (`CFBundleURLTypes` → `com.googleusercontent.apps.302305066915-…`)
   in `ios/OCRecipes/Info.plist` (#1351). `modules/google-sign-in` has no config plugin.
7. Podfile `pod 'GoogleUtilities', :modular_headers => true` and
   `pod 'RecaptchaInterop', :modular_headers => true` (#1351 — GoogleSignIn 10 / AppCheckCore).
8. `com.apple.developer.applesignin` entitlement (0d086c1a). The `expo-apple-authentication`
   plugin only writes it when `ios.usesAppleSignIn: true` is set; `app.json` does not set it.

Already carried by `app.json` (should survive; verify in the diff): `ITSAppUsesNonExemptEncryption`,
camera/mic/photo/speech usage strings, icon, splash, expo-updates URL/runtimeVersion, expo-iap,
Sentry, `plugins/strip-push-entitlement.js`. Android diff was cosmetic in the 2026-09-30 probe.

## Acceptance Criteria

- [ ] Re-run `npx expo prebuild --clean --no-install` in a throwaway worktree, diff against main,
      and reconcile the result with items 1–8 above (add anything new).
- [ ] Items 3–5 and 8 expressed via `expo-build-properties` / `ios.privacyManifests` /
      `ios.usesAppleSignIn` (or the nearest supported config).
- [ ] Items 1, 2, 6, 7 expressed via local config plugin(s) under `plugins/` (or the Google
      module's own `app.plugin.js` for 6–7), each with a unit test of the plugin's mod output.
- [ ] A second clean prebuild produces native projects with no functional diff vs the committed
      folders (cosmetic/ordering diffs listed in the PR body).
- [ ] `android/` and `ios/` removed from git and added to `.gitignore`; `npx expo-doctor` passes
      the non-CNG sync check.
- [ ] Docs/scripts that assume committed native folders updated (e.g. `docs/DEV_SETUP.md`,
      any script or CI step reading `ios/`/`android/` paths; runtimeVersion bump procedure).
- [ ] **Owner step:** new EAS/dev-client build from the generated projects, installed and smoke-
      tested on the device (camera scan, Apple + Google sign-in, IAP sandbox, push off). An agent
      does not run the EAS build.

## Implementation Notes

- Do the port and the folder removal as separate PRs if that keeps review small: PR 1 adds the
  config/plugins while the folders are still committed (prove via prebuild diff); PR 2 deletes
  the folders.
- The `runtimeVersion` copies in `ios/OCRecipes/Supporting/Expo.plist` and
  `android/.../strings.xml` were hand-bumped in 0735a4ce — with CNG they come from `app.json`
  only; any runtimeVersion bump procedure that edits them must be updated.
- Native change ⇒ a new runtime/binary; OTA cannot deliver it. Coordinate with the owner's
  build schedule.
- Android can't be device-tested (Apple-only hardware); verify Android by prebuild diff only.

## Scope Contract

- **Mechanisms to use:** `expo-build-properties`, `app.json` `ios.*` fields, local config plugins
  in `plugins/` (pattern: `plugins/strip-push-entitlement.js`).
- **Files in scope:** `app.json`, `package.json`/`package-lock.json` (for `expo-build-properties`),
  `plugins/**`, `modules/google-sign-in/app.plugin.js` (new, if used), `.gitignore`, `ios/**`,
  `android/**` (deletion), `docs/DEV_SETUP.md`, scripts/CI that reference native folder paths.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Owner availability for the native build + device test.

## Risks

- A missed hand fix only shows up at build time or on device (e.g. the Swift ICE only in Release
  archive builds) — the prebuild diff is the main guard; the Release archive build is the backstop.
- Removing the folders is hard to undo cleanly; keep PR 2 (deletion) until PR 1's generated
  output is proven equivalent.

## Updates

### 2026-10-11

- Created from the CNG decision todo after the owner chose to adopt CNG. Items 6–8 found by
  reading `git log --since=2026-09-30 -- ios android`, not by a prebuild run.
