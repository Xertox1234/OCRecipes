---
title: A CI cache key must be captured before the step it gates can mutate its own inputs — and never retype a toolchain version it can read live
track: knowledge
category: conventions
module: shared
tags: [harness, ci, github-actions, testing, architecture, actions-cache, caching, cocoapods, xcode, idempotency, tooling]
applies_to: [".github/workflows/**"]
created: '2026-09-02'
---

# A CI cache key must be captured before the step it gates can mutate its own inputs — and never retype a toolchain version it can read live

## Rule

1. **Capture a cache key from its input files ONCE, before the step the cache
   gates can run — never re-derive it after.** If a `restore`/`save` pair
   (e.g. `actions/cache/restore` + `actions/cache/save`) hashes a file that
   the GATED step itself can rewrite (a lockfile, a generated project file),
   compute the hash into a job-level variable (`$GITHUB_ENV`) before that
   step runs, and reference the SAME captured value in both the restore and
   the save. Never call `hashFiles()` again in the save step — even with the
   exact same glob arguments, it re-scans the current filesystem state, which
   has moved.
2. **Never hand-copy a toolchain/environment version into a cache key as a
   literal.** Read it from the toolchain itself (e.g.
   `xcodebuild -version | head -1 | awk '{print $2}'` after `xcode-select
   -s`) into the same job-level variable, so the key can never drift from
   the actual pin a nearby step already set.

## Smell patterns

- A cache `restore`/`save` pair where the `save` step's `key:` re-invokes
  `hashFiles()` on paths the job's own build step writes to.
- A `restore-keys:` (or any) literal like `xcode26.3-` sitting a few lines
  below a `xcode-select -s /Applications/Xcode_26.3.app` step, with no
  variable connecting them.
- `git status` after a locally-run package-manager install (`pod install`,
  `npm install`) shows a TRACKED lockfile or generated project file as
  modified, even though nothing in the manifest actually changed.

## Why

Both failure modes were caught empirically while adding `ios/Pods` +
Xcode DerivedData caching to this repo's `e2e-regression.yml` iOS job
(`todos/archive/P3-2026-08-31-e2e-ios-job-cache-pods-and-deriveddata.md`):

- Running `pod install` **twice, back-to-back, locally**, with `ios/Pods`
  already fully populated from the first run, modified `ios/Podfile.lock`
  AND `ios/OCRecipes.xcodeproj/project.pbxproj` **both times** — CocoaPods
  re-resolves any loosely-pinned transitive dependency against whatever the
  spec repo currently has, so `pod install` is not idempotent on tracked
  files even when the Podfile hasn't changed. A cache design that hashes
  `Podfile.lock` AFTER the build step (which runs `pod install` internally
  via `expo run:ios`) computes a save key that differs from the key any
  FUTURE run's restore step will compute against the pre-build, checked-out
  lockfile — the cache would then miss forever, silently, with no error:
  each run "saves successfully" under a key nothing will ever ask for again.
- A hand-typed `xcode26.3` literal in a cache key looks harmless until the
  pinned Xcode version in the nearby `xcode-select -s` step is bumped and
  this literal is forgotten. For a package-manager cache (Pods) that's a
  wasted-speed bug — worst case, a cold `pod install`. For a COMPILER
  output cache (DerivedData) it's a correctness bug: restoring compiled
  objects/module maps built under the OLD toolchain and asking the NEW
  toolchain to link against them.

The shared root cause: **the key's inputs must be things the cached step
cannot itself change out from under the key.** A file the step mutates and
a version the step's own toolchain determines are the same class of hazard
— capture both before the step runs, from a source the step doesn't
control (the pre-checkout file on disk; the toolchain's own `-version`
output), not from re-deriving them afterward.

## Examples

```yaml
# Capture once, before the mutating step. Local var for in-script reuse
# (writes to $GITHUB_ENV only take effect for LATER steps, not this one),
# then reference env.* identically in restore AND save — never re-hash.
- name: Compute cache key
  run: |
    XCODE_VERSION="$(xcodebuild -version | head -1 | awk '{print $2}')"
    echo "PODS_CACHE_KEY=pods-${{ runner.os }}-xcode${XCODE_VERSION}-${{ hashFiles('ios/Podfile.lock', 'package-lock.json') }}" >> "$GITHUB_ENV"

- uses: actions/cache/restore@v6
  with:
    path: ios/Pods
    key: ${{ env.PODS_CACHE_KEY }}

# ... the build step, which runs `pod install` and rewrites Podfile.lock ...

- if: steps.build.outcome == 'success'
  uses: actions/cache/save@v6
  with:
    path: ios/Pods
    key: ${{ env.PODS_CACHE_KEY }}   # same captured value, NOT re-hashed
```

A related, smaller catch from the same change: `actions/cache/save`'s own
implementation tars the archive (the expensive part) BEFORE checking
whether the key already exists, so an unconditional save step re-compresses
and re-uploads on every green run even on an exact-key hit. Gate the save
on the matching restore step's own `cache-hit` output
(`if: steps.build.outcome == 'success' && steps.restore-id.outputs.cache-hit
!= 'true'`) to skip that cost when nothing changed.

## Exceptions

A `restore-keys` FALLBACK prefix is fine to leave un-pinned to an exact
input hash — that's the point of a fallback (a coarse, deliberately stale
match). It still must NOT contain a hand-typed toolchain-version literal
disconnected from the real pin; build the prefix from the same captured
toolchain variable used in the primary key.

## Related Files

- `.github/workflows/e2e-regression.yml` — `Compute Pods/DerivedData cache
  keys`, `Restore Xcode DerivedData cache`, `Restore CocoaPods cache`,
  `Save Xcode DerivedData cache`, `Save CocoaPods cache` steps
- `todos/archive/P3-2026-08-31-e2e-ios-job-cache-pods-and-deriveddata.md`

## See Also

- [verify-lockfile-churn-semantically-not-by-diff-line-count](verify-lockfile-churn-semantically-not-by-diff-line-count-2026-06-23.md) — a different angle on the same "a lockfile diff is not what it looks like" family
- [an in-place patch surviving reinstall](../logic-errors/in-place-dep-patch-survives-reinstall-teardown-false-green-2026-07-26.md) — the companion CocoaPods fact this change leaned on: a pod is only re-extracted when its spec checksum changes, which is what makes an exact-key Pods cache hit equivalent to a warm local `pod install`
