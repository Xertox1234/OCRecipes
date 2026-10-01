---
title: A restore-keys prefix hit is not a cache-hit, and a restored build cache is not guaranteed to be faster — measure both before trusting them
track: knowledge
category: conventions
module: shared
tags: [harness, ci, github-actions, testing, actions-cache, caching, xcode, measurement, tooling]
applies_to: [".github/workflows/**"]
created: '2026-09-13'
---

# A restore-keys prefix hit is not a cache-hit, and a restored build cache is not guaranteed to be faster — measure both before trusting them

## Rule

1. **A `restore-keys:` fallback match does NOT set a restore step's `cache-hit`
   output to `'true'` — only an exact primary-key match does.** Before reading
   any `workflow_dispatch` run as evidence about a warm cache's effect, check
   the matching restore step's own `cache-hit` output (or its log line: an
   exact hit says the key matched; a fallback says a `restore-keys` prefix
   matched instead). A run that only got a prefix hit restored a STALE
   artifact, and for a compiler-output cache (Xcode DerivedData, build
   caches in general) a stale tree is frequently invalidated wholesale by the
   toolchain — the run then pays close to a full cold cost anyway, and
   reading its timing as "still slow despite caching" or "the cache didn't
   help much" is not a warm measurement at all; it's another cold-ish one
   mislabeled.
2. **A restored build/compiler cache is not guaranteed to be faster — measure
   the end-to-end step time on a genuine exact-hit run before trusting the
   cache structurally.** Populating the cache, and Xcode/the toolchain then
   validating (and often discarding) most of what was restored, can cost more
   wall-clock time than a cold build would have taken. "The restore step
   logged success" is not evidence of a net win; only a measured, exact-hit
   run's total step time is.

## Smell patterns

- A workflow's cache `restore` step has a `restore-keys:` fallback, and a
  measurement or comment treats every run that hit *some* key (primary or
  fallback) as equally "warm," without checking which one matched.
- A cache-hit comment cites "the build is now faster with caching" without a
  same-conditions cold-run number to compare against, or without confirming
  the compared run was an EXACT primary-key hit (`cache-hit: 'true'`), not a
  fallback.
- A large, non-deterministic artifact (compiled object files, a build
  database) is cached on the assumption that "restoring beats rebuilding,"
  with no end-to-end timing taken after the cache actually goes warm.

## Why

Caught while re-measuring `.github/workflows/e2e-regression.yml`'s iOS build
step after adding CocoaPods + Xcode DerivedData caching
(`todos/archive/P3-2026-08-31-e2e-ios-job-cache-pods-and-deriveddata.md`). Four
`workflow_dispatch` runs, same job, same runner pool:

| Run         | Cache state at build                                 | Build time  |
| ----------- | ---------------------------------------------------- | ----------- |
| 33790849004 | cold — nothing stored                                | 39m 03s     |
| 33796820565 | DerivedData `restore-keys` PREFIX hit, Pods MISS      | 36m 48s     |
| 33802822765 | exact hit on BOTH (build succeeded; save steps `skipped`, proving the hit) | 51m 01s |
| 33826146222 | exact hit on BOTH (build succeeded; save steps `skipped`, proving the hit) | 47m 17s |

Run 2 looked almost as fast as cold, which read at first glance like the
cache "mostly not hurting." It was actually explained by rule 1: a
`restore-keys` prefix match restored a STALE DerivedData tree (the primary
key had changed because `package-lock.json` was bumped by a dependency merge
between dispatches, and BOTH the Pods and DerivedData key formulas hash it),
Xcode invalidated most of it, and Pods missed too — so run 2 paid close to a
full cold cost under a different name. Runs 3 and 4 were the first two
GENUINE warm measurements: both builds' `Build and install iOS app` step
reported outcome `success` (a failed or cancelled run would not produce a
measured step duration in this workflow's dispatch log the way these two
did) AND both save steps reported `skipped` — the save gate is
`if: success && cache-hit != 'true'`, so `skipped` on a build that succeeded
leaves only the `cache-hit == 'true'` branch, meaning the matching restore
step's own `cache-hit` output was already `'true'` (see
[ci-cache-key-inputs-must-precede-mutating-step-2026-09-02](ci-cache-key-inputs-must-precede-mutating-step-2026-09-02.md)
for that gate) — and both landed 8–12 minutes SLOWER than cold, agreeing with
each other. Restoring ~1.63 GiB of DerivedData, plus whatever Xcode spent
validating and discarding most of it, cost more than it saved. DerivedData
caching was removed as a result; CocoaPods caching (132 MiB, exact-match
only, ~4s restore, no `restore-keys` fallback) was kept — it never exhibited
this failure mode because an exact-hit Pods sandbox is equivalent to a warm
local `pod install` (a much smaller, more deterministic restore target).

## Exceptions

A `restore-keys` fallback is still fine to keep for a cache where a stale hit
is genuinely cheap to validate or discard (small artifacts, package manager
sandboxes with cheap incremental re-resolution) — the failure mode above is
specific to large, compiler-maintained state where "restore, then let the
tool figure out what's stale" is itself expensive. The fix is not "never use
`restore-keys`"; it's "don't read a `restore-keys` hit as a warm-cache
measurement."

## Related Files

- `.github/workflows/e2e-regression.yml` — `Compute Pods cache key`,
  `Restore CocoaPods cache`, `Save CocoaPods cache` steps, and the
  `timeout-minutes` comments this measurement fed
- `todos/archive/P3-2026-08-31-e2e-ios-job-cache-pods-and-deriveddata.md`

## See Also

- [ci-cache-key-inputs-must-precede-mutating-step](ci-cache-key-inputs-must-precede-mutating-step-2026-09-02.md) — the companion fact about this same cache: a `cache-hit` output only ever reads `'true'` on an exact primary-key match, which is what makes the `save` step's own skip-gate (and this rule's measurement check) possible
- [a sampled corpus described as generated](../code-quality/a-sampled-corpus-described-as-generated-2026-09-13.md) — the same family of mistake: a measurement that looks like it validates the thing it's actually silent about
