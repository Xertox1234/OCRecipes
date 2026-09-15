---
title: "Two branches that each bump the same assertion-count pin merge CLEAN and leave the pin at one side's value — git reports no conflict and, with strict:false, CI never re-runs"
track: bug
category: code-quality
tags: [harness, hooks, testing, safety-gate, bash, security]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh", ".github/workflows/*.yml"]
symptoms: ["two PRs are each green and `git merge-tree` reports no conflict, but the second one turns main red on the next push run", "a hook suite fails with 'assertion total is N, expected M' immediately after an unrelated PR merged", "`gh pr view` shows mergeStateStatus CLEAN for a PR whose suite will fail once its sibling lands", "a pinned EXPECTED_TOTAL / EXPECTED_ROWS is correct on each branch alone and wrong on their union"]
created: 2026-09-14
severity: high
---

# A clean merge leaves a stale count pin

## Problem

Every hook suite in this repo pins its own assertion total
(`EXPECTED_TOTAL`, `EXPECTED_ROWS`, `EXPECTED_PRECISE_GAPS`). The pin is the thing that
catches a silently skipped assertion — without it a `command not found` mid-loop
subtracts a row and the suite still prints a clean pass/0 fail.

That pin is also a single line holding a **number derived from the whole file**. So when
two branches each add rows, each correctly bumps the pin **to its own new total**. Git
sees one line, changed on both sides, and — if the two edits land in different hunks, or
one side's hunk context differs — resolves it without a conflict by taking one side.

The merged tree then has both branches' rows and only one branch's pin.

## Symptoms

See frontmatter. The tell is that each PR is green in isolation and `merge-tree` reports
no conflict, so nothing in the normal workflow surfaces it until it is on `main`.

## Root Cause

Measured 2026-09-14 across three independent suites, by materialising the simulated merge
(`git merge-tree --write-tree` -> `git commit-tree` -> `git archive | tar -x`) and running
each suite's own runner against it:

| pair | `merge-tree` verdict | suite on the merged tree |
| --- | --- | --- |
| git-safety: 965 then 956 | **clean** | `218 passed, 1 failed` — `assertion total is 218, expected 151` |
| merge-review-guard: 964 then 957 | **clean** | `109 passed, 2 failed` — `assertion total is 110, expected 95` |
| outward-CLI corpus: any two of 968/967/966/957 | CONFLICT | n/a — git blocks it |

Controls, same sandbox and runner, because a merged-tree failure means nothing without
them: `test-git-safety.sh` on plain `main` is `126 passed, 0 failed`; 965 alone is
`151/0`; 956 alone is `193/0`. For the merge-review lane, plain `main` already shows
exactly 1 failure (a sandbox artifact — the tar-extract has no `.git`), and both branches
alone show that same 1, so the merged tree's SECOND failure is the real one.

The outward-CLI row is the instructive contrast: that lane conflicts, so **git protects
it**. The dangerous lanes are the ones git calls clean.

### Why it reaches `main` instead of the PR

`main`'s branch protection has `required_status_checks.strict = false` (verify:
`gh api repos/<owner>/<repo>/branches/main/protection --jq '.required_status_checks.strict'`).
A PR therefore merges on **its own existing green**, without being brought up to date and
without re-running CI against the new `main`. So the second merge in a lane lands
unverified and the failure appears on `main`'s own push run, not on the PR that caused it.

CI does run these suites — via `scripts/run-hook-tests.sh`, which GLOBS
`.claude/hooks/test-*.sh` inside the required `Lint · Types · Patterns` check. A
literal-filename grep of `.github/workflows/` misses that; only the corpus script is named
outright. So "is this suite even in CI?" is not answerable by grepping the workflow.

## Solution

**Within a lane, only the FIRST merge may ride its existing green.** Every successor must
be synced to `main` and re-verified BEFORE merging.

Find the lanes combinatorially, not from an overlap table:

```bash
base=$(git rev-parse main)
for a in "${BRANCHES[@]}"; do for b in "${BRANCHES[@]}"; do
  [ "$a" = "$b" ] && continue
  t=$(git merge-tree --write-tree "$base" "$a" | head -1)
  c=$(git commit-tree "$t" -p "$base" -m sim)
  git merge-tree --write-tree "$c" "$b" >/dev/null 2>&1 \
    && echo "$a -> $b : clean (verify the SUITE, not just the merge)" \
    || echo "$a -> $b : CONFLICT (git protects this one)"
done; done
```

Then run the affected suite against the materialised merge tree — a clean `merge-tree`
is the signal to check, not the all-clear.

**Recompute the pin; never compute it arithmetically.** "main's 602 plus each branch's
delta" is wrong whenever two branches add a row with the same id, and the corpus check
covers "rows, gap totals, **per-ID manifests**". Run the script and read the true number
off it. Do this separately per pin: a branch can LOWER one (a PR that closes gaps takes
`EXPECTED_PRECISE_GAPS` 31 -> 24), so after a gap-adding predecessor neither the old nor
the new value is right.

## Prevention

- Treat a pinned total as **merge-coupled state**, like a migration number — two branches
  touching one need an explicit order, not a merge.
- When adding a suite, add the pin (every sibling has one), and say in its comment that it
  must be re-derived from a clean run, never hand-incremented.
- A green PR plus a clean `merge-tree` is not evidence the union is green. Under
  `strict:false` nothing else will check before it lands.

## Related Files

- `scripts/run-hook-tests.sh` — the glob loop that puts every `.claude/hooks/test-*.sh`
  into the required check
- `.claude/hooks/repro-outward-cli-corpus.sh` — the one suite named literally in CI

## See Also

- [A pin records its VALUE but must also record whether it is CORRECT](a-pin-records-its-value-but-must-also-record-whether-it-is-correct-2026-09-13.md) — the same pin, one layer in: this doc is about two branches, that one about one branch's verdict
- [A measurement belongs to the tree it was taken on](a-measurement-belongs-to-the-tree-it-was-taken-on-2026-09-13.md) — why re-deriving the pin on the MERGED tree is the only valid reading
- [A clean zero needs its denominator](a-control-that-runs-before-the-work-cannot-validate-it-2026-09-07.md) — why the per-branch controls above are load-bearing
