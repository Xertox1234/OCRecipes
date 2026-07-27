---
title: "Resolve the GoogleMLKit 8→9 conflict blocking the VisionCamera 5.1.1 upgrade"
status: backlog
priority: medium
created: 2026-07-25
updated: 2026-07-27
assignee:
labels: [camera, dependencies, ios, ocr, native-build]
github_issue:
human_led: true
blocked_reason: "Criteria #1, #2, #3, #6 RESOLVED 2026-07-27 across two stacked PRs — #728 (OCR library swap) and #729 (VisionCamera 5.1.1 + GoogleMLKit 9), both OPEN, NEITHER auto-merge armed. #729's base is #728's branch, not main, because at main the old OCR package still pins GoogleMLKit 8.0.0; GitHub retargets it on #728 merge, and CI re-runs against a NEW merge base at that point — today's run is not the final word. Remaining work is device-only and unreachable by any autonomous executor: #4 real-label OCR end-to-end, #5 barcode on iOS AND Android (different code paths), #7 tap-to-focus, #8 useCameraDevice lens selection at barcode distance. A Release-configuration build also blocks #729 — the VisionCamera LLVM optimizer crash never manifests in local Debug."
---

# Resolve the GoogleMLKit 8→9 conflict blocking the VisionCamera 5.1.1 upgrade

## Summary

`react-native-vision-camera` cannot move off the pinned 5.0.11 because
`VisionCameraBarcodeScanner@5.1.1` requires `GoogleMLKit/BarcodeScanning = 9.0.0`
while `@react-native-ml-kit/text-recognition@2.0.0` pins
`GoogleMLKit/TextRecognition* = 8.0.0`. GoogleMLKit subspecs share one root
version, so the two cannot coexist and `pod install` fails outright.

## Background

Discovered 2026-07-25 while attempting the 5.1.1 bump that is the **root fix**
for the tap-to-focus defect worked around in PR #716 (merged as `e6ecf52c`).

