---
title: "npm dedupe re-resolves the whole tree against the registry — it is not a pure hoist"
track: knowledge
category: conventions
tags: [architecture, dependencies, npm, expo]
module: client
applies_to: ["package.json", "package-lock.json"]
created: 2026-09-29
---

# npm dedupe re-resolves the whole tree against the registry — it is not a pure hoist

## Rule

`npm dedupe --package-lock-only` does **not** perform a pure hoist/dedup of exact-duplicate
nested packages — it re-resolves every package's version against its declared semver range and
current registry metadata, which can move many unrelated packages to newer versions within-range.
Measured in OCRecipes (todo `P3-2026-09-26-expo-doctor-dependency-hygiene`, run 2026-09-29):
running `npm dedupe --package-lock-only --ignore-scripts` to collapse a duplicate
`expo-image-loader@6.0.0` (nested under both `expo-image-manipulator` and `expo-image-picker`)
instead changed 81 of 1371 package names' resolved versions tree-wide — including moving
`expo-constants` from `{18.0.13, 55.0.16}` to `{18.0.14, 55.0.17}`. The `55.0.16` copy is a
deliberately-pinned SDK-55 nested dependency of `expo-notifications` (see
`docs/solutions/conventions/expo-doctor-intentional-major-skew-exclude-2026-09-26.md`), so moving
it is an unwanted native-module version change requiring a new EAS build. Other moved packages
included `zod` (4.4.3 → 4.6.5), `ws`, `ajv`, `esbuild`, and `metro` — none related to the intended
fix.

Verify the output with a version-**set** diff, not a glance at the tree:

- Before running `npm dedupe`, save the current `package-lock.json`.
- After running it, compare the **set of resolved versions per package name** (not per tree path)
  between the two lockfiles.
- A pure hoist changes **zero** version sets — only tree position/path changes. Any changed
  version set means `npm dedupe` did more than hoist, and the result should be reviewed
  line-by-line or reverted (`git checkout -- package-lock.json`) before accepting.

In a project where native-module version changes require a new mobile app build (Expo/EAS or
React Native), this makes `npm dedupe` unsafe to run casually — always diff version sets before
trusting its output, and prefer a manual/targeted fix (or accept the duplicate) when the diff is
wide.

## Smell patterns

- Assuming `npm dedupe` is a no-op tree reshuffle and accepting its output without comparing
  version sets per package name before/after.
- Reaching for `npm dedupe` to collapse a duplicate when a targeted/manual lockfile edit — or
  simply accepting the duplicate — would avoid moving unrelated packages to newer within-range
  versions.
- Citing "dedupe ran clean" without quoting the before/after version-set diff.

## Why

`npm dedupe` resolves each package against its declared semver range using current registry
metadata, so any package whose range admits a newer version can move even when the only *intent*
was to collapse an exact-duplicate nested copy. In a project where native-module version changes
require a new mobile app build (Expo/EAS or React Native), this makes the command unsafe to run
casually: a within-range bump to a deliberately-pinned nested dependency (e.g. `expo-constants`'
`55.0.16` copy under `expo-notifications`) is an unwanted native-code change. The rule generalizes
beyond Expo: any npm project with native/compiled dependencies — or any dependency where a
same-range upgrade is undesirable — should verify `npm dedupe` output with a version-set diff
before accepting it, not assume it is a no-op tree reshuffle.

## Examples

See todo `P3-2026-09-26-expo-doctor-dependency-hygiene` (run 2026-09-29) for the worked
measurement: the intended fix (collapsing a duplicate `expo-image-loader@6.0.0`) changed 81 of
1371 package names' resolved versions tree-wide, with `expo-constants`, `zod`, `ws`, `ajv`,
`esbuild`, and `metro` all moving — none related to the fix. The diff was reverted
(`git checkout -- package-lock.json`) in favor of a targeted fix.

## Exceptions

- If the version-set diff between the two lockfiles is genuinely empty (only tree
  positions/paths changed), `npm dedupe` performed a pure hoist and the output is safe to accept.
- If the lockfile is already fully aligned with current registry resolution (no package's declared
  range admits a newer version), `npm dedupe` will be a no-op — but verify with the version-set
  diff rather than assuming it.

## Related Files

- `package.json`
- `package-lock.json`
- `docs/solutions/conventions/expo-doctor-intentional-major-skew-exclude-2026-09-26.md`

## See Also

- [Document an intentional Expo SDK major-version skew via expo.install.exclude](expo-doctor-intentional-major-skew-exclude-2026-09-26.md)