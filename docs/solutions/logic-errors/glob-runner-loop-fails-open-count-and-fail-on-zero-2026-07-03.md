---
title: A glob-driven runner loop passes green when the glob matches nothing — count runs and fail on zero
track: bug
category: logic-errors
module: shared
severity: medium
tags: [bash, shell, glob, nullglob, ci, github-actions, hooks, set-e, fail-open, arithmetic]
symptoms: [A CI or gate step that "runs everything matching a glob" goes green having executed zero items after a rename or relocation, Step log shows none of the per-item markers yet the step exits 0, An existence guard with continue silently converts an unmatched literal glob pattern into "nothing to do"]
applies_to: [.claude/hooks/**, scripts/**/*.sh, .github/workflows/*.yml, .husky/**]
created: '2026-07-03'
last_updated: '2026-07-03'
---

# A glob-driven runner loop passes green when the glob matches nothing — count runs and fail on zero

## Problem

PR #495 replaced CI's five hand-listed hook-test steps with a glob loop
(`for t in .claude/hooks/test-*.sh`). With `nullglob` unset (bash default), an unmatched
glob stays a literal string; the `[ -f "$t" ] || continue` guard skips it; the loop ends;
the step exits 0. If the hook tests are ever renamed, relocated, or the directory dropped,
the entire 15-test suite silently vanishes from CI while the required check stays green —
the exact silent-coverage-loss class the loop was introduced to prevent. The old
hand-listed steps failed loudly (exit 127) on a missing file; the glob form removed that
invariant.

## Symptoms

- A "runs everything matching X" gate goes green with no per-item output in its log.
- Coverage loss is only discovered later, when a hook regression ships that the suite
  would have caught.

## Root Cause

Two composed defaults fail open: bash leaves an unmatched glob as literal text instead of
an empty list, and the existence guard turns "nothing matched" into "nothing to do". A
zero-iteration loop is indistinguishable from a fully-passing run unless something counts.
Same family as probes that signal absence by empty output: absence of work and absence of
the work-source share one success channel.

## Solution

Count executed items and fail the step when the count is zero (or below a known floor):

```bash
ran=0
for t in .claude/hooks/test-*.sh; do
  [ -f "$t" ] || continue
  echo "▶ $t"
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_COMMON_DIR bash "$t" || exit 1
  ran=$((ran+1))
done
if [ "$ran" -eq 0 ]; then
  echo "::error::.claude/hooks/test-*.sh matched no files — hook self-test suite did not run"
  exit 1
fi
echo "✓ $ran hook self-tests passed"
```

**Counter trap:** increment with `ran=$((ran+1))`, never `((ran++))`. Arithmetic commands
return non-zero when the expression evaluates to 0, and `((ran++))` post-increment yields
the pre-increment value — so at `ran=0` it exits 1, and under `set -e` (GitHub Actions'
default `run:` shell) it kills the step on the very first iteration. An assignment with
arithmetic expansion always exits 0. Verified on bash 3.2 (macOS) and 5.2.37 (the
ubuntu-latest runner): happy path exit 0, empty glob exit 1 with the error line, mid-loop
test failure fail-fasts before the guard.

## Prevention

- Any gate loop of the shape "run everything matching `<glob>`" needs a floor assertion —
  fail on zero at minimum; a known-minimum count is stronger.
- When replacing hand-listed invocations with a glob (to kill membership drift), notice
  the invariant the hand-list gave for free: each named file's existence was asserted by
  the failing exit of a missing file. Re-establish it explicitly.
- Both callers now single-source the loop through `scripts/run-hook-tests.sh` (extraction
  landed 2026-07-03), so this guard is carried to `scripts/preflight.sh` full mode and CI
  alike — there is no longer a twin loop to drift.

## Related Files

- `scripts/run-hook-tests.sh` — single source for the loop, counter, and zero-count guard (both callers invoke it)
- `.github/workflows/ci.yml` — "Hook self-tests" step calls `scripts/run-hook-tests.sh`
- `scripts/preflight.sh` — full mode calls `scripts/run-hook-tests.sh` (now guarded too, no longer fails open)

## See Also

- [empty probe output needs exit-code check](empty-probe-output-needs-exit-code-check-2026-07-02.md) — same fail-open family: absence and failure sharing one channel
- [pipefail grep condition fails open via SIGPIPE](pipefail-echo-grep-condition-fails-open-via-sigpipe-2026-06-27.md) — another silent shell fail-open in the same toolchain
