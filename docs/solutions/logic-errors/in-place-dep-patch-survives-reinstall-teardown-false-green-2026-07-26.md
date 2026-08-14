---
title: An in-place patch to a package-manager-owned file survives reinstall, so its removal check gives a false green
track: bug
category: logic-errors
module: shared
severity: medium
tags: [cocoapods, ios, react-native, native-build, dependency-patching, post-install, verification, tooling, fmt]
symptoms: ['Deleting a dependency patch and rebuilding "clean" succeeds locally, but CI/EAS fails with the exact errors the patch existed to suppress', 'A build hook that mutates a vendored file prints nothing on the second `pod install` / `npm install` — it silently takes an already-patched branch', 'The patched file is gitignored, so `git status` is clean and nothing signals that the tree is in a non-pristine state', 'Two developers on the same commit get different build results depending on whether they ever ran the patching version of the hook']
applies_to: [ios/Podfile, package.json, patches/**]
created: '2026-07-26'
---

# An in-place patch to a package-manager-owned file survives reinstall, so its removal check gives a false green

## Problem

A build hook patches a file the package manager owns — `ios/Pods/**` via a
CocoaPods `post_install`, `node_modules/**` via a `postinstall` script. The hook
carries a "remove this when upstream fixes it" note whose verification step is
some form of *clean build*.

That verification cannot detect the regression it exists to catch. "Clean"
almost always means clearing the **compiler's** cache (DerivedData, `.tsbuildinfo`,
a build directory). The patched file lives in the **package manager's** cache,
which a clean build does not touch and a reinstall usually does not restore.

Concretely, in `ios/Podfile` (PR #725):

```ruby
# The instruction that could never work:
# REMOVE THIS when fmt moves past 11.0.2 — re-run a clean build
# (fresh DerivedData, so fmt actually recompiles) before deleting.
```

Delete the hook → `pod install` → wipe DerivedData → build. It **passes**, because
`Pods/fmt/include/fmt/base.h` still carries the patch from the previous run. The
developer concludes upstream is fixed and merges. EAS Build, which installs into
a pristine sandbox, then fails with the original errors and no causal thread back
to the deletion.

## Symptoms

- A local "clean build" green that CI or a hosted build service contradicts, on
  the same commit, with errors the deleted patch used to suppress.
- The patch hook printing its "applied" message on first run and nothing
  afterward — the marker guard is doing its job, which is also what hides the
  stale state.
- `git status` clean throughout, because the patched artifact is gitignored.

## Root Cause

There are two independent cache layers, and the obvious "clean" verb only
addresses one:

| Layer | Holds | Cleared by |
| --- | --- | --- |
| Compiler cache | Compiled objects, module maps | `rm -rf DerivedData`, `--clean`, fresh `derivedDataPath` |
| Package cache | The **source** the patch mutated | `rm -rf ios/Pods`, `pod deintegrate`, `rm -rf node_modules` |

CocoaPods re-extracts a pod only when its **spec checksum** changes. Removing the
Podfile hook does not change fmt's version or checksum, so the sandbox is left
exactly as-is. npm behaves the same way: it does not re-verify the contents of an
already-installed package whose lockfile entry is unchanged.

The result is a verification procedure that measures the wrong thing — the same
failure shape as judging lockfile churn by diff line count, or treating a grep
hit as proof of a claim. The check runs, produces a green, and answers a question
nobody asked.

## Solution

Name the **package** cache, not the build cache, in the removal instruction:

```ruby
# REMOVE THIS when fmt moves past 11.0.2 or RN unpins it — but verify the
# removal with `rm -rf ios/Pods && pod install`, NOT with fresh DerivedData.
# This hook rewrites base.h *inside the sandbox*, and CocoaPods re-extracts
# a pod only when its spec checksum changes. So deleting the hook and
# re-running `pod install` leaves the already-patched header on disk: a
# DerivedData-clean build passes against a still-patched header, and only
# EAS — which pod-installs into a pristine sandbox — fails.
```

Verify the mechanism rather than reasoning about it — demonstrate that a *plain*
reinstall does not re-extract the pod, with the hook still in place and the
sandbox already patched from a prior run. Run the reinstall and check two
separate things — they are not interchangeable, and only one of them
discriminates:

```bash
pod install                                        # CHECK 1 — expect NO "[fmt] patched ..." line
grep -c "patched by Podfile" ios/Pods/fmt/include/fmt/base.h   # CHECK 2 — expect exactly 1
```

**Check 1 (the silent `pod install`) is the actual proof of non-re-extraction —
for THIS specific invocation: a plain reinstall, hook still present, sandbox
already patched.** CocoaPods only prints the patch hook's `[fmt] patched ...`
message when it re-extracts the pod and the hook runs against it again.
Silence here means the sandbox was never touched by this command — which is
exactly the hazard: it demonstrates that deleting the hook and running this
same plain `pod install` would leave the already-patched header in place
untouched, unrelated to whether the hook is even still there to re-apply it.
**This inverts for the doc's own recommended removal check** (`rm -rf ios/Pods
&& pod install`, above): that command forces re-extraction, so with the hook
still present the `[fmt] patched ...` line correctly **does** print — expected
and healthy, not a failure. Check 1 is a mechanism demonstration you run
*before* deciding whether the hook can be removed, not a post-deletion
verification step.

**Check 2 (`grep -c … # expect 1`) proves only non-duplication, and cannot by
itself tell the two worlds apart.** It returns `1` in *both*: the sandbox was
left alone (the stale marker from a prior run survives untouched), **and** the
sandbox was re-extracted and the hook re-ran and re-patched it (a fresh marker,
also count 1). A reader who skims to this line and stops has exactly the "check
that cannot fail" this solution's own Prevention section warns against — Check
2 only rules out a double-patch; Check 1 is what rules out re-extraction (for
the plain-reinstall invocation it's scoped to, above).

Also give every skip path a warning. A patch hook that no-ops silently — because
the target file moved, not just because the anchor changed — reproduces this
exact blind spot from a different direction:

```ruby
if File.exist?(fmt_base_h)
  # ... patch, or warn if the anchor is missing
else
  Pod::UI.warn "[fmt] base.h not found at #{fmt_base_h} — the pod layout may " \
               'have changed, so the consteval patch was NOT applied.'
end
```

## Prevention

- **Prefer a tracked patch file over an in-place mutation** where the ecosystem
  offers one. `patch-package` exists largely because of this failure mode: it
  re-applies from a committed diff on every install and **errors** when the diff
  no longer applies, so drift is loud and the pristine state is recoverable.
  CocoaPods has no standard equivalent for sandbox headers, which is why the
  procedural fix above is what is available there.
- **When writing any "remove me later" comment, ask which cache holds the thing
  you changed** — and name that one. A removal note is a set of instructions for
  someone with less context than you had; a wrong one is worse than none, because
  it manufactures confidence.
- **Treat "the verification passed" as a claim to be checked, not a conclusion.**
  If a check cannot fail in the scenario it was written for, it is not a check.

## Related Files

- `ios/Podfile` — the `post_install` fmt/consteval patch and its removal note
- `ios/Podfile.lock` — `PODFILE CHECKSUM` is the only line a Podfile edit moves
- `scripts/patch-mlkit-simulator.py` — the sibling patcher; it runs as a build
  phase on **every** build rather than at install time, so it does not have this
  blind spot

## See Also

- [symbol-existence-grep-is-not-claim-verification](symbol-existence-grep-is-not-claim-verification-2026-07-05.md) — same family: a check that runs, greens, and answers a different question
- [verify-lockfile-churn-semantically-not-by-diff-line-count](../conventions/verify-lockfile-churn-semantically-not-by-diff-line-count-2026-06-23.md) — the wrong-proxy version of the same mistake
- [lockfile-only-version-hold-is-not-a-pin](../conventions/lockfile-only-version-hold-is-not-a-pin-2026-07-25.md) — a hold that lives only in a generated artifact is not a hold
- [visioncamera-5-upgrade-ios-xcode26-build](../best-practices/visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md) — the surrounding iOS/Xcode 26 native-build context
