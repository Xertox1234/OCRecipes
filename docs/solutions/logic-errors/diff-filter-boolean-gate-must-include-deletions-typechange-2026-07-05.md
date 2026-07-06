---
title: "A diff-filter copied from a lint-scoping sibling array silently drops deletions and typechanges from a pure existence gate"
track: bug
category: logic-errors
module: shared
severity: low
tags: [git, diff-filter, bash, shell, ci, hooks, husky, boolean-gate, code-review]
symptoms: [A git-diff-driven boolean gate stays false for a push that only deletes or typechanges a file under its watched path, A stamp/skip/certify mechanism silently certifies a push it never actually verified, The bug is invisible in normal testing because most changes are additions/modifications — only deletion or symlink-swap scenarios trigger it]
applies_to: [scripts/*.sh, .claude/hooks/**]
created: '2026-07-05'
---

# A diff-filter copied from a lint-scoping sibling array silently drops deletions and typechanges from a pure existence gate

## Problem

PR #508 (the `preflight:fast` pass-stamp consolidation) writes a verified stamp for a push
whose changed set contains no `.ts`/`.tsx` files, but that stamp never exercised any
`.claude/hooks/**` or `.husky/**` shell logic the push may have changed. Closing that gap
needed a pure boolean probe (`HOOK_CHANGED`) to detect hook/husky changes in the
`BASE..HEAD` range, gating a call to `scripts/run-hook-tests.sh` before the stamp write.
The first implementation copy-pasted `--diff-filter=ACMR` from a pre-existing sibling
array (`CHANGED`) in the same file. That sibling array's `ACMR` is
correct for *its* purpose: `CHANGED` globs `.ts`/`.tsx` files and passes them to
eslint/vitest, which cannot operate on a deleted path, so excluding `D` (deletion) is
deliberate there. But `HOOK_CHANGED` has a completely different purpose — it is only used
as an existence gate (`[ ${#HOOK_CHANGED[@]} -gt 0 ]`), never handed to a downstream
tool, so there is no reason to exclude any diff-filter status letter.

Two rounds of code review caught two successive gaps from this copy-paste:

- **Round 1** found that `ACMR` silently misses a *pure deletion* of a hook file (e.g.,
  `git rm .claude/hooks/some-test.sh` with nothing else in the push). `HOOK_CHANGED`
  stays empty, `run-hook-tests.sh` never runs, and `preflight:fast` writes a "verified"
  stamp for a push that deleted shell logic without ever exercising that deletion.

- **Round 2** (after fixing to `ACDMR`) found a second, narrower gap: a *typechange*
  (e.g., a hook file swapped for a symlink between commits, producing a bare `T`
  diff-status record) is invisible to `ACDMR` as well.

Both gaps were confirmed empirically via a throwaway git repo replicating the diff range
logic.

## Symptoms

- A `git-diff`-driven boolean gate stays false for a push that only deletes or
  typechanges a file under its watched path.
- A stamp/skip/certify mechanism silently certifies a push it never actually verified.
- The bug is invisible in normal testing because most changes are additions or
  modifications — only deletion or symlink-swap scenarios trigger it.

## Root Cause

A `--diff-filter` allowlist was copied from a sibling array (`CHANGED`, which passes
paths to eslint/vitest and must exclude `D`) to a purely boolean existence gate
(`HOOK_CHANGED`, which only checks emptiness). The filter was applied without questioning
why it excludes what it excludes. A filter tuned for "must be operable by a downstream
tool" (exclude `D`) is wrong for "must detect that something happened to this path"
(include `D`, and generally `T` too).

## Solution

Use `--diff-filter=ACDMRT` for the boolean-only probe, or better yet, omit
`--diff-filter` entirely:

```bash
# HOOK_CHANGED is a pure existence gate — never passed to a downstream tool.
# Include ALL status letters (ACDMRT) so that deletions and typechanges
# are detected just as reliably as additions and modifications.
HOOK_CHANGED=()
while IFS= read -r f; do [ -n "$f" ] && HOOK_CHANGED+=("$f"); done \
  < <(git diff --name-only --diff-filter=ACDMRT "$BASE" HEAD -- '.claude/hooks/' '.husky/' 2>/dev/null)

if [ "${#HOOK_CHANGED[@]}" -gt 0 ]; then
  run bash scripts/run-hook-tests.sh || exit 1
fi

# ... stamp write happens later, only reached if the above didn't exit 1
```

The general rule is stated as a comment above the filtered call. An even safer default
for a pure existence gate is to omit `--diff-filter` entirely — the probe will then
detect any change regardless of status letter.

## Prevention

- When you copy a `--diff-filter` (or any allowlist-style filter) from a sibling array
  in the same file, check *why* that filter excludes what it excludes before reusing it
  for a different consumer.
- For a probe used only as an existence/boolean gate, the safest default is to omit
  `--diff-filter` entirely, or include every status letter that could occur
  (`ACDMRT` covers the common set).
- Code review check: any copy-paste of a `--diff-filter` warrants a note in the PR
  description explaining the consumer's requirements and why the filter matches.

## Related Files

- `scripts/preflight.sh` — contains both `CHANGED` (lint-scoped, uses `ACMR`) and
  `HOOK_CHANGED` (existence gate, now uses `ACDMRT`)
- `.claude/hooks/test-preflight-fast-stamp.sh` — tests the stamp-behavior including
  deletion-only and typechange-only edge cases

## See Also

- [glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03](glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md) —
  sibling fail-open/silent-skip gotcha in the same hook-test-runner family: a glob
  loop that goes green when nothing is matched, because absence of work and absence of
  the work-source shared one success channel