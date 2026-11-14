---
title: "Verifying a dependency bump before push — changed-file gates select nothing for a lockfile-only change"
track: knowledge
category: best-practices
module: shared
tags: [dependencies, architecture, testing, tooling, typescript]
symptoms: ["push gate green, CI red on a package.json/lockfile-only PR", "patch-package: 'Patch file found for package X which is not present at node_modules/X'", "vitest related passes but the full suite fails after a library upgrade"]
applies_to: [package.json, package-lock.json, patches/*.patch, test/setup.ts]
created: 2026-11-09
---

# Verifying a dependency bump before push — changed-file gates select nothing for a lockfile-only change

## When this applies

Any PR whose change is mostly `package.json` / `package-lock.json`: an `npm update` refresh, an SDK patch bump, a library major. The push gate and `vitest related` choose work from the changed files, and a lockfile maps to almost no tests — the 2026-11-09 refresh (#1815–#1817) had four breaks that the first local checks missed (two surfaced only in CI, two only in a later push gate's full-suite run).

## Checklist

1. **Orphaned patches.** For each file in `patches/`, confirm its package is still in the new lockfile. `patch-package` fails the whole install when a patched package disappears — #1815: `@react-navigation/core` 7.24 dropped `query-string`, and `patches/query-string+7.1.3.patch` broke CI's `npm ci`. Run `npx patch-package` after the install; an orphan errors, a version drift only warns (regenerate the patch for the new version so the filename stays true).
2. **Patched-library canaries.** If `test/setup.ts` (or any setup file) monkey-patches a bumped library, run that patch's canary by hand. #1815: supertest 7.3 changed the internals `test/setup.ts` patched — every supertest URL became `…:<port>undefined`.
3. **Full suite, not `vitest related`.** `related` follows imports from the changed files; a library upgrade changes behaviour in files you never touched. #1817 (zod 4): `related` ran 3,047 tests green while the full suite had 27 failures in 6 unselected files.
4. **Full lint under a 4 GB heap (CI runs on Node's default, about 4 GB)** when the lint stack moves — see the OOM doc below.
5. **Native code → runtime version.** Diff old vs new lockfile entries and check each changed package for a `.podspec`, `android/build.gradle` or `expo-module.config.json`; any hit needs a `runtimeVersion` bump and new builds (`client/lib/__tests__/native-config.test.ts` pins it). Grep alone undercounts: a version change edits a line, it adds no new key — compare the parsed `packages` maps.
6. **A lockfile rebuilt from main keeps main's versions wherever the range allows.** Resolving a lockfile conflict with `git show origin/main:package-lock.json > package-lock.json && npm install` is safe only for packages whose `package.json` floor was raised. `npm update --save` does not raise a `~` range the update stayed inside. #1816: every `expo-*` module (`~58.0.19` and similar) quietly went back to main's older patch, which undid half the PR with no error. After any rebuild, compare the new lockfile's versions with the reviewed head's (`git show <reviewed-sha>:package-lock.json`): only the expected entries may differ. For Expo, `npx expo install --check` catches it, and `npx expo install --fix` writes the expected `~` ranges into `package.json` so the next rebuild can't drop them.
7. **Measure the control.** Each check above needs a case that must fail (the old tree, a known-native package) before its clean result counts.

## Why

Local gates are tuned for code changes; dependency changes move behaviour without moving code, so the selection logic reports green over nothing. CI catches it, but one CI round per break is slow and each fix costs another review.

## Related Files

- `scripts/preflight.sh` (changed-file selection), `test/setup.ts`, `patches/`
- `client/lib/__tests__/native-config.test.ts`

## See Also

- [type-aware lint near the CI heap cap](../performance-issues/type-aware-lint-runs-near-ci-heap-cap-typescript-eslint-bump-ooms-2026-11-09.md)
- [supertest listener on macOS](../runtime-errors/supertest-per-request-listener-reaches-foreign-server-on-macos-2026-10-20.md) — the patch that broke on 7.3