PR #716 filters metering modes at the call site on iOS, which is a workaround
for upstream #3976. But VisionCamera 5.1.0 also shipped
[#3974 `Observe metering state before requesting changes`] and
[#3977 `Serialize metering KVO updates on queue`] — AVFoundation KVO
ordering/serialization races that **no JS-side change can reach**. Until the
bump lands, tap-to-focus can still fail intermittently even with #716 merged.

Exact failure from `pod install --project-directory=ios`:

```
[!] CocoaPods could not find compatible versions for pod "GoogleMLKit/BarcodeScanning":
  In snapshot (Podfile.lock):
    GoogleMLKit/BarcodeScanning (= 8.0.0)
  In Podfile:
    VisionCameraBarcodeScanner (from `../node_modules/react-native-vision-camera-barcode-scanner`)
      was resolved to 5.1.1, which depends on GoogleMLKit/BarcodeScanning (= 9.0.0)
```

### Already investigated — do not redo

- **The npm side needs no changes — but is NOT safely pinned.** Both
  `react-native-vision-camera` and `-barcode-scanner` publish 5.1.1. Peer deps
  are all `*`; `react-native-nitro-modules` (0.35.6) and
  `react-native-nitro-image` (0.14.0) do **not** need to move. The blocker is
  entirely at the CocoaPods layer.
  **⚠ Latent trap — MITIGATED 2026-07-26 (see Updates), not resolved.** Both
  packages are now exact-pinned to `5.0.11` in `package.json` (was `^5.0.11`,
  and the caret already permitted 5.1.1) and blocked at `>=5.1.0` in
  `.github/dependabot.yml`. Note the CocoaPods failure is loud, but it surfaces
  at native build time, not at `npm install` — and CI has no native build step,
  so a bump goes green in CI and only breaks on an EAS Build.
- **The MLKit 9 requirement starts at 5.1.0, not 5.1.1.** Verified against the
  published 5.1.0 podspec: `s.dependency 'GoogleMLKit/BarcodeScanning', '9.0.0'`.
  The `pod install` transcript below happens to name 5.1.1 because that is what
  the caret resolved to; there is **no safe 5.1.0 stepping stone** to try first.
- **`@react-native-ml-kit/text-recognition` has no MLKit 9 release.** Installed
  2.0.0 is the latest published version; its podspec hard-pins five subspecs at
  `8.0.0` (`RNMLKitTextRecognition.podspec:25-33`: TextRecognition, Chinese,
  Devanagari, Japanese, Korean).
- **Deployment target is NOT a blocker.** `GoogleMLKit` 9.0.0 requires iOS 15.5;
  `ios/Podfile.properties.json` already sets `"ios.deploymentTarget": "15.5"`.
  (The `'15.1'` in `ios/Podfile:21` is only the fallback when that key is absent.)
- **Dropping the barcode-scanner pod is NOT viable.** `CameraView.ios.tsx`
  already avoids it (uses `useObjectOutput` / AVFoundation metadata objects),
  but `CameraObjectOutput` is `@platform iOS` with no Android implementation —
  `CameraView.tsx` genuinely needs `useBarcodeScannerOutput` on Android. The
  VisionCamera family is also version-locked as a set (shared generated Nitro
  specs), so leaving `-barcode-scanner` at 5.0.11 while core goes to 5.1.1 is
  not a supported configuration.

## Acceptance Criteria

- [x] A decision is recorded on which option below is taken, and why
      — **Option 3**, decided 2026-07-27. See Updates.
- [x] `pod install` completes with `GoogleMLKit` resolved to a single root version
      — **satisfied at root 9.0.0 by PR 2**, verified against the regenerated
      `ios/Podfile.lock`: `GoogleMLKit/{MLKitCore,BarcodeScanning,TextRecognition}`
      all `(9.0.0)`.
      (PR 1 also satisfied this _literally_, at root 8.0.0 — the criterion was
      written assuming 9.0.0 was the only way to reach a single root, which it is
      not. It was deliberately left unticked then so PR 2 had to re-satisfy it.)
      Note `pod install` alone **refuses** this bump by design: `Podfile.lock` is
      a snapshot constraint, so crossing a native major requires an explicit
      `pod update GoogleMLKit MLKitVision MLKitBarcodeScanning
MLKitTextRecognition MLKitTextRecognitionCommon MLKitCommon`.
- [x] `react-native-vision-camera` + `-barcode-scanner` both at 5.1.1, with
      `ios/Podfile.lock` regenerated and committed — **done in PR 2** (`8f30a5f0`).
      Full resolved set: `MLKitBarcodeScanning` 7→8, `MLKitTextRecognition` 6→7,
      `MLKitTextRecognitionCommon` 5→6, `MLKitCommon` 13→14, `MLKitVision` 9→10.
      `RNMLKitTextRecognition (5.0.1)` and `RNMLKitCore (3.1.0)` are **unchanged**
      — they resolved against MLKit 9 without a version bump, which is the whole
      payoff of PR 1's unpinned podspec.
- [ ] OCR still works end-to-end: nutrition-label capture → `recognizeTextFromPhoto`
      → parsed macros (this is the app's core scan path — MLKit 9's
      TextRecognition API must be verified, not assumed compatible)
- [ ] Barcode scanning verified on **both** iOS and Android (iOS uses
      `useObjectOutput`, Android uses `useBarcodeScannerOutput` — different code paths)
- [x] iOS 26 simulator build still works (see the MLKit fat-binary risk below)
      — **RE-VERIFIED 2026-07-27 on PR 2, against the MLKit 9 framework set.**
      Full Debug build on a booted iPhone 17 (iOS 26): `** BUILD SUCCEEDED **`,
      **0 errors** (1197 warnings, 51,466 log lines), app binary `arm64`,
      `LatinOCRResources.bundle` present, and all 11 MLKit/VisionCamera pod
      products built — including `RNMLKitTextRecognition` and `RNMLKitCore`
      linking against MLKit 9 unchanged.
      The proof that `scripts/patch-mlkit-simulator.py` handled the **changed**
      framework set (MLKitVision 9→10 etc.) is that on an arm64-only simulator a
      failure to re-tag surfaces as a hard link error: zero occurrences of
      "building for iOS Simulator, but linking in object file built for iOS" and
      zero "excluded architecture" complaints.
      PR 1's green build was deliberately NOT carried forward as evidence here —
      it covered a different framework set.
      ⚠️ Still outstanding: a **Release-configuration** build. Local Debug is
      `-Onone`, so it cannot exercise the VisionCamera LLVM optimizer crash
      documented at `ios/Podfile:195-203`.
- [ ] Tap-to-focus re-verified on a physical device; then remove the
      `Platform.OS === "ios"` workaround branch in
      `client/camera/hooks/useCameraFocusAndZoom.ts` and its
      `supportedMeteringModes()` helper
      (`client/camera/hooks/useCameraFocusAndZoom-utils.ts`) — **but only the
      part upstream actually fixed.** The "delete when 5.1.1 lands" note scopes
      to #3976, the unconditional-AWB-append bug, which makes the _computed_
      mode set correct. It says nothing about the _empty_ set: iOS throws
      `"MeteringModes cannot be empty!"` by design
      (`HybridCameraController.swift:186-188`, a deliberate `guard`, not a
      defect), so a device supporting no metering at all still needs handling.
      Confirm 5.1.1's behavior for that case **before** dropping the
      `modes.length === 0` early return, or a no-metering device gets a
      guaranteed rejection plus a Sentry event on its first tap — the exact
      failure `docs/solutions/logic-errors/library-auto-capability-default-fails-whole-operation-2026-07-25.md`
      flags as load-bearing
      → **CODE HALF DONE in PR 2 (`8f30a5f0`); this box stays unticked pending
      the on-device pass.** The 5.1.1 source was read before editing, and it
      settled the question in both directions:
      • **#3976 confirmed fixed** — `getAllSupportedMeteringModes()` now gates
      `.awb` on `isWhiteBalanceModeSupported(...)` instead of appending it
      unconditionally, so the `options = { modes }` construction was removed.
      • **The empty-set guard was KEPT, and the note above was right to insist.**
      `HybridCameraController.swift:182-185` resolves
      `options.modes ?? getAllSupportedMeteringModes()` **first** and only then
      applies `guard !modes.isEmpty` — so passing no modes does **not** bypass
      the throw. `supportedMeteringModes()` therefore stays too; the earlier
      "remove the helper" wording is superseded.
      • **New:** the guard _cannot_ be made exact. Our `supports{Exposure,Focus}
  Metering` flags derive from `is*ModeSupported()`, while native reads
      `is*PointOfInterestSupported()`, and VisionCamera exposes no
      point-of-interest flag to JS. Only AWB agrees. Details in the solution
      doc's new Resolution section.
- [ ] `useCameraDevice` device selection re-verified — 5.1.0 shipped
      "Better `useCameraDevice(...)` including default Cameras" (#4053), a
      behavioral change to which physical camera gets picked

## Implementation Notes

Options, roughly in increasing order of cost:

1. **Wait for upstream.** File/track an issue on
   `@react-native-ml-kit/text-recognition` asking for an MLKit 9 release. Zero
   work, unbounded latency, and it's a small project — check its activity before
   betting on this.
2. **Patch the podspec locally** (`patch-package` or a `postinstall`) to move
   its five `8.0.0` pins to `9.0.0`. Cheapest path that unblocks today, but it
   asserts API compatibility across an MLKit major — verify
   `MLKitTextRecognition`'s Swift/ObjC surface actually didn't break, don't
   assume from a successful `pod install`.
3. **Replace `@react-native-ml-kit/text-recognition`** with a maintained
   alternative on MLKit 9, or with Apple's Vision framework via a small Expo
   module on iOS. Biggest change, removes the coupling permanently.

Risks/notes for whoever picks this up:

- **The MLKit fat-binary patcher is the sharpest edge.** `ios/Podfile:62-100`
  strips `EXCLUDED_ARCHS[sdk=iphonesimulator*]` and installs a
  `[MLKit] Patch for platform` build phase that runs
  `scripts/patch-mlkit-simulator.py` on **every build** to re-tag MLKit binaries
  per platform (iOS 26 simulators are arm64-only; MLKit ships arm64 tagged for
  device). An MLKit major bump can change framework layout/packaging and break
  that script. Budget time for it and re-read
  `docs/solutions/best-practices/visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md`.
- **Verification needs a native build, not OTA.** This is a native change; an
  OTA update cannot deliver or validate it.
  **Updated 2026-07-26 — the local iOS build is NO LONGER blocked.** The
  fmt-vs-clang-21 break was root-caused and fixed by a `post_install` patch in
  `ios/Podfile` (PR #725); a clean simulator build with fresh DerivedData now
  passes in ~5.5 min. So a **local simulator build covers Acceptance Criteria
  #2, #3 and #6** — only a Release archive / store build still needs EAS.
  Criteria #4, #5, #7 and #8 remain physical-device work regardless (real label
  photos, both barcode code paths, tap-to-focus, multi-lens selection).
  If a clean build fails on `consteval` in `fmt/format-inl.h` again, check
  whether that Podfile hook is still present and matching fmt's current source.
- Do **not** run `npm audit fix` while touching the lockfile — use `package.json`
  `overrides` per `project_dependabot_transitive_override_remediation`.

## Scope Contract

- **Mechanisms to use:** dependency version changes, a podspec patch via
  `patch-package`/`postinstall` **or** a library swap — whichever option is
  chosen and recorded. Removal of the now-obsolete iOS metering workaround.
- **Files in scope:** `package.json`, `package-lock.json`, `ios/Podfile.lock`,
  `.github/dependabot.yml` (the `>=5.1.0` ignore entries must be REMOVED as part
  of the real upgrade — see Updates 2026-07-26),
  `ios/Podfile` (only if the MLKit patch phase needs adjusting),
  `scripts/patch-mlkit-simulator.py`, `client/camera/hooks/useCameraFocusAndZoom.ts`,
  `client/camera/hooks/useCameraFocusAndZoom-utils.ts` and their tests, plus
  `client/camera/utils/recognizeTextFromPhoto.ts` if the OCR library is replaced.
- No unrelated camera refactors. Do not convert zoom to the declarative
  `<Camera zoom={...}>` prop while in here — it throws without
  `react-native-vision-camera-worklets` and kills the preview
  (`docs/solutions/runtime-errors/vision-camera-zoom-prop-requires-worklets-package-2026-07-14.md`).

## Dependencies

- None blocking, but PR #716 (merged) ships the interim workaround, so this is
  not urgent — it removes an intermittent-failure tail, not a hard breakage.

## Risks

- MLKit 9 may change the TextRecognition API surface. OCR is the app's core
  scan path; a silent accuracy regression here is worse than the focus bug this
  upgrade is meant to finish fixing. Verify against real label photos, not just
  a green build.
- The `patch-mlkit-simulator.py` pipeline is bespoke and load-bearing for iOS 26
  simulator builds. If MLKit 9 restructures its frameworks, this todo grows
  substantially.
- 5.1.0's `useCameraDevice` change could alter which physical camera is selected
  on multi-lens iPhones — relevant to the `minimumFocusDistance` / macro-lens
  behavior at barcode range. Verify close-range scanning explicitly.

## Updates

### 2026-07-25

- Initial creation. Discovered while attempting the 5.1.1 bump as the root fix
  for the PR #716 tap-to-focus defect; the bump was reverted cleanly (no commits
  made) once the MLKit conflict proved to be a dependency migration rather than
  a version bump.

### 2026-07-26 — latent trap mitigated; todo stays OPEN

A `/todo-fast` run stopped at the `human_led` gate as designed. Rather than
override it, the scope was narrowed by explicit human decision to **only** the
latent-trap mitigation flagged above. **No option 1/2/3 decision was made** —
Acceptance Criterion #1 is still open and still human-led.

**What changed** (branch `fix/pin-vision-camera-5-0-11`):

- `package.json`: `react-native-vision-camera` and
  `react-native-vision-camera-barcode-scanner` moved from `^5.0.11` to an exact
  `5.0.11`. Matches the file's existing convention (`react-native`,
  `react-native-keyboard-controller` are already exact-pinned).
- `package-lock.json`: regenerated with `npm install --package-lock-only` so
  `node_modules` was untouched and no unrelated resolution drift entered the
  diff. Only the root `packages[""].dependencies` range changed; `resolved`
  stayed 5.0.11.
- `.github/dependabot.yml`: two `ignore` entries at `>=5.1.0`, with the full
  rationale inline. This is the layer that matters for the remaining vector —
  the repo runs `open-pull-requests-limit: 0`, so version-update PRs were
  already off, but **security** updates bypass that limit and could otherwise
  bump into 5.1.x on any CVE.

**New finding, not in the original writeup:** the MLKit 9 requirement begins at
**5.1.0**, not 5.1.1 — verified against the published 5.1.0 podspec
(`s.dependency 'GoogleMLKit/BarcodeScanning', '9.0.0'`). Anyone hoping to take
5.1.0 as a smaller intermediate step should not bother.

**⚠ REVERT ME when doing the real upgrade.** The exact pins and the two
dependabot `ignore` entries are holding measures, not constraints to design
around. Undo both as the first step of whichever option is chosen; the carets
can go back to `^` once GoogleMLKit resolves to a single root version.

**Not verified, and out of the narrowed scope:** nothing native was built or
run. `ios/Podfile.lock` is untouched and still records
`GoogleMLKit/BarcodeScanning (8.0.0)` / `VisionCamera (5.0.11)`. No OCR,
barcode, tap-to-focus, or `useCameraDevice` verification was attempted — all of
it needs an EAS Build and a physical device.

> ⚠️ **The paragraph above is SUPERSEDED as of 2026-07-27** — see the next
> Updates entry. `ios/Podfile.lock` has since been regenerated and a local iOS
> simulator build succeeded (0 errors). `VisionCamera (5.0.11)` is still
> accurate and deliberate; "nothing native was built or run" is not.

### 2026-07-27 — DECISION: Option 3. Split into two PRs.

**Option 3 (replace the OCR library) is chosen.** Acceptance Criterion #1 closed.

**Option 1 (wait for upstream) is dead, not merely slow.**
`@react-native-ml-kit/text-recognition` is still `2.0.0`, last published
**2025-09-01** (~11 months stale); its repo `a7medev/react-native-ml-kit` last
committed 2025-09-06. There is no newer fork on npm.

**Option 2 (patch the podspec) was rejected** because it means carrying a
locally-forked podspec across an MLKit major, in a repo with no `patches/` or
`patch-package` infrastructure, and it leaves the coupling permanently in place.

**Replacement: `@infinitered/react-native-mlkit-text-recognition@^5.0.1`.** Its
podspec declares `GoogleMLKit/TextRecognition` with **no version constraint**,
so CocoaPods floats it to whatever root the barcode scanner demands. The
conflict dissolves by _removing_ a pin rather than replacing a technology — and
it makes the GoogleMLKit root version a free variable, which is what makes the
VisionCamera bump independently revertible.

Findings that made this cheap (all verified, not assumed):

- **The four script packs were dead weight.** `recognizeTextFromPhoto` never
  passed the `script` param, so it always ran `LATIN`. Infinite Red being
  Latin-only is not a capability loss — it deleted four unused MLKit binaries
  and four OCR resource bundles from the app.
- **No MLKit API break to absorb.** GoogleMLKit 8.0.0 → 9.0.0 TextRecognition
  Obj-C/Swift headers are byte-identical (`MLKTextRecognizer.h`,
  `MLKTextBlock.h`, diffed from the shipped tarballs).
- **The conflict is iOS-only.** Gradle resolves `com.google.mlkit:text-recognition`
  and `:barcode-scanning` as independent Maven coordinates — no shared-root
  constraint. Android needed no changes.
- **`scripts/patch-mlkit-simulator.py` needed zero changes** — it walks every
  `*.framework` under `ios/Pods` and self-selects; there is no framework list.

**PR 1 (this branch) — OCR library swap only.** VisionCamera deliberately stays
at 5.0.11 so the GoogleMLKit root stays 8.0.0 and any OCR regression has exactly
one suspect. Verified after `pod install`: `GoogleMLKit/* (8.0.0)`,
`MLKitVision (9.0.0)`, `VisionCamera (5.0.11)` all UNCHANGED;
`RNMLKitTextRecognition 2.0.0 → 5.0.1`; `RNMLKitCore (3.1.0)` added; all four
`MLKitTextRecognition{Chinese,Devanagari,Japanese,Korean}` pods removed.

**PR 2 (next) — VisionCamera 5.1.1 + MLKit 9**, plus the two REVERT ME holding
measures above and the iOS metering-workaround removal.

⚠️ **Correction to carry forward:** an unpinned dependency adds no constraint —
it does not force the maximum. `MLKitVision` stays at **9.0.0** in PR 1 (both
`MLKitTextRecognition 6.0.0` and `MLKitBarcodeScanning 7.0.0` declare `~> 9.0`)
and moves to 10.0.0 only in PR 2. Confirmed empirically against the regenerated
`Podfile.lock`.

**Two notes for PR 2's implementer:**

- npm nests `@infinitered/react-native-mlkit-core` under the text-recognition
  package rather than hoisting it. Expo autolinking discovers it fine (verified),
  but `ls node_modules/@infinitered/` will not show it.
- `npm install` emits `ERESOLVE overriding peer dependency` **warnings** (not
  errors) because `mlkit-core@3.1.0` ships Jest tooling as runtime
  `dependencies`, dragging in `react-test-renderer@17.0.2` against React 19. No
  `overrides` entry was needed: Infinite Red's shipped build has zero
  `@testing-library` imports, so Metro never bundles any of it. It is
  node_modules bloat, not app bloat — do not "fix" it speculatively.

### 2026-07-27 — PR 2 implemented: VisionCamera 5.1.1 + GoogleMLKit 9

Commit `8f30a5f0` on `feat/visioncamera-511-mlkit-9`. Criteria #2 and #3 closed.

**Branch is stacked on PR 1, not `main`.** The plan called for branching off
`main` after #728 merged, but that is not reachable: at `main` the old OCR
package still pins `GoogleMLKit/TextRecognition = 8.0.0`, so the bump reproduces
the exact conflict this todo exists to fix. The PR's base is
`feat/ocr-swap-infinitered-mlkit`; GitHub retargets it to `main` when #728
merges. Basing on `main` would also have shown PR 1's 454 additions in the diff.

**`pod install` refuses this bump — by design, and that is the safety property.**
`Podfile.lock` acts as a snapshot constraint, so it holds every pod at its locked
version and reports a conflict rather than silently crossing a native major. It
took an explicit `pod update GoogleMLKit MLKitVision MLKitBarcodeScanning
MLKitTextRecognition MLKitTextRecognitionCommon MLKitCommon`. (The same mechanism
is what kept the root at 8.0.0 throughout PR 1.) One `pod update GoogleMLKit`
alone is not enough — it cascades to a second conflict on `MLKitVision`, which is
snapshot-pinned at 9.0.0 while the new chain needs `~> 10.0`.

**Transitive drift beyond the plan's list**, all pulled by `MLKitCommon 14.0.0`:
`GoogleUtilities` 8.1.0→8.1.2, `MLImage` 1.0.0-beta7→beta8, `PromisesObjC`
2.4.0→2.4.1. `NitroImage` is now a declared pod dependency of
`VisionCameraBarcodeScanner 5.1.1` (matching its new npm peer dep; already
installed at 0.14.0). npm-side: `nitro-modules` 0.35.6 and `nitro-image` 0.14.0
did **not** move, as predicted. `project.pbxproj` is untouched this time.

**`post_install` verified by artifact, not by console silence.** `ios/Podfile:141-193`
is not rescue-wrapped, so a raise there would silently skip the VisionCamera
Swift-settings block at `:204-211` — and that block is what prevents the
Release-only LLVM optimizer crash. Confirmed: zero `EXCLUDED_ARCHS` left in any
xcconfig, `[MLKit] Patch for platform` phase intact, and **all four** VisionCamera
build configurations (both targets × Debug **and Release**) carrying
`SWIFT_COMPILATION_MODE=singlefile` / `-Onone` / `SWIFT_VERSION=5`. A local Debug
build is `-Onone` anyway, so it would have passed even if the hook had skipped —
which is exactly why the artifact check was necessary.

**Metering surgery: half out, half permanent.** See AC #7 above for the source
evidence. The `options = { modes }` construction is gone; the
`modes.length === 0` early return and `supportedMeteringModes()` both stay.

**Test correction — the plan was internally inconsistent here.** It asked for a
one-argument `focusTo({x,y})` call, an assertion of
`toHaveBeenCalledWith({x,y}, undefined)`, _and_ zero changes to the Android
block. Those cannot all hold: Vitest compares the whole arguments array, and the
Android cases already asserted arity 2 (they passed because `options` was
declared-but-unassigned on Android). Resolved toward the clean call site — one
argument, and **all four** assertions updated to match. Verified two-sided with a
temporary negative control: a 2-arg assertion does fail against the 1-arg call,
so these assertions genuinely guard a regression back to filtering rather than
passing vacuously. 22/22 green.

**Still blocking merge (device-only):** AC #4 OCR end-to-end, AC #5 barcode on
both platforms, AC #7 tap-to-focus on-device, AC #8 `useCameraDevice` lens
selection at barcode distance (~10–15 cm — 5.1.0's #4053 changed default camera
selection). A **Release-configuration** build is also required before merge; the
LLVM crash never manifests in local Debug.
