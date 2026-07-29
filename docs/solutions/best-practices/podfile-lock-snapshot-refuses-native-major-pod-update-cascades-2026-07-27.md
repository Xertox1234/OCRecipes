---
title: Podfile.lock is a snapshot constraint — pod install REFUSES a transitive native-major bump, and pod update crosses it one cascading conflict at a time
track: knowledge
category: best-practices
tags: [cocoapods, native-build, ios, dependencies, lockfile, mlkit, visioncamera, version-pinning]
module: shared
applies_to: ["ios/Podfile", "ios/Podfile.lock", "package.json"]
symptoms: ["pod install fails with 'could not find compatible versions' naming a version that IS in the snapshot", "The error says 'In snapshot (Podfile.lock)' and points at the version you are trying to move off", "An npm bump succeeded but pod install refuses to follow it", "pod update <pod> fixes the first conflict and immediately surfaces a second one on a sibling pod", "CocoaPods suggests 'run pod update <POD> to apply changes you've made' and it is literally correct"]
created: '2026-07-27'
---

# `Podfile.lock` is a snapshot constraint — `pod install` REFUSES a transitive native-major bump

## Rule

When an npm bump raises a **native** dependency across a major, `pod install`
will not follow it. It fails with `could not find compatible versions`, quoting
the old version as coming `In snapshot (Podfile.lock)`. This is **not** a broken
lockfile and not a reason to delete `Podfile.lock` or re-run `pod install
--repo-update`.

Cross it deliberately, naming **the whole family** in one command:

```bash
pod update GoogleMLKit MLKitVision MLKitBarcodeScanning \
           MLKitTextRecognition MLKitTextRecognitionCommon MLKitCommon
```

Then assert the resolved versions against an explicit list. Never eyeball the
diff.

## Why this is the safety property, not the bug

`pod install` holds every pod at its locked version and only resolves what it
must. That is precisely what prevents a routine `npm install` from silently
dragging the app across a native major — a change that cannot be validated by
CI here, because **CI has no native build step**.

Note the deliberate contrast with the npm layer, which behaves the *opposite*
way and is documented in
[a lockfile-only hold is not a pin](../conventions/lockfile-only-version-hold-is-not-a-pin-2026-07-25.md):

| | Holds on re-resolution? | Failure mode |
|---|---|---|
| `package-lock.json` | **No** — yields silently | You cross a boundary you meant to hold |
| `Podfile.lock` | **Yes** — refuses loudly | You are blocked from a bump you meant to make |

