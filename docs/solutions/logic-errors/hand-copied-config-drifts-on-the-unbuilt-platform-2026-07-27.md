---
title: A config value hand-copied into per-platform native files drifts on the platform nobody builds locally
track: bug
category: logic-errors
module: shared
severity: high
tags: [expo, eas-update, ota, runtime-version, ios, android, native-build, config-drift, prebuild, cross-platform, verification, tooling]
symptoms: ['A config bump is merged and the diff looks complete, but one platform behaves as if it never happened', 'OTA updates apply on iOS and silently never arrive on Android (or vice versa) — no error, no crash, just "no update available"', 'The source-of-truth file and a generated native file disagree, and nothing in CI notices', 'A value is correct in `app.json` but stale in `Expo.plist` / `strings.xml`, sometimes for days', 'The platform that drifted is the one no one runs locally']
applies_to: [app.json, ios/OCRecipes/Supporting/Expo.plist, android/app/src/main/res/values/strings.xml, scripts/__tests__/runtime-version-parity.test.ts]
created: '2026-07-27'
---

# A config value hand-copied into per-platform native files drifts on the platform nobody builds locally

## Problem

A value declared once in a source-of-truth config only takes effect after being
copied into **per-platform native files**. In a committed-native Expo project,
`runtimeVersion` is the canonical case:

| Declared in | Must also appear in |
| --- | --- |
| `app.json` → `expo.runtimeVersion` | `ios/OCRecipes/Supporting/Expo.plist` → `EXUpdatesRuntimeVersion` |
| | `android/app/src/main/res/values/strings.xml` → `expo_runtime_version` |

Normally `expo prebuild` regenerates those from `app.json`. **This project never
runs prebuild** — `ios/` and `android/` are committed, and prebuild would clobber
the MLKit / build-from-source Podfile ([[feedback_no_expo_prebuild_clean]]). So
nothing derives them. The sync is a manual three-file edit.

PR #728 swapped the OCR native module and correctly bumped `app.json` to `1.1.0`.
It touched neither native file. The bump reviewed clean, merged, and left Android
pinned at `1.0.0` on `main`.

The one-file diff is what makes this invisible. A bump to `app.json` alone is
*shaped like a complete change* — it is the file a reviewer expects to see, and
the two native files are ones reviewers mentally file under "generated, don't
read."

## Symptoms

- OTA updates apply on one platform and never on the other. `runtimeVersion` is a
  **compatibility fence**: a build at rtv X never receives an update published at
  rtv Y, and expo-updates reports "no update available" — no error, no log.
- The drift survives review because the two stale files never appear in the diff.
- **The platform that drifts is the one nobody builds locally.** Here iOS was
  bumped by hand during a device rebuild; Android, which is rarely run on this
  machine, was not. The manual sync happens as a side effect of doing work on a
  platform, so the neglected platform is exactly the one that rots.

## Root Cause

Two conditions have to hold, and both did:

1. **The invariant spans files that no tool reconciles.** Prebuild is the tool
   that would, and it is deliberately disabled. Nothing replaced it.
2. **The invariant was documented in prose but not enforced.** The correct
   procedure was already written down verbatim — *"edit `runtimeVersion` in
   app.json AND `EXUpdatesRuntimeVersion` AND `expo_runtime_version` together"* —
   and it still did not happen. Prose does not fail a build.

A documented multi-file invariant with no check is a latent bug with a delay
fuse. It holds exactly as long as everyone remembers, and it fails silently the
first time someone doesn't.

That this is a *recurring shape* rather than a one-off was confirmed on the spot:
when the fix was written, open PR #729 carried `app.json` at `1.2.0` with **both**
native files still at `1.0.0` — the same mistake, doubled, already in flight.

## Solution

Convert the prose invariant into a parity test. It is a handful of lines, runs in
milliseconds, and needs no fixtures — it reads the real files:

```ts
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function declaredRuntimeVersion(): string {
  return JSON.parse(read("app.json")).expo.runtimeVersion;
}

it("matches expo_runtime_version in the Android strings.xml", () => {
  expect(androidRuntimeVersion()).toBe(declaredRuntimeVersion());
});
```

Three details make it actually load-bearing rather than decorative:

- **Guard the extractor, not just the value.** Each reader is a regex over real
  file text. A regex that stops matching returns `undefined`, and
  `expect(undefined).toBe("1.1.0")` fails — so a silently-broken reader cannot
  masquerade as a pass. (See
  [gate-test-needs-two-sided-negative-control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md).)
- **Assert the indirection you depend on.** `AndroidManifest.xml` references
  `@string/expo_runtime_version` rather than inlining a literal. If it ever
  inlines one, checking `strings.xml` stops describing what ships — so pin the
  reference:

  ```ts
  expect(manifest).toContain(
    'android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="@string/expo_runtime_version"',
  );
  ```

- **Assert the shape of the source of truth.** `runtimeVersion` may legally be a
  *policy object* (`{"policy": "appVersion"}`) instead of a string, in which case
  the native values derive from `version` and the equality asserts would be
  wrong. Check `typeof === "string"` so the test fails loudly if that changes,
  rather than asserting something false.

Do **not** widen the fix beyond the invariant. `android/app/build.gradle`
`versionName` also read `1.0.0`, but that is the *app version* and correctly
tracks `app.json` `version` — a different value that merely looked the same.

## Prevention

- **When a value must be hand-copied to N places, write the parity check in the
  same PR that establishes the invariant** — not after it breaks. The check is
  almost always cheaper than the prose explaining the procedure.
- **Ask which platform nobody exercises locally.** In any cross-platform repo,
  manual per-platform steps decay asymmetrically. The one you don't run is the
  one that is already wrong ([[feedback_cross_platform]]).
- **Distrust a one-file diff for a multi-file invariant.** On review, the question
  is not "is this change correct?" but "is this change *complete*?" A bump to a
  declarative config should prompt: what generated artifacts carry this value,
  and are they in the diff?
- **Disabling a code generator creates an ongoing obligation.** Opting out of
  prebuild was the right call here, but it silently transferred prebuild's job to
  humans. Whenever a generator is switched off, the invariants it used to
  maintain need an explicit owner — ideally a test.

## Related Files

- `app.json` — `expo.runtimeVersion`, the source of truth (no `eas.json` policy,
  no `app.config.*` to shadow it)
- `ios/OCRecipes/Supporting/Expo.plist` — `EXUpdatesRuntimeVersion`
- `android/app/src/main/res/values/strings.xml` — `expo_runtime_version`
- `android/app/src/main/AndroidManifest.xml` — references the string resource
- `scripts/__tests__/runtime-version-parity.test.ts` — the enforcing test

## See Also

- [in-place-dep-patch-survives-reinstall-teardown-false-green](in-place-dep-patch-survives-reinstall-teardown-false-green-2026-07-26.md) — sibling native-build trap: a verification step that cannot fail in the scenario it was written for
- [lockfile-only-version-hold-is-not-a-pin](../conventions/lockfile-only-version-hold-is-not-a-pin-2026-07-25.md) — same family: an intent recorded only in a derived artifact is not enforced
- [duplicated-flag-composition-desyncs-display-surfaces](duplicated-flag-composition-desyncs-display-surfaces-2026-07-24.md) — the in-code version: one value maintained in two places, updated in one
- [gate-test-needs-two-sided-negative-control](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — why the extractor itself must be able to fail
