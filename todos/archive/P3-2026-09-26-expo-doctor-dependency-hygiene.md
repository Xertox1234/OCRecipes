---
title: "expo-doctor dependency hygiene — direct expo-modules-core, duplicate native modules, minor skews, and the non-CNG native folders decision"
status: done
priority: low
created: 2026-09-26
updated: 2026-09-29
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

- [x] Item 1: confirm nothing imports `expo-modules-core` directly (including config plugins and native code), then remove it if safe, or record why it stays.
- [ ] PARTIAL — Item 2: `npm dedupe` (or an equivalent lockfile change) removes the `expo-image-loader` duplicate. Record the `expo-constants` nesting as a known consequence of the SDK-55 exclusion. **Not applied** — `npm dedupe` re-resolved 81 unrelated package versions instead of a pure hoist; reverted. The `expo-constants` nesting IS recorded as a known consequence (see Updates). See Updates below for the full reasoning.
- [x] Item 3: for each skew, record "deliberate (why)" or align it. Any change that touches native modules must be flagged as needing a new build.
- [ ] Item 4: the user decides between the CNG and bare workflow. Record the decision; this is not an executor call. **Split out** to `todos/P3-2026-09-29-expo-cng-vs-committed-native-folders-decision.md` (human-led; needs the user's ruling) — see Updates below.

## Implementation Notes

- Every change here touches `package.json`/`package-lock.json`/`node_modules`. Do it only when no other `/todo` executor is running, because the worktrees share `node_modules` by symlink.
- Any native-module version change requires a new EAS build before further OTA updates (the user's device runs preview build 5, runtime 1.2.0).
- See `docs/solutions/conventions/expo-doctor-intentional-major-skew-exclude-2026-09-26.md` for how intentional skews are documented (`expo.install.exclude`).

## Scope Contract

- **Files in scope:** `package.json`, `package-lock.json`, and `app.json` (item 4, only after the user decides).

## Dependencies

- None

## Updates

### 2026-09-26

- Initial creation from #1106's triage.

### 2026-09-29

**AC #1 — DONE: removed `expo-modules-core` from `package.json` `dependencies`.**

Confirmed no direct import anywhere in scope before removing:

- App code / `shared/`: `grep -rn "expo-modules-core" client/ server/ shared/` finds only comments
  (`client/screens/settings-version-utils.ts:5`, a test mock, a test comment) — no `import`/`require`.
- Config plugins: `app.json`'s `expo.plugins` array and `plugins/strip-push-entitlement.js` — no reference.
- Native code: `grep -rl "ExpoModulesCore" ios/` hits only `ios/Podfile.lock` (a generated
  CocoaPods lockfile entry, not a source reference); `android/` has no hit at all.
- Patches (`patches/*.patch`) — no reference.

Why it's safe to remove even without an app-code import (per the solution doc's warning not to
declare "no imports" = "safe to remove" without checking the dependency graph too): `expo`
itself declares `"expo-modules-core": "3.0.30"` as a **regular** dependency
(`node_modules/expo/package.json`), and across the whole lockfile only the root package.json and
`expo` reference `expo-modules-core` in any dependency field — no `expo-*` native module
(`expo-application`, `expo-constants`, `expo-image`, `expo-haptics`, `expo-notifications`, …)
declares it as a dependency or peerDependency at all; they rely on it being present in
`node_modules` (the standard Expo-modules pattern — autolinking resolves it from disk, not from
each module's own `package.json`). `expo`'s own pin (`3.0.30`) exactly matches what was already
resolved under the root's `^3.0.29`, so after removal `npm install --package-lock-only
--ignore-scripts` re-resolves `node_modules/expo-modules-core` at the identical `3.0.30` via
`expo`'s dependency — verified with a version-set diff over the whole lockfile
(`compared 1371 package names, 0 changed`). **Needs a new build? No** — zero on-disk/runtime
change; only the top-level `dependencies` declaration and the lockfile's root-deps entry changed.
`git log -S'"expo-modules-core"' -- package.json` shows the only commit that ever touched this
key is the original scaffolding commit (`37eb403b`, "Photo Calorie Tracker with Today Dashboard")
— no recorded reason it was pinned directly, consistent with it being a leftover direct
declaration rather than an intentional pin.

expo-doctor before/after: "Check dependencies for packages that should not be installed
directly" — **failed → passed** (18 checks: 14/18 → 15/18 passed).

**AC #2 — PARTIAL / deferred: the `expo-image-loader` dedupe was attempted and reverted; NOT applied.**

`npm dedupe --package-lock-only --ignore-scripts` does not perform a pure hoist — it re-resolves
compatible-range versions across the whole tree against current registry metadata. Measured with
a version-set diff (per package name, ignoring tree position) between the pre- and post-dedupe
lockfiles: **81 package names changed version**, not just the two duplicates this AC targets —
including `expo-constants` itself (`{18.0.13,55.0.16}` → `{18.0.14,55.0.17}`, i.e. the SDK-55
`expo-notifications`-nested copy would move from `55.0.16` to `55.0.17`), plus `zod`
(`4.4.3`→`4.6.5`), `ws`, `ajv`, `esbuild`, `metro` and dozens more. Moving `expo-constants`'s
resolved version is exactly the kind of native-module version change orchestrator rule 4
forbids (needs a new EAS build), and re-resolving 79 other unrelated packages is well outside
this todo's minimal-change mandate. **Reverted** (`git checkout -- package-lock.json`, then
item 1's install was redone on top of the clean base) — the working tree carries only AC #1's
change, not the dedupe.

**Decision: defer AC #2.** The `expo-image-loader@6.0.0` duplicate (nested under both
`expo-image-manipulator` and `expo-image-picker`) is same-version in both locations — a pure
node_modules layout artifact, not a version conflict — so it's low-risk to fix, but doing so
safely needs either a real `npm install` (writes `node_modules`, forbidden in this shared-worktree
run) or a hand-verified lockfile edit narrower than `npm dedupe`'s whole-tree re-resolution,
which wasn't attempted given the P3/low-priority scope. Revisit at the next `npm install` that
touches `node_modules` for another reason (e.g. the next real dependency bump / native build
prep) rather than as a standalone lockfile edit.

The `expo-constants@55.0.16` nesting under `expo-notifications/node_modules` is confirmed as a
**known consequence of the SDK-55 exclusion** (#1106) — not fixable without realigning
`expo-notifications`, which is the exact major-version skew already recorded as intentional via
`expo.install.exclude`. No action.

expo-doctor's duplicate-dependency check still fails locally (unchanged: it reads `node_modules`
on disk, which this run does not touch) — this is expected and not a regression; a real `npm ci`
(e.g. in CI, or a future dependency-writing session) would need to re-run `npm dedupe` to resolve
the `expo-image-loader` half of it, once the version-set risk above is either accepted or
mitigated.

**AC #3 — DONE: all 8 skews recorded as deliberate; none aligned.**

`npx expo-doctor` (2026-09-29, read-only) reports:

```
⚠️ Minor version mismatches
package                         expected  found
@react-native-community/slider  5.0.1     5.2.0
react-native-reanimated         ~4.1.1    4.3.1
react-native-svg                15.12.1   15.15.1
react-native-worklets           0.5.1     0.8.3

🔧 Patch version mismatches
package                         expected  found
expo                            ~54.0.37  54.0.34
expo-constants                  ~18.0.14  18.0.13
expo-font                       ~14.0.12  14.0.11
expo-updates                    ~29.0.20  29.0.18
```

All 8 packages ship native code (`ios/` and/or `android/` present under each in `node_modules`),
so per orchestrator rule 4 none may be bumped in this run — every one is recorded as
**deliberate (pending next EAS build)**, not aligned:

- **Minor skews (slider/reanimated/svg/worklets).** These are direct top-level pins in
  `package.json`, not forced by any other package in the tree — checked every dependent:
  `@gorhom/bottom-sheet` accepts `>=3.16.0 || >=4.0.0-`, `react-native-keyboard-controller`
  accepts `>=3.0.0` (both satisfied by the SDK's expected `~4.1.1` too), and
  `react-native-vision-camera@5.1.1` declares **no** peer dependency on reanimated or worklets at
  all. **Correction to #1106's triage note:** the "possibly deliberate for VisionCamera v5" theory
  is disproven by this check, not confirmed — record the pin as deliberate-but-untraced, not as
  VisionCamera-motivated. `git log -S'"react-native-reanimated"' -- package.json` shows only one
  squashed scaffolding commit, so the original motivating reason isn't recoverable from history.
  Aligning down to the SDK's expected versions is itself a native-code downgrade — same
  new-build requirement either way.
- **Patch skews (expo/expo-constants/expo-font/expo-updates).** Unlike the minors, these are
  currently **behind** the SDK's expectation (e.g. `expo` `54.0.34` installed vs `~54.0.37`
  expected) — realigning means bumping forward, not down. Still native code, still requires a new
  EAS build; not bumped here. Revisit together at the next EAS build (they move in lockstep as
  part of the same Expo SDK 54 patch train).
- **Not added to `expo.install.exclude`.** Per
  `docs/solutions/conventions/expo-doctor-intentional-major-skew-exclude-2026-09-26.md` →
  Exceptions, that mechanism is for genuinely intentional **major**-version skews, not routine
  minor/patch drift — `app.json` and the `expo` block in `package.json` are unchanged. Their
  continued visibility in `expo-doctor` output is the intended revisit trigger.

**Needs a new build? No** — nothing in AC #3 changed a dependency version; this AC only records
the decision not to.

**AC #4 — split out**, per the orchestrator's explicit instruction (item 4 is the user's call, not
an executor decision): moved to a new todo,
`todos/P3-2026-09-29-expo-cng-vs-committed-native-folders-decision.md`, with `human_led: true`.
This todo is archived with items 1–3 resolved and item 4 pointing at that file.