Same word, opposite hazards. A `package-lock.json` hold is a coincidence you
must replace with a real pin; a `Podfile.lock` hold is a gate you must open on
purpose. Reaching for the npm-layer intuition ("the lockfile is just cached
state, regenerate it") is how people end up deleting `Podfile.lock` and
resolving a far larger, unreviewed native diff.

## The cascade — one `pod update` is usually not enough

Unlocking the pod named in the error frees only *that* pod's subtree. A sibling
still pinned by the snapshot produces the **next** conflict, and the transcript
looks like you made no progress. Concretely (2026-07-27, MLKit 8 → 9):

```
# Round 1 — pod install
[!] could not find compatible versions for pod "GoogleMLKit/BarcodeScanning":
  In snapshot (Podfile.lock):  GoogleMLKit/BarcodeScanning (= 8.0.0)
  In Podfile: VisionCameraBarcodeScanner ... depends on GoogleMLKit/BarcodeScanning (= 9.0.0)

# Round 2 — pod update GoogleMLKit  (GoogleMLKit now free; MLKitVision is not)
[!] could not find compatible versions for pod "MLKitVision":
  In snapshot (Podfile.lock):  MLKitVision (= 9.0.0, ~> 9.0)
  ... GoogleMLKit/BarcodeScanning (= 9.0.0) -> MLKitBarcodeScanning (~> 8.0.0) -> MLKitVision (~> 10.0)
```

Read the **resolved dependency chain** CocoaPods prints in the error — it names
every pod that must move. Enumerate the family from the lock and pass them all
at once instead of discovering them one round-trip at a time:

```bash
grep -oE '^  - (GoogleMLKit|MLKit)[A-Za-z/]* \([0-9.]+\)' ios/Podfile.lock | sort -u
```

Expect transitive drift beyond the family you named. Here `MLKitCommon 14.0.0`
additionally pulled `GoogleUtilities` 8.1.0→8.1.2, `MLImage` beta7→beta8, and
`PromisesObjC` 2.4.0→2.4.1. Those are legitimate cascade, but they must be
**noticed and stated**, not discovered later.

## Assert the result as a list, including what must NOT change

The point of the assertion list is the *unchanged* rows as much as the changed
ones. In this upgrade the load-bearing assertion was:

```
RNMLKitTextRecognition (5.0.1)   UNCHANGED
RNMLKitCore            (3.1.0)   UNCHANGED
```

Those OCR pods resolved against MLKit **9** without a version bump, because
their podspec declares `GoogleMLKit/TextRecognition` with **no version
constraint**. An unpinned transitive dependency adds no constraint — and,
equally important, **does not force the maximum**: in the preceding PR the same
unpinned podspec sat happily on root 8.0.0.

## `post_install` runs silently — verify by artifact, never by clean console

A native-major bump changes the framework set, which is exactly when a
`post_install` hook that walks frameworks can raise. In `ios/Podfile` the MLKit
block (`:141-193`) is **not** rescue-wrapped, so a raise there aborts the
remaining hooks — including the VisionCamera Swift-settings block (`:204-211`)
that prevents a Release-only LLVM optimizer crash. `pod install` still prints a
normal-looking success.

Worse, the skipped setting is **invisible to a local build**: Debug is `-Onone`
anyway, so the app compiles fine and the crash first appears in an EAS Release
archive. Check the artifacts:

```bash
# MLKit block ran — must be 0
grep -rl "EXCLUDED_ARCHS\[sdk=iphonesimulator\*\]" ios/Pods/Target\ Support\ Files/ | wc -l
# VisionCamera block ran — must be 4 (2 targets x Debug+Release)
grep -c "SWIFT_COMPILATION_MODE = singlefile" ios/Pods/Pods.xcodeproj/project.pbxproj
```

Note the second one lives in `Pods.xcodeproj` target build settings, **not** in
an xcconfig — the Podfile writes it via `config.build_settings[...]`. Looking
for it in the xcconfig and finding nothing reads as a failure when it is not.

## Verifying the simulator build actually proved something

On an arm64-only iOS 26 simulator, the evidence that
`scripts/patch-mlkit-simulator.py` handled the *changed* framework set is the
**absence of a link error**, not the exit code:

```bash
grep -c 'building for iOS Simulator, but linking in object file built for iOS' build.log  # must be 0
```

A green build from *before* the bump is not evidence for the bump — it covered a
different framework set. Re-run it.

## Exceptions

- A pod family that genuinely moves as a set (VisionCamera's shared generated
  Nitro specs) must be updated together or not at all — never update one member
  to "test" the bump.
- If `pod update` produces drift in pods unrelated to the family you named, stop
  and read it rather than committing. Unbounded drift usually means a pod was
  named too broadly.

## Related Files

- `ios/Podfile.lock` — the snapshot that refuses
- `ios/Podfile` — the un-rescued `post_install` MLKit block (`:141-193`) and the VisionCamera Swift settings it can silently skip (`:204-211`)
- `scripts/patch-mlkit-simulator.py` — re-tags MLKit fat binaries per platform on every build; self-selects, so a framework-set change needs no edit but does need re-verification
- `todos/P2-2026-07-25-mlkit-9-unblock-visioncamera-511.md` — the upgrade that surfaced this

## See Also

- [A lockfile-only version hold is not a pin](../conventions/lockfile-only-version-hold-is-not-a-pin-2026-07-25.md) — the npm layer, which behaves the opposite way
- [A library's auto-capability default can fail the whole operation](../logic-errors/library-auto-capability-default-fails-whole-operation-2026-07-25.md) — the defect this upgrade was the root fix for; its Resolution section records which half upstream fixed
- [VisionCamera 5 upgrade — iOS Xcode 26 build](visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md) — the prior native upgrade in this same family
- [Verify lockfile churn semantically, never by git diff line count](../conventions/verify-lockfile-churn-semantically-not-by-diff-line-count-2026-06-23.md) — why the assertion list beats eyeballing the diff
